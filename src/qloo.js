// Qloo Taste AI client. Turns favourites into Qloo entities, then asks Qloo
// which nearby places people with those tastes like.
//
// API reference: https://docs.qloo.com (Insights API: /search and /v2/insights).
// The response parsing is deliberately tolerant: it accepts the field names used
// by current and earlier versions of the API.

import { config, qlooIsLive } from './config.js';
import { DEMO_CENTER, DEMO_PLACES, demoAffinity } from './demo-data.js';
import { haversineKm } from './geo.js';

// What the user can say they like, mapped to Qloo entity types.
export const TASTE_TYPES = {
  artist: 'urn:entity:artist',
  album: 'urn:entity:album',
  movie: 'urn:entity:movie',
  tv_show: 'urn:entity:tv_show',
  book: 'urn:entity:book',
  podcast: 'urn:entity:podcast',
  videogame: 'urn:entity:videogame',
  brand: 'urn:entity:brand',
  person: 'urn:entity:person',
  place: 'urn:entity:place',
  destination: 'urn:entity:destination',
};

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
  cafe: ['cafe', 'café', 'coffee', 'tea', 'bakery', 'dessert', 'juice', 'ice cream'],
  food: ['restaurant', 'food', 'dining', 'diner', 'eatery', 'bistro', 'kitchen', 'bar', 'pub', 'street food', 'dhaba'],
  sight: ['park', 'garden', 'museum', 'monument', 'landmark', 'historic', 'temple', 'fort', 'lake', 'viewpoint', 'gallery', 'trail', 'hill', 'beach', 'attraction'],
};

/** Puts a place into 'cafe', 'food', 'sight' or 'other' using its tags and name. */
export function categorize(tags, name = '') {
  const text = [...tags, name].join(' | ').toLowerCase();
  for (const category of ['cafe', 'food', 'sight']) {
    if (CATEGORY_WORDS[category].some((w) => text.includes(w))) return category;
  }
  return 'other';
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
 * Places near `center` that people with these tastes like, best first.
 * `tastes` is a list of {id, name} from findTasteEntity.
 */
export async function findTastePlaces({ tastes, center, radiusKm, take = 40 }, { fetchImpl = fetch } = {}) {
  if (!qlooIsLive()) return demoPlaces({ tastes, center, radiusKm });

  const json = await qlooGet(
    '/v2/insights',
    {
      'filter.type': 'urn:entity:place',
      'signal.interests.entities': tastes.map((t) => t.id).join(','),
      'filter.location': `POINT(${center.lon} ${center.lat})`,
      'filter.location.radius': Math.round(radiusKm * 1000),
      take,
    },
    fetchImpl,
  );
  return parseInsightPlaces(json).sort((a, b) => b.affinity - a.affinity);
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
