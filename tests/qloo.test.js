import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { config } from '../src/config.js';
import {
  categorize,
  clearQlooCache,
  findTasteEntity,
  findTastePlaces,
  findTasteTag,
  parseInsightPlaces,
  parseSearchResults,
  parseTagResults,
  pickFoodTag,
  qlooTiming,
} from '../src/qloo.js';
import { FC_ROAD, fakeFetch } from './helpers.js';

const realKey = config.qlooApiKey;
qlooTiming.retryBaseMs = 1; // keep retry tests fast

afterEach(() => {
  config.qlooApiKey = realKey;
  clearQlooCache();
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
  assert.equal(categorize(['Gym']), 'errand');
  assert.equal(categorize(['Rooftop', 'Sunset']), 'other');
  assert.equal(categorize(['urn:tag:category:place:coffee_shop']), 'cafe');
});

test('categorize matches whole words and lets the most matching tags win', () => {
  // Real tags from a live ride: an Asian restaurant was labelled a café.
  assert.equal(categorize(['Lunch reservations recommended', 'Elegant', 'Asian restaurant', 'Free parking lot'], 'Coriander Kitchen'), 'food');
  assert.equal(categorize(['Coffee and tea', 'Delivery', 'Osho garden', 'Reservations required'], 'Koji'), 'cafe');
  assert.equal(categorize(['Steakhouse']), 'food'); // not "tea"
  assert.equal(categorize(['Barber shop']), 'errand'); // a service, and not "bar" (food)
  assert.equal(categorize(['Hotel', 'Restaurant']), 'stay');
  assert.equal(categorize(['Business meetings', 'Morning', 'City view', 'Laundry service']), 'stay');
});

test('categorize: whole districts and cities are areas, not stops', () => {
  // Real tags from a live Pune ride, where "Pune city" came out as a stop.
  assert.equal(categorize(['Central urban district', 'City center', 'Dining drinking', 'Casual'], 'Pune city'), 'area');
  assert.equal(categorize(['Coffee and tea', 'Honey chilli potato', 'Social', 'City center'], 'FC Road SOCIAL'), 'cafe');
});

test('categorize: an area stays an area even when sight tags outnumber the district tag', () => {
  // The live "Pune city" entity: its hidden tags out-voted "Central urban district" and it became a Sight.
  const tags = ['Central urban district', 'City center', 'Dining drinking', 'Casual', 'Culinary discovery', 'Central', 'Historic', 'Landmark'];
  assert.equal(categorize(tags, 'Pune city'), 'area');
  assert.equal(categorize(['Historic', 'Landmark', 'Attraction'], 'Pune city'), 'area'); // by name alone
  assert.equal(categorize(['Historic', 'Landmark'], 'Shaniwar Wada'), 'sight');
  assert.equal(categorize(['Coffee and tea', 'City center', 'Central'], 'Cafe Goodluck'), 'cafe');
  assert.equal(categorize(['Restaurant', 'City center'], 'City Pride Kitchen'), 'food'); // "City" only counts at the end of a name
});

test('categorize: shops and services are errands, whatever else they are tagged', () => {
  // The live stop that replaced "Pune city", plus a hidden sight tag.
  const tags = ['Beauty products wholesaler', 'Personal grooming', 'Clean', 'Destination', 'Urban', 'Commercial', 'Historic', 'Temple'];
  assert.equal(categorize(tags, 'Indrani Cosmetics'), 'errand');
  assert.equal(categorize(['Hair salon'], 'Looks'), 'errand');
  assert.equal(categorize(['Coffee and tea', 'Groups of friends'], 'FC Road SOCIAL'), 'cafe');
  assert.equal(categorize(['Bakery', 'Restaurant', 'Delivery'], 'German Bakery'), 'cafe'); // as on the live ride
  assert.equal(categorize(['Barbecue', 'Bar'], 'Barbeque Nation'), 'food'); // "barber" isn't "bar", and vice versa
});

test('categorize: theatres and music venues are culture, and the name outweighs a generic tag', () => {
  // Real tags from a live New York ride, where both came out as "Food".
  assert.equal(categorize(['Sophisticated', 'Debit cards', 'City center', 'Dining drinking'], 'Minskoff Theatre'), 'culture');
  assert.equal(categorize(['Cultural history', 'Central', 'Music theory', 'Stylish', 'Restaurant'], 'Jazz At Lincoln Center'), 'culture');
  assert.equal(categorize(['Basketball court', 'Bike storage', 'Fine dining', 'Sophisticated'], 'One Hudson Yards'), 'food');
  assert.equal(categorize(['Lunch reservations recommended', 'Asian restaurant'], 'Coriander Kitchen'), 'food');
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

test('parseTagResults and pickFoodTag choose a close, place-related tag', () => {
  const tags = parseTagResults({
    results: {
      tags: [
        { id: 'urn:tag:genre:book:cooking', name: 'Cooking', types: ['urn:entity:book'] },
        { id: 'urn:tag:genre:place:restaurant:south_indian', name: 'South Indian', types: ['urn:entity:place'] },
        { tag_id: 'urn:tag:category:place:coffee_shop', name: 'Coffee Shop' },
        { id: 'not-a-tag', name: 'Broken' },
      ],
    },
  });
  assert.deepEqual(tags.map((t) => t.id), [
    'urn:tag:genre:book:cooking',
    'urn:tag:genre:place:restaurant:south_indian',
    'urn:tag:category:place:coffee_shop',
  ]);
  assert.equal(pickFoodTag(tags, 'filter coffee').id, 'urn:tag:category:place:coffee_shop');
  assert.equal(pickFoodTag(tags, 'south indian').id, 'urn:tag:genre:place:restaurant:south_indian');
  assert.equal(pickFoodTag(tags, 'masala dosa'), null); // no shared word: better to fall back than guess
});

test('live mode: findTasteTag queries /v2/tags', async () => {
  config.qlooApiKey = 'test-key';
  const fetchImpl = fakeFetch([['/v2/tags', { results: { tags: [{ id: 'urn:tag:category:place:ramen', name: 'Ramen' }] } }]]);
  const tag = await findTasteTag('ramen', { fetchImpl });
  assert.equal(tag.id, 'urn:tag:category:place:ramen');
  assert.equal(new URL(fetchImpl.calls[0]).searchParams.get('filter.query'), 'ramen');
});

test('live mode: findTastePlaces sends entities and tags as separate signals', async () => {
  config.qlooApiKey = 'test-key';
  const fetchImpl = fakeFetch([['/v2/insights', { results: { entities: [] } }]]);
  await findTastePlaces(
    { tastes: [{ id: 'E1', kind: 'entity' }, { id: 'urn:tag:x', kind: 'tag' }], center: FC_ROAD, radiusKm: 5 },
    { fetchImpl },
  );
  const url = new URL(fetchImpl.calls[0]);
  assert.equal(url.searchParams.get('signal.interests.entities'), 'E1');
  assert.equal(url.searchParams.get('signal.interests.tags'), 'urn:tag:x');
});

test('live mode: retries when Qloo rate-limits, then succeeds', async () => {
  config.qlooApiKey = 'test-key';
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls < 3) return new Response('slow down', { status: 429 });
    return new Response(JSON.stringify({ results: [{ entity_id: 'E1', name: 'Coldplay', types: ['urn:entity:artist'] }] }));
  };
  const e = await findTasteEntity('Coldplay', 'artist', { fetchImpl });
  assert.equal(e.id, 'E1');
  assert.equal(calls, 3);
});

test('live mode: gives up after a few rate-limited retries', async () => {
  config.qlooApiKey = 'test-key';
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return new Response('slow down', { status: 429 });
  };
  await assert.rejects(findTasteEntity('Coldplay', 'artist', { fetchImpl }), /HTTP 429/);
  assert.equal(calls, 4); // first try + 3 retries
});

test('live mode: repeated look-ups are served from the cache', async () => {
  config.qlooApiKey = 'test-key';
  const fetchImpl = fakeFetch([['/search', { results: [{ entity_id: 'E1', name: 'Coldplay', types: [] }] }]]);
  await Promise.all([findTasteEntity('Coldplay', null, { fetchImpl }), findTasteEntity('Coldplay', null, { fetchImpl })]);
  await findTasteEntity('Coldplay', null, { fetchImpl });
  assert.equal(fetchImpl.calls.length, 1);
});

test('live mode: at most two Qloo requests run at once', async () => {
  config.qlooApiKey = 'test-key';
  let running = 0;
  let peak = 0;
  const fetchImpl = async (url) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    const q = new URL(String(url)).searchParams.get('query');
    return new Response(JSON.stringify({ results: [{ entity_id: q, name: q, types: [] }] }));
  };
  const names = ['a', 'b', 'c', 'd', 'e', 'f'];
  const found = await Promise.all(names.map((n) => findTasteEntity(n, null, { fetchImpl })));
  assert.deepEqual(found.map((e) => e.id), names);
  assert.equal(peak, 2);
});
