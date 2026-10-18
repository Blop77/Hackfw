import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAgent } from '../src/agent.js';
import { config } from '../src/config.js';
import { offlineFetch } from './helpers.js';

config.qlooApiKey = ''; // demo data

/** A stand-in for the Anthropic client that replays scripted responses. */
function scriptedClient(responses) {
  const requests = [];
  return {
    requests,
    beta: {
      messages: {
        create: async (params) => {
          requests.push(structuredClone(params));
          const next = responses.shift();
          if (!next) throw new Error('no more scripted responses');
          return typeof next === 'function' ? next(params) : next;
        },
      },
    },
  };
}

const toolUse = (id, name, input) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] });

test('agent plans a ride, attaches reasons and replies', async () => {
  const client = scriptedClient([
    toolUse('t1', 'plan_ride', { start: '18.5236,73.841', distance_km: 12, tastes: [{ name: 'Studio Ghibli', category: 'movie' }] }),
    (params) => {
      const result = params.messages.at(-1).content[0];
      assert.equal(result.type, 'tool_result');
      assert.equal(result.tool_use_id, 't1');
      const plan = JSON.parse(result.content);
      assert.equal(plan.dataSource, 'demo');
      const first = plan.stops[0];
      return toolUse('t2', 'show_ride', {
        summary: 'A calm loop.',
        reasons: [{ stop_id: first.stop_id, why: 'Quiet and green, like a Ghibli film.' }],
      });
    },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Your ride is ready! (sample data)' }] },
  ]);

  const agent = createAgent({ client, planDeps: { fetchImpl: offlineFetch } });
  const session = { messages: [], ride: null };
  const { reply, ride } = await agent.chat(session, 'Ride from FC Road, I love Studio Ghibli');

  assert.equal(reply, 'Your ride is ready! (sample data)');
  assert.equal(ride.summary, 'A calm loop.');
  assert.equal(ride.stops[0].why, 'Quiet and green, like a Ghibli film.');
  assert.equal(client.requests.length, 3);

  // Request shape: model, refusal fallbacks, effort.
  const req = client.requests[0];
  assert.equal(req.model, config.model);
  assert.equal(req.fallbacks, 'default');
  assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.deepEqual(req.output_config, { effort: 'medium' });
  assert.deepEqual(req.tools.map((t) => t.name), ['plan_ride', 'show_ride']);
});

test('history is append-only across turns', async () => {
  const client = scriptedClient([
    { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: 'Where do you start?' }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Got it.' }] },
  ]);
  const agent = createAgent({ client });
  const session = { messages: [], ride: null };
  await agent.chat(session, 'Plan me a ride');
  const firstTurn = structuredClone(session.messages);
  await agent.chat(session, 'From Kothrud');
  assert.deepEqual(session.messages.slice(0, firstTurn.length), firstTurn);
  assert.deepEqual(client.requests[1].messages.slice(0, firstTurn.length), firstTurn);
});

test('planning errors go back to the model as tool errors', async () => {
  const client = scriptedClient([
    toolUse('t1', 'plan_ride', { start: 'Nowhere-ville', tastes: [{ name: 'jazz' }] }),
    (params) => {
      const result = params.messages.at(-1).content[0];
      assert.equal(result.is_error, true);
      assert.match(result.content, /Couldn't find the start/);
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Which city are you in?' }] };
    },
  ]);
  const agent = createAgent({ client, planDeps: { fetchImpl: offlineFetch } });
  const { reply, ride } = await agent.chat({ messages: [], ride: null }, 'Ride from Nowhere-ville');
  assert.equal(reply, 'Which city are you in?');
  assert.equal(ride, null);
});

test('show_ride before plan_ride is rejected', async () => {
  const client = scriptedClient([
    toolUse('t1', 'show_ride', { summary: 'x', reasons: [] }),
    (params) => {
      assert.equal(params.messages.at(-1).content[0].is_error, true);
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
    },
  ]);
  await createAgent({ client }).chat({ messages: [], ride: null }, 'hi');
});

test('a refusal gets a friendly reply', async () => {
  const client = scriptedClient([{ stop_reason: 'refusal', content: [] }]);
  const { reply } = await createAgent({ client }).chat({ messages: [], ride: null }, '...');
  assert.match(reply, /plan a ride instead/);
});
