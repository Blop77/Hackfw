import assert from 'node:assert/strict';
import { test } from 'node:test';
import { config } from '../src/config.js';
import { chooseStops, planRide, PlanError } from '../src/planner.js';
import { FC_ROAD, offlineFetch } from './helpers.js';

config.qlooApiKey = ''; // demo data

// Points roughly north of FC Road, about 1 km apart.
const place = (id, category, affinity, northKm) => ({
  id,
  name: id,
  category,
  affinity,
  lat: FC_ROAD.lat + northKm / 111,
  lon: FC_ROAD.lon,
});

test('chooseStops picks high-affinity stops within the distance budget', () => {
  const candidates = [
    place('near-cafe', 'cafe', 0.8, 1),
    place('far-sight', 'sight', 0.95, 30), // far beyond a 10 km ride
    place('near-food', 'food', 0.7, 2),
  ];
  const { stops, estimatedKm } = chooseStops({ start: FC_ROAD, candidates, distanceKm: 10, maxStops: 3 });
  assert.deepEqual(stops.map((s) => s.id).sort(), ['near-cafe', 'near-food']);
  assert.ok(estimatedKm <= 10 * 1.15);
});

test('chooseStops stretches a short ride towards the requested distance', () => {
  const candidates = [place('near-cafe', 'cafe', 0.8, 0.5), place('far-sight', 'sight', 0.6, 5)];
  const { stops, estimatedKm } = chooseStops({ start: FC_ROAD, candidates, distanceKm: 15 });
  assert.deepEqual(stops.map((s) => s.id).sort(), ['far-sight', 'near-cafe']);
  assert.ok(estimatedKm >= 10, `got ${estimatedKm} km`);
});

test('chooseStops respects maxStops', () => {
  const candidates = [1, 2, 3, 4].map((i) => place(`p${i}`, 'sight', 0.9, i * 0.5));
  assert.equal(chooseStops({ start: FC_ROAD, candidates, distanceKm: 20, maxStops: 2 }).stops.length, 2);
});

test('chooseStops: a preference of 0 excludes a category', () => {
  const candidates = [place('sight', 'sight', 0.99, 1), place('cafe', 'cafe', 0.5, 1.5)];
  const { stops } = chooseStops({ start: FC_ROAD, candidates, distanceKm: 10, prefer: { sight: 0 } });
  assert.deepEqual(stops.map((s) => s.id), ['cafe']);
});

test('chooseStops prefers variety over three of the same kind', () => {
  const candidates = [
    place('cafe1', 'cafe', 0.8, 1),
    place('cafe2', 'cafe', 0.79, 1.2),
    place('cafe3', 'cafe', 0.78, 1.4),
    place('food', 'food', 0.7, 1.1),
  ];
  const { stops } = chooseStops({ start: FC_ROAD, candidates, distanceKm: 10, maxStops: 3 });
  assert.ok(stops.some((s) => s.id === 'food'), `got ${stops.map((s) => s.id)}`);
});

test('chooseStops orders stops along the ride and reports detours', () => {
  const candidates = [place('far', 'cafe', 0.8, 3), place('near', 'food', 0.8, 1)];
  const { stops } = chooseStops({ start: FC_ROAD, end: place('end', 'other', 0, 4), candidates, distanceKm: 12 });
  assert.deepEqual(stops.map((s) => s.id), ['near', 'far']);
  assert.ok(stops.every((s) => s.detourKm >= 0));
});

test('planRide (demo data) returns an explained loop ride', async () => {
  const ride = await planRide(
    { start: FC_ROAD, distanceKm: 15, tastes: [{ name: 'Spirited Away', category: 'movie' }, { name: 'masala dosa' }] },
    { fetchImpl: offlineFetch },
  );
  assert.equal(ride.dataSource, 'demo');
  assert.equal(ride.loop, true);
  // What the "How Qloo picked these stops" panel shows.
  assert.deepEqual(ride.tastes.map((t) => [t.query, t.type]), [['Spirited Away', 'urn:entity:movie'], ['masala dosa', null]]);
  assert.equal(ride.searchRadiusKm, 7.5);
  assert.ok(ride.candidatesConsidered >= ride.stops.length);
  assert.ok(ride.stops.length >= 1 && ride.stops.length <= 3);
  assert.deepEqual(ride.stops.map((s) => s.order), ride.stops.map((_, i) => i + 1));
  for (const s of ride.stops) assert.match(s.why, /^Sample affinity \d+% for people who like Spirited Away and masala dosa\.$/);
  const atKm = ride.stops.map((s) => s.atKm);
  assert.deepEqual(atKm, [...atKm].sort((a, b) => a - b));
  assert.ok(atKm.at(-1) <= ride.route.distanceKm);
  assert.equal(ride.route.source, 'estimate');
  assert.ok(ride.route.distanceKm <= 15 * 1.15 + 0.1);
});

test('planRide geocodes text starts and supports one-way rides', async () => {
  const ride = await planRide(
    { start: 'FC Road, Pune', end: 'Koregaon Park, Pune', distanceKm: 20, tastes: [{ name: 'coffee' }] },
    { fetchImpl: offlineFetch },
  );
  assert.equal(ride.loop, false);
  assert.equal(ride.end.label, 'Koregaon Park, Pune');
});

test('planRide explains what went wrong', async () => {
  await assert.rejects(planRide({ start: FC_ROAD, tastes: [] }), PlanError);
  await assert.rejects(
    planRide({ start: 'Nowhere-ville', tastes: [{ name: 'x' }] }, { fetchImpl: offlineFetch }),
    /Couldn't find the start "Nowhere-ville"/,
  );
});
