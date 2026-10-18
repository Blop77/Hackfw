import assert from 'node:assert/strict';
import { test } from 'node:test';
import { geocode, haversineKm, routeBike } from '../src/geo.js';
import { FC_ROAD, fakeFetch, offlineFetch } from './helpers.js';

test('haversine: Pune to Mumbai is about 120 km', () => {
  const km = haversineKm({ lat: 18.5204, lon: 73.8567 }, { lat: 19.076, lon: 72.8777 });
  assert.ok(km > 115 && km < 125, `got ${km}`);
});

test('geocode accepts "lat,lon" without calling the network', async () => {
  const p = await geocode('18.5236, 73.841', { fetchImpl: offlineFetch });
  assert.equal(p.lat, 18.5236);
  assert.equal(p.lon, 73.841);
});

test('geocode falls back to built-in places when offline', async () => {
  const p = await geocode('Koregaon Park, Pune', { fetchImpl: offlineFetch });
  assert.equal(p.label, 'Koregaon Park, Pune');
});

test('geocode uses Nominatim results when available', async () => {
  const fetchImpl = fakeFetch([['/search', [{ lat: '18.5', lon: '73.8', display_name: 'Somewhere, Pune, Maharashtra, India' }]]]);
  const p = await geocode('Somewhere', { fetchImpl });
  assert.deepEqual(p, { lat: 18.5, lon: 73.8, label: 'Somewhere, Pune, Maharashtra' });
});

test('geocode returns null for unknown places when offline', async () => {
  assert.equal(await geocode('Nowhere-ville', { fetchImpl: offlineFetch }), null);
});

test('routeBike parses an OSRM route', async () => {
  const fetchImpl = fakeFetch([
    ['/route/v1/', { code: 'Ok', routes: [{ distance: 15000, duration: 2400, legs: [{ distance: 7000 }, { distance: 8000 }], geometry: { coordinates: [[73.84, 18.52], [73.85, 18.53]] } }] }],
  ]);
  const r = await routeBike([FC_ROAD, { lat: 18.53, lon: 73.85 }, FC_ROAD], { fetchImpl });
  assert.equal(r.source, 'osrm');
  assert.equal(r.distanceKm, 15);
  assert.equal(r.durationMin, 60); // 15 km at a 15 km/h leisure pace
  assert.deepEqual(r.geometry[0], [18.52, 73.84]); // flipped to [lat, lon]
  assert.deepEqual(r.legsKm, [7, 8]);
});

test('routeBike falls back to straight lines when routing is down', async () => {
  const r = await routeBike([FC_ROAD, { lat: 18.53, lon: 73.85 }, FC_ROAD], { fetchImpl: offlineFetch });
  assert.equal(r.source, 'estimate');
  assert.equal(r.geometry.length, 3);
  assert.ok(r.distanceKm > 0);
});
