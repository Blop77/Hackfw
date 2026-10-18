import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { config } from '../src/config.js';
import { createApp } from '../src/server.js';
import { offlineFetch } from './helpers.js';

config.qlooApiKey = ''; // demo data

let server;
let base;
const chats = [];

before(async () => {
  const agent = {
    chat: async (session, message) => {
      chats.push({ session, message });
      return { reply: `echo: ${message}`, ride: null };
    },
  };
  server = createApp({ agent, planDeps: { fetchImpl: offlineFetch } });
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const post = (path, body) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('GET /api/status reports agent and data mode', async () => {
  const res = await fetch(`${base}/api/status`);
  assert.deepEqual(await res.json(), { agent: true, qloo: 'demo' });
});

test('POST /api/plan returns a ride from comma-separated tastes', async () => {
  const res = await post('/api/plan', { start: '18.5236,73.841', distanceKm: 12, tastes: 'Spirited Away, masala dosa' });
  assert.equal(res.status, 200);
  const { ride } = await res.json();
  assert.equal(ride.tastes.length, 2);
  assert.ok(ride.stops.length > 0);
});

test('POST /api/plan explains bad input with 422', async () => {
  const res = await post('/api/plan', { start: '18.5,73.8', tastes: '' });
  assert.equal(res.status, 422);
  assert.match((await res.json()).error, /at least one/);
});

test('POST /api/chat keeps a session across messages', async () => {
  const first = await (await post('/api/chat', { message: 'hello' })).json();
  assert.equal(first.reply, 'echo: hello');
  const second = await (await post('/api/chat', { sessionId: first.sessionId, message: 'again' })).json();
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(chats.at(-1).session, chats.at(-2).session);
});

test('POST /api/chat rejects empty messages and bad JSON', async () => {
  assert.equal((await post('/api/chat', { message: '  ' })).status, 400);
  const res = await fetch(`${base}/api/chat`, { method: 'POST', body: '{not json' });
  assert.equal(res.status, 400);
});

test('serves the web app and blocks path traversal', async () => {
  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<title>RideTaste<\/title>/);
  const sneaky = await fetch(`${base}/..%2fpackage.json`);
  assert.notEqual(sneaky.status, 200);
});
