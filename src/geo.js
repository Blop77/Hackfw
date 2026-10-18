// Distances, geocoding (place name -> coordinates) and bike routing.

import { config } from './config.js';

const EARTH_RADIUS_KM = 6371;

// Roads are longer than straight lines. Used only when the routing service is unreachable.
export const ROAD_FACTOR = 1.3;

// Average leisure cycling speed, used for time estimates.
const CYCLING_KMH = 15;

/** Straight-line distance in km between two {lat, lon} points. */
export function haversineKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

function estimatedLegsKm(points) {
  return points.slice(1).map((p, i) => haversineKm(points[i], p) * ROAD_FACTOR);
}

/** Estimated riding length in km of a path through the given points. */
export function pathKm(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineKm(points[i - 1], points[i]);
  return total * ROAD_FACTOR;
}

// Used when the geocoder is unreachable, and so tests never need the network.
const KNOWN_PLACES = {
  pune: { lat: 18.5204, lon: 73.8567, label: 'Pune' },
  'fc road': { lat: 18.5236, lon: 73.841, label: 'FC Road, Pune' },
  'koregaon park': { lat: 18.5362, lon: 73.894, label: 'Koregaon Park, Pune' },
  'mit wpu': { lat: 18.5181, lon: 73.8155, label: 'MIT-WPU, Kothrud, Pune' },
  kothrud: { lat: 18.5074, lon: 73.8077, label: 'Kothrud, Pune' },
  mumbai: { lat: 19.076, lon: 72.8777, label: 'Mumbai' },
  bengaluru: { lat: 12.9716, lon: 77.5946, label: 'Bengaluru' },
  delhi: { lat: 28.6139, lon: 77.209, label: 'New Delhi' },
  london: { lat: 51.5074, lon: -0.1278, label: 'London' },
  'new york': { lat: 40.7128, lon: -74.006, label: 'New York' },
};

function knownPlace(query) {
  const q = query.trim().toLowerCase();
  if (KNOWN_PLACES[q]) return { ...KNOWN_PLACES[q] };
  const key = Object.keys(KNOWN_PLACES)
    .sort((a, b) => b.length - a.length)
    .find((k) => q.includes(k));
  return key ? { ...KNOWN_PLACES[key] } : null;
}

function parseLatLon(query) {
  const m = query.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
}

function userAgent() {
  // Nominatim's usage policy asks for an identifying User-Agent.
  return config.contactEmail ? `RideTaste/0.1 (${config.contactEmail})` : 'RideTaste/0.1';
}

/**
 * Turns "Koregaon Park, Pune" or "18.52, 73.85" into {lat, lon, label}.
 * Returns null if the place can't be found.
 */
export async function geocode(query, { fetchImpl = fetch } = {}) {
  if (!query || !query.trim()) return null;
  const direct = parseLatLon(query);
  if (direct) return direct;

  try {
    const url = `${config.geocodeUrl}/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': userAgent(), Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const [hit] = await res.json();
      if (hit) {
        return {
          lat: Number(hit.lat),
          lon: Number(hit.lon),
          label: String(hit.display_name || query).split(',').slice(0, 3).join(','),
        };
      }
    }
  } catch {
    // Fall through to the built-in list.
  }
  return knownPlace(query);
}

/**
 * Bike route through the points, as {geometry: [[lat, lon], ...], distanceKm, legsKm, durationMin, source}.
 * If the routing service fails, returns straight lines with an estimated distance.
 */
export async function routeBike(points, { fetchImpl = fetch } = {}) {
  const coords = points.map((p) => `${p.lon},${p.lat}`).join(';');
  try {
    const url = `${config.routingUrl}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': userAgent() },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json();
      const route = data.routes?.[0];
      if (data.code === 'Ok' && route?.geometry?.coordinates?.length) {
        const distanceKm = route.distance / 1000;
        const legs = Array.isArray(route.legs) && route.legs.length === points.length - 1 ? route.legs : null;
        return {
          geometry: route.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
          distanceKm: round1(distanceKm),
          legsKm: legs ? legs.map((l) => l.distance / 1000) : estimatedLegsKm(points),
          // The bike profile's durations assume fast riding; use a leisure pace instead.
          durationMin: Math.round((distanceKm / CYCLING_KMH) * 60),
          source: 'osrm',
        };
      }
    }
  } catch {
    // Fall through to the estimate.
  }
  const distanceKm = pathKm(points);
  return {
    geometry: points.map((p) => [p.lat, p.lon]),
    distanceKm: round1(distanceKm),
    legsKm: estimatedLegsKm(points),
    durationMin: Math.round((distanceKm / CYCLING_KMH) * 60),
    source: 'estimate',
  };
}

export function round1(x) {
  return Math.round(x * 10) / 10;
}
