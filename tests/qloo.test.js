import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { config } from '../src/config.js';
import { categorize, findTasteEntity, findTastePlaces, parseInsightPlaces, parseSearchResults } from '../src/qloo.js';
import { FC_ROAD, fakeFetch } from './helpers.js';

const realKey = config.qlooApiKey;
afterEach(() => {
  config.qlooApiKey = realKey;
});

test('parseSearchResults reads entity ids, names and types', () => {
  const json = {
    results: [
      { entity_id: 'E1', name: 'Spirited Away', types: ['urn:entity:movie'] },
      { name: 'no id' },
      { id: 'E2', name: 'Spirited Away (soundtrack)', type: 'urn:entity:album' },
    ],
  };
  assert.deepEqual(parseSearchResults(json), [
    { id: 'E1', name: 'Spirited Away', types: ['urn:entity:movie'] },
    { id: 'E2', name: 'Spirited Away (soundtrack)', types: ['urn:entity:album'] },
  ]);
});

test('parseInsightPlaces handles location, affinity and tags in different shapes', () => {
  const json = {
    results: {
      entities: [
        {
          entity_id: 'P1',
          name: 'Blue Door Coffee',
          location: { lat: 18.52, lon: 73.84 },
          query: { affinity: 0.91 },
          tags: [{ name: 'Coffee Shop' }, { name: 'Wifi' }],
          properties: { address: 'FC Road', business_rating: 4.5 },
        },
        {
          id: 'P2',
          name: 'Old Fort',
          properties: { geocode: { latitude: '18.51', longitude: '73.85' } },
          affinity: 0.5,
          tags: ['Historic Landmark'],
        },
        { entity_id: 'P3', name: 'No location' },
      ],
    },
  };
  const places = parseInsightPlaces(json);
  assert.equal(places.length, 2);
  assert.deepEqual(
    places.map((p) => [p.id, p.lat, p.lon, p.affinity, p.category]),
    [
      ['P1', 18.52, 73.84, 0.91, 'cafe'],
      ['P2', 18.51, 73.85, 0.5, 'sight'],
    ],
  );
  assert.equal(places[0].address, 'FC Road');
  assert.equal(places[0].rating, 4.5);
});

test('categorize sorts places by tags and name', () => {
  assert.equal(categorize(['Coffee Shop']), 'cafe');
  assert.equal(categorize(['Indian Restaurant']), 'food');
  assert.equal(categorize([], 'Pashan Lake'), 'sight');
  assert.equal(categorize(['Gym']), 'other');
  assert.equal(categorize(['urn:tag:category:place:coffee_shop']), 'cafe');
});

test('categorize matches whole words and lets the most matching tags win', () => {
  // Real tags from a live ride: an Asian restaurant was labelled a café.
  assert.equal(categorize(['Lunch reservations recommended', 'Elegant', 'Asian restaurant', 'Free parking lot'], 'Coriander Kitchen'), 'food');
  assert.equal(categorize(['Coffee and tea', 'Delivery', 'Osho garden', 'Reservations required'], 'Koji'), 'cafe');
  assert.equal(categorize(['Steakhouse']), 'food'); // not "tea"
  assert.equal(categorize(['Barber shop']), 'other'); // not "bar"
  assert.equal(categorize(['Hotel', 'Restaurant']), 'stay');
  assert.equal(categorize(['Business meetings', 'Morning', 'City view', 'Laundry service']), 'stay');
});

test('live mode: findTasteEntity prefers the requested type', async () => {
  config.qlooApiKey = 'test-key';
  const fetchImpl = fakeFetch([
    ['/search', { results: [
      { entity_id: 'ALBUM', name: 'Spirited Away', types: ['urn:entity:album'] },
      { entity_id: 'MOVIE', name: 'Spirited Away', types: ['urn:entity:movie'] },
    ] }],
  ]);
  const e = await findTasteEntity('Spirited Away', 'movie', { fetchImpl });
  assert.equal(e.id, 'MOVIE');
  assert.match(fetchImpl.calls[0], /\/search\?query=Spirited\+Away/);
});

test('live mode: findTastePlaces sends taste and location signals and sorts by affinity', async () => {
  config.qlooApiKey = 'test-key';
  const fetchImpl = fakeFetch([
    ['/v2/insights', { results: { entities: [
      { entity_id: 'A', name: 'Cafe A', location: { lat: 18.52, lon: 73.84 }, query: { affinity: 0.4 }, tags: [{ name: 'Cafe' }] },
      { entity_id: 'B', name: 'Cafe B', location: { lat: 18.53, lon: 73.84 }, query: { affinity: 0.8 }, tags: [{ name: 'Cafe' }] },
    ] } }],
  ]);
  const places = await findTastePlaces({ tastes: [{ id: 'E1' }, { id: 'E2' }], center: FC_ROAD, radiusKm: 7.5 }, { fetchImpl });
  assert.deepEqual(places.map((p) => p.id), ['B', 'A']);
  const url = new URL(fetchImpl.calls[0]);
  assert.equal(url.searchParams.get('filter.type'), 'urn:entity:place');
  assert.equal(url.searchParams.get('signal.interests.entities'), 'E1,E2');
  assert.equal(url.searchParams.get('filter.location'), 'POINT(73.841 18.5236)');
  assert.equal(url.searchParams.get('filter.location.radius'), '7500');
});

test('live mode: Qloo errors surface with the HTTP status', async () => {
  config.qlooApiKey = 'bad-key';
  const fetchImpl = fakeFetch([['/search', { error: 'unauthorized' }, 401]]);
  await assert.rejects(findTasteEntity('x', undefined, { fetchImpl }), /HTTP 401/);
});

test('demo mode: sample places only, marked as demo, boosted by matching tastes', async () => {
  config.qlooApiKey = '';
  const places = await findTastePlaces({ tastes: [{ name: 'Studio Ghibli' }], center: FC_ROAD, radiusKm: 10 });
  assert.ok(places.length > 3);
  assert.ok(places.every((p) => p.source === 'demo'));
  assert.ok(places.findIndex((p) => p.id === 'demo-okayama') < places.findIndex((p) => p.id === 'demo-kelkar'));
});

test('demo mode: no sample data outside Pune', async () => {
  config.qlooApiKey = '';
  const places = await findTastePlaces({ tastes: [{ name: 'jazz' }], center: { lat: 51.5, lon: -0.12 }, radiusKm: 10 });
  assert.deepEqual(places, []);
});
