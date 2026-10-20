// Plans a ride: favourites -> Qloo entities -> taste-matched places -> stops -> bike route.

import { qlooIsLive } from './config.js';
import { geocode, haversineKm, routeBike, round1, ROAD_FACTOR } from './geo.js';
import { FOOD_CATEGORY, findTasteEntity, findTastePlaces, findTasteTag } from './qloo.js';

export class PlanError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PlanError';
  }
}

// A stop may make the ride this much longer than requested.
const DISTANCE_SLACK = 1.15;

// Distance-fit weight: moving the ride's length by the whole requested distance
// (towards or away from it) is worth this much affinity.
const DISTANCE_WEIGHT = 0.6;

// Hotels and other places to stay make odd bike stops, so they're skipped unless asked for.
const DEFAULT_PREFER = { stay: 0 };

// Each extra stop of an already-chosen category is worth this much less, so rides mix cafés, food and sights.
const REPEAT_FACTOR = 0.75;

const roadKm = (a, b) => haversineKm(a, b) * ROAD_FACTOR;

function tourKm(tour) {
  let total = 0;
  for (let i = 1; i < tour.length; i++) total += roadKm(tour[i - 1], tour[i]);
  return total;
}

/**
 * Picks stops greedily. Each round inserts the candidate with the best
 *   score = affinity * preference * repeatPenalty - lambda * (|L + detour - T| - |L - T|)
 * where L is the current ride length and T the requested distance. So while the ride is
 * shorter than requested, a detour helps; once it's long enough, a detour costs.
 * Each stop goes in at its cheapest position, and the ride never exceeds T * DISTANCE_SLACK.
 *
 * `prefer` maps category ('cafe' | 'food' | 'sight' | 'other') to a weight; 0 excludes it.
 */
export function chooseStops({ start, end = start, candidates, distanceKm, maxStops = 3, prefer = {} }) {
  const budgetKm = distanceKm * DISTANCE_SLACK;
  const lambda = DISTANCE_WEIGHT / distanceKm;
  const tour = [start, end];
  const chosen = [];
  const remaining = candidates.filter((c) => c.affinity > 0);

  while (chosen.length < maxStops) {
    let best = null;
    for (const c of remaining) {
      const weight = prefer[c.category] ?? DEFAULT_PREFER[c.category] ?? 1;
      if (weight <= 0) continue;

      let insertAt = -1;
      let detourKm = Infinity;
      for (let i = 1; i < tour.length; i++) {
        const delta = roadKm(tour[i - 1], c) + roadKm(c, tour[i]) - roadKm(tour[i - 1], tour[i]);
        if (delta < detourKm) {
          detourKm = delta;
          insertAt = i;
        }
      }
      const lengthKm = tourKm(tour);
      if (lengthKm + detourKm > budgetKm) continue;

      const repeats = chosen.filter((s) => s.category === c.category).length;
      const fitChange = Math.abs(lengthKm + detourKm - distanceKm) - Math.abs(lengthKm - distanceKm);
      const score = c.affinity * weight * REPEAT_FACTOR ** repeats - lambda * fitChange;
      if (!best || score > best.score) best = { candidate: c, insertAt, detourKm, score };
    }
    if (!best || best.score <= 0) break;

    const stop = { ...best.candidate, score: round2(best.score), detourKm: round1(best.detourKm) };
    tour.splice(best.insertAt, 0, stop);
    chosen.push(stop);
    remaining.splice(remaining.indexOf(best.candidate), 1);
  }

  return { stops: tour.slice(1, -1), estimatedKm: round1(tourKm(tour)) };
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

const CATEGORY_LABEL = { cafe: 'Café', food: 'Food', sight: 'Sight', stay: 'Stay', other: 'Stop' };

/** A reason built only from the data, used until (or unless) the agent writes a better one. */
export function defaultReason(stop, tastes) {
  const names = tastes.map((t) => t.name);
  const who = names.length > 2 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names.join(' and ');
  const pct = Math.round(stop.affinity * 100);
  const source = stop.source === 'demo' ? 'Sample affinity' : 'Qloo affinity';
  return `${source} ${pct}% for people who like ${who}.`;
}

/** One favourite -> a Qloo tag (for food) or entity, or the reason it wasn't found. */
async function lookUpTaste(taste, deps) {
  try {
    if (taste.category === FOOD_CATEGORY) {
      const tag = await findTasteTag(taste.name, deps).catch(() => null);
      if (tag) return { query: taste.name, entity: { ...tag, kind: 'tag' } };
    }
    const category = taste.category === FOOD_CATEGORY ? undefined : taste.category;
    const entity = await findTasteEntity(taste.name, category, deps);
    return { query: taste.name, entity: entity && { ...entity, kind: 'entity' } };
  } catch (err) {
    return { query: taste.name, error: err.message };
  }
}

function foundTastes(lookups) {
  return lookups
    .filter((l) => l.entity)
    .map((l) => ({
      id: l.entity.id,
      name: l.entity.name,
      query: l.query,
      kind: l.entity.kind,
      type: l.entity.kind === 'tag' ? 'tag' : l.entity.types?.[0] ?? null,
    }));
}

async function resolvePoint(where, label, deps) {
  if (where && typeof where === 'object' && Number.isFinite(where.lat) && Number.isFinite(where.lon)) return where;
  const point = await geocode(String(where ?? ''), deps);
  if (!point) throw new PlanError(`Couldn't find the ${label} "${where}". Try a neighbourhood and city, e.g. "FC Road, Pune".`);
  return point;
}

/**
 * Full pipeline. `tastes` is a list of {name, category?}, e.g. {name: 'Studio Ghibli', category: 'movie'}.
 * `start` / `end` are place names or {lat, lon}. Leave `end` empty for a loop back to the start.
 * `deps.fetchImpl` replaces fetch for every network call (used by tests).
 */
export async function planRide({ start, end, distanceKm = 15, tastes = [], prefer = {}, maxStops = 3 }, deps = {}) {
  if (!tastes.length) throw new PlanError('Tell me at least one film, artist, food or place you love.');
  distanceKm = Math.min(Math.max(Number(distanceKm) || 15, 3), 120);
  maxStops = Math.min(Math.max(Math.round(Number(maxStops) || 3), 1), 6);

  const startPt = await resolvePoint(start, 'start', deps);
  const loop = !end || String(end).trim() === '';
  const endPt = loop ? startPt : await resolvePoint(end, 'finish', deps);

  let lookups = await Promise.all(tastes.map((t) => lookUpTaste(t, deps)));
  let found = foundTastes(lookups);
  const missing = lookups.filter((l) => !l.entity).map((l) => l.query);
  if (!found.length) {
    const reason = lookups.find((l) => l.error)?.error;
    throw new PlanError(`Qloo didn't recognise any of: ${missing.join(', ')}.${reason ? ` (${reason})` : ''}`);
  }

  // Search a circle that covers everywhere the ride could reach.
  const center = loop ? startPt : { lat: (startPt.lat + endPt.lat) / 2, lon: (startPt.lon + endPt.lon) / 2 };
  const radiusKm = loop ? distanceKm / 2 : Math.max(distanceKm / 2, haversineKm(startPt, endPt) / 2 + 2);
  let candidates = await findTastePlaces({ tastes: found, center, radiusKm, take: 50 }, deps).catch((err) => {
    if (!found.some((t) => t.kind === 'tag')) throw err;
    console.warn(`Qloo insights with food tags failed (${err.message}); retrying without tags`);
    return null;
  });
  // If food tags didn't work out, look those foods up as ordinary entities, as before tags existed.
  if (!candidates?.length && found.some((t) => t.kind === 'tag')) {
    lookups = await Promise.all(
      lookups.map((l) => (l.entity?.kind === 'tag' ? lookUpTaste({ name: l.query }, deps) : l)),
    );
    found = foundTastes(lookups);
    if (!found.length) throw new PlanError(`Qloo didn't recognise any of: ${tastes.map((t) => t.name).join(', ')}.`);
    candidates = await findTastePlaces({ tastes: found, center, radiusKm, take: 50 }, deps);
  }

  const { stops } = chooseStops({ start: startPt, end: endPt, candidates, distanceKm, maxStops, prefer });
  const route = await routeBike([startPt, ...stops, endPt], deps);

  return {
    start: startPt,
    end: endPt,
    loop,
    requestedKm: distanceKm,
    stops: stops.map((s, i) => ({
      ...s,
      order: i + 1,
      atKm: round1(route.legsKm.slice(0, i + 1).reduce((sum, km) => sum + km, 0)),
      why: defaultReason(s, found),
    })),
    route: { geometry: route.geometry, distanceKm: route.distanceKm, durationMin: route.durationMin, source: route.source },
    tastes: found,
    missingTastes: lookups.filter((l) => !l.entity).map((l) => l.query),
    candidatesConsidered: candidates.length,
    searchRadiusKm: round1(radiusKm),
    dataSource: qlooIsLive() ? 'qloo' : 'demo',
  };
}
