// Qloo Taste AI client. Turns favourites into Qloo entities, then asks Qloo
// which nearby places people with those tastes like.
//
// API reference: https://docs.qloo.com (/search, /v2/tags and /v2/insights).
// The response parsing is deliberately tolerant: it accepts the field names used
// by current and earlier versions of the API.

import { config, qlooIsLive } from './config.js';
import { DEMO_CENTER, DEMO_PLACES, demoAffinity } from './demo-data.js';
import { haversineKm } from './geo.js';

// What the user can say they like, mapped to the entity types in Qloo's hackathon guide.
export const TASTE_TYPES = {
  artist: 'urn:entity:artist',
  movie: 'urn:entity:movie',
  tv_show: 'urn:entity:tv_show',
  book: 'urn:entity:book',
  podcast: 'urn:entity:podcast',
  video_game: 'urn:entity:video_game',
  brand: 'urn:entity:brand',
  person: 'urn:entity:person',
  place: 'urn:entity:place',
  destination: 'urn:entity:destination',
};

// Dishes, drinks and cuisines aren't Qloo entities, so they're looked up as Qloo tags instead.
export const FOOD_CATEGORY = 'food';
export const TASTE_CATEGORIES = [...Object.keys(TASTE_TYPES), FOOD_CATEGORY];

export class QlooError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'QlooError';
    this.status = status;
  }
}

async function qlooGet(path, params, fetchImpl) {
  const url = new URL(config.qlooBaseUrl + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const res = await fetchImpl(url, {
    headers: { 'X-Api-Key': config.qlooApiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new QlooError(`Qloo ${path} returned HTTP ${res.status}: ${body.slice(0, 300)}`, res.status);
  }
  return res.json();
}

// ---------- Parsing (exported for tests) ----------

export function parseSearchResults(json) {
  const list = Array.isArray(json?.results) ? json.results : json?.results?.entities ?? [];
  return list
    .filter((e) => e && (e.entity_id || e.id) && e.name)
    .map((e) => ({
      id: String(e.entity_id ?? e.id),
      name: String(e.name),
      types: Array.isArray(e.types) ? e.types : e.type ? [e.type] : [],
    }));
}

export function parseTagResults(json) {
  const r = json?.results;
  const list = Array.isArray(r) ? r : r?.tags ?? json?.tags ?? [];
  return list
    .map((t) => ({
      id: String(t?.id ?? t?.tag_id ?? t?.urn ?? ''),
      name: String(t?.name ?? ''),
      types: [...(Array.isArray(t?.types) ? t.types : []), ...(Array.isArray(t?.parents) ? t.parents.map((p) => p?.id ?? p) : [])].map(String),
    }))
    .filter((t) => t.id.startsWith('urn:tag:') && t.name);
}

/** Best tag for a food word: place-related tags first, then the closest name. */
export function pickFoodTag(tags, query) {
  const q = query.trim().toLowerCase();
  const isPlaceTag = (t) => t.id.includes(':place') || t.types.some((x) => x.includes('urn:entity:place'));
  const nameScore = (t) => {
    const n = t.name.toLowerCase();
    if (n === q) return 3;
    if (n.includes(q) || q.includes(n)) return 2;
    return q.split(/\s+/).some((word) => word.length > 2 && n.includes(word)) ? 1 : 0;
  };
  const ranked = tags
    .map((t) => ({ t, score: nameScore(t) * 2 + (isPlaceTag(t) ? 1 : 0) }))
    .filter((x) => x.score >= 2) // the name must at least share a word with the query
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.t ?? null;
}

function pickNumber(...values) {
  for (const v of values) {
    const n = typeof v === 'string' ? Number(v) : v;
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  }
  return null;
}

function tagNames(entity) {
  const tags = entity.tags ?? entity.properties?.tags ?? [];
  return tags
    .map((t) => (typeof t === 'string' ? t : t?.name ?? t?.tag_id ?? t?.id))
    .filter(Boolean)
    .map(String);
}

const CATEGORY_WORDS = {
  stay: ['hotel', 'resort', 'hostel', 'motel', 'lodging', 'guest house', 'homestay', 'laundry service', 'room service'],
  food: ['restaurant', 'food', 'dining', 'diner', 'eatery', 'bistro', 'kitchen', 'bar', 'pub', 'street food', 'dhaba', 'grill', 'steakhouse', 'pizzeria', 'brewery', 'lunch', 'dinner'],
  cafe: ['cafe', 'café', 'coffee', 'coffee shop', 'tea', 'tea house', 'teahouse', 'bakery', 'dessert', 'juice', 'ice cream', 'patisserie'],
  sight: ['park', 'garden', 'museum', 'monument', 'landmark', 'historic', 'temple', 'fort', 'lake', 'viewpoint', 'gallery', 'trail', 'hill', 'beach', 'attraction'],
};

// Whole words only, so "tea" doesn't match "steakhouse" and "bar" doesn't match "barber".
const CATEGORY_PATTERNS = Object.fromEntries(
  Object.entries(CATEGORY_WORDS).map(([category, words]) => [
    category,
    words.map((w) => new RegExp(`(?<![\\p{L}])${w}(?![\\p{L}])`, 'iu')),
  ]),
);

/**
 * Puts a place into 'stay', 'food', 'cafe', 'sight' or 'other' using its tags and name.
 * The category with the most matching tags wins; ties go in the order listed above.
 */
export function categorize(tags, name = '') {
  const texts = [...tags, name].map((t) => String(t).replace(/[_:]/g, ' '));
  let best = 'other';
  let bestHits = 0;
  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    const hits = texts.filter((text) => patterns.some((re) => re.test(text))).length;
    if (hits > bestHits) {
      best = category;
      bestHits = hits;
    }
  }
  return best;
}

export function parseInsightPlaces(json) {
  const list = json?.results?.entities ?? (Array.isArray(json?.results) ? json.results : []);
  const places = [];
  for (const e of list) {
    const lat = pickNumber(e.location?.lat, e.location?.latitude, e.properties?.geocode?.latitude, e.properties?.latitude);
    const lon = pickNumber(e.location?.lon, e.location?.lng, e.location?.longitude, e.properties?.geocode?.longitude, e.properties?.longitude);
    if (!e?.name || lat === null || lon === null) continue;
    const tags = tagNames(e);
    places.push({
      id: String(e.entity_id ?? e.id ?? `${e.name}@${lat},${lon}`),
      name: String(e.name),
      lat,
      lon,
      affinity: pickNumber(e.query?.affinity, e.affinity, e.query?.score) ?? 0,
      category: categorize(tags, e.name),
      tags: tags.slice(0, 6),
      address: e.properties?.address ?? null,
      rating: pickNumber(e.properties?.business_rating, e.properties?.rating),
      source: 'qloo',
    });
  }
  return places;
}

// ---------- Public API ----------

/**
 * Finds the Qloo entity for one favourite, e.g. ("Studio Ghibli", "movie").
 * Returns the best match or null.
 */
export async function findTasteEntity(name, category, { fetchImpl = fetch } = {}) {
  const type = TASTE_TYPES[category];
  if (!qlooIsLive()) {
    return { id: `demo-taste:${name.toLowerCase()}`, name, types: type ? [type] : [], demo: true };
  }
  const json = await qlooGet('/search', { query: name, take: 5 }, fetchImpl);
  const results = parseSearchResults(json);
  return (type && results.find((r) => r.types.includes(type))) || results[0] || null;
}

/**
 * Finds the Qloo tag for a dish, drink or cuisine, e.g. "masala dosa" -> a South Indian tag.
 * Returns {id, name, types} or null when no tag is a close enough match.
 */
export async function findTasteTag(name, { fetchImpl = fetch } = {}) {
  if (!qlooIsLive()) return { id: `demo-tag:${name.toLowerCase()}`, name, types: [], demo: true };
  const json = await qlooGet('/v2/tags', { 'filter.query': name, take: 10 }, fetchImpl);
  return pickFoodTag(parseTagResults(json), name);
}

/**
 * Places near `center` that people with these tastes like, best first.
 * `tastes` is a list of {id, name, kind}: kind 'tag' for findTasteTag results, otherwise an entity.
 */
export async function findTastePlaces({ tastes, center, radiusKm, take = 40 }, { fetchImpl = fetch } = {}) {
  if (!qlooIsLive()) return demoPlaces({ tastes, center, radiusKm });

  const ids = (kind) => tastes.filter((t) => (t.kind === 'tag') === (kind === 'tag')).map((t) => t.id).join(',');
  const json = await qlooGet(
    '/v2/insights',
    {
      'filter.type': 'urn:entity:place',
      'signal.interests.entities': ids('entity'),
      'signal.interests.tags': ids('tag'),
      'filter.location': `POINT(${center.lon} ${center.lat})`,
      'filter.location.radius': Math.round(radiusKm * 1000),
      take,
    },
    fetchImpl,
  );
  const places = parseInsightPlaces(json).sort((a, b) => b.affinity - a.affinity);
  // Qloo silently ignores invalid parameters, so log enough to spot an empty or far-away result.
  const nearby = places.filter((p) => haversineKm(center, p) <= radiusKm).length;
  console.info(`Qloo insights: ${places.length} places, ${nearby} within ${Math.round(radiusKm)} km of ${center.label ?? 'start'}`);
  return places;
}

function demoPlaces({ tastes, center, radiusKm }) {
  // The sample data only covers Pune.
  if (haversineKm(center, DEMO_CENTER) > 40) return [];
  const names = tastes.map((t) => t.name);
  return DEMO_PLACES.filter((p) => haversineKm(center, p) <= radiusKm)
    .map((p) => ({
      id: p.id,
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      affinity: demoAffinity(p, names),
      category: p.category,
      tags: p.tags,
      address: null,
      rating: null,
      source: 'demo',
    }))
    .sort((a, b) => b.affinity - a.affinity);
}
