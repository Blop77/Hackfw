// The RideTaste agent: Claude chats with the rider, calls plan_ride (Qloo + routing),
// then calls show_ride to explain each stop on the map.

import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { planRide, PlanError } from './planner.js';
import { TASTE_CATEGORIES } from './qloo.js';

const MAX_TOOL_ROUNDS = 6;

const SYSTEM_PROMPT = `You are RideTaste, a friendly cycling buddy who plans bike rides around the rider's taste.

How you work:
1. Find out where the rider starts, roughly how far they want to ride, and a few things they love (films, music, books, food, shows, places). If the start or the tastes are missing, ask one short question. If the distance is missing, assume 15 km and say so.
2. Call plan_ride. Put every favourite in "tastes" with the best-fitting category; use "food" for dishes, drinks and cuisines. Use "prefer" for wishes like "more food" (food: 2) or "no sightseeing" (sight: 0). Use "end" only when the rider wants to finish somewhere other than the start.
3. Then call show_ride once with one short "why" per stop (one sentence, under 25 words) and a two-sentence summary.
4. Finally reply in 2-4 short sentences. The map and stop cards already show the details, so don't list every stop again.

When the rider asks for changes ("shorter", "end near a lake", "more cafés"), call plan_ride again with updated inputs, then show_ride again.

Ground every claim in tool results. "affinity" is Qloo's estimate (0 to 1) of how much people with the rider's tastes like a place; it does not say which favourite caused the match, so don't claim one did. Don't invent opening hours, prices, menus or facts about a place. You may use the place's tags and category. If dataSource is "demo", tell the rider these are sample places, not live Qloo results. If missingTastes is not empty, mention that Qloo didn't recognise those. If route.source is "estimate", say the distance is approximate.

Keep it upbeat and brief. Mention road safety only if it is relevant (e.g. a long ride or a busy area).`;

const TOOLS = [
  {
    name: 'plan_ride',
    description:
      "Plans a bike ride. Looks up the rider's favourites in Qloo, finds nearby places people with those tastes like, picks the best stops within the distance and routes the ride. Returns the stops, distances and data source.",
    input_schema: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'Where the ride starts: neighbourhood and city, a landmark, or "lat,lon".' },
        end: { type: 'string', description: 'Where the ride ends. Omit to loop back to the start.' },
        distance_km: { type: 'number', description: 'Target ride length in km (3-120).' },
        tastes: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'e.g. "Spirited Away", "Prateek Kuhad", "masala dosa".' },
              category: {
                type: 'string',
                enum: TASTE_CATEGORIES,
                description: 'Use "food" for dishes, drinks and cuisines (e.g. "filter coffee", "ramen"); they are matched to Qloo taste tags.',
              },
            },
            required: ['name'],
          },
        },
        prefer: {
          type: 'object',
          description: 'Weights for stop types: 0 = exclude, 1 = normal, 2 = strongly prefer.',
          properties: {
            cafe: { type: 'number' },
            food: { type: 'number' },
            sight: { type: 'number' },
            stay: { type: 'number', description: 'Hotels and other places to stay. Excluded (0) unless the rider asks.' },
          },
        },
        max_stops: { type: 'integer', description: 'How many stops (1-6). Default 3.' },
      },
      required: ['start', 'tastes'],
    },
  },
  {
    name: 'show_ride',
    description: 'Shows the latest planned ride on the rider\'s map with a short reason for each stop. Call after plan_ride.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Two sentences describing the ride.' },
        reasons: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              stop_id: { type: 'string' },
              why: { type: 'string', description: 'One sentence on why this stop fits the rider.' },
            },
            required: ['stop_id', 'why'],
          },
        },
      },
      required: ['summary', 'reasons'],
    },
  },
];

/** What the model sees from a plan: enough to explain it, without the route geometry. */
function planForModel(plan) {
  return {
    dataSource: plan.dataSource,
    start: plan.start.label,
    end: plan.loop ? '(loop back to start)' : plan.end.label,
    requestedKm: plan.requestedKm,
    route: { distanceKm: plan.route.distanceKm, durationMin: plan.route.durationMin, source: plan.route.source },
    tastesRecognised: plan.tastes.map((t) => {
      const as = t.kind === 'tag' ? ' (Qloo taste tag)' : '';
      return t.name === t.query ? `${t.name}${as}` : `${t.query} -> ${t.name}${as}`;
    }),
    missingTastes: plan.missingTastes,
    candidatesConsidered: plan.candidatesConsidered,
    stops: plan.stops.map((s) => ({
      stop_id: s.id,
      order: s.order,
      name: s.name,
      category: s.category,
      affinity: Math.round(s.affinity * 100) / 100,
      atKm: s.atKm,
      tags: s.tags,
      address: s.address,
    })),
  };
}

function asString(x) {
  return typeof x === 'string' ? x : '';
}

async function runTool(name, input, session, planDeps) {
  if (name === 'plan_ride') {
    const tastes = (Array.isArray(input.tastes) ? input.tastes : [])
      .map((t) => ({ name: asString(t?.name).trim(), category: asString(t?.category) }))
      .filter((t) => t.name);
    try {
      const plan = await planRide({
        start: asString(input.start),
        end: asString(input.end),
        distanceKm: input.distance_km,
        tastes,
        prefer: input.prefer && typeof input.prefer === 'object' ? input.prefer : {},
        maxStops: input.max_stops,
      }, planDeps);
      session.ride = plan;
      if (!plan.stops.length) {
        return { content: JSON.stringify({ ...planForModel(plan), note: 'No stops fit. Suggest a longer distance or different tastes.' }) };
      }
      return { content: JSON.stringify(planForModel(plan)) };
    } catch (err) {
      const message = err instanceof PlanError ? err.message : `Planning failed: ${err.message}`;
      return { content: message, isError: true };
    }
  }

  if (name === 'show_ride') {
    if (!session.ride) return { content: 'No ride planned yet. Call plan_ride first.', isError: true };
    const reasons = new Map(
      (Array.isArray(input.reasons) ? input.reasons : []).map((r) => [asString(r?.stop_id), asString(r?.why)]),
    );
    session.ride = {
      ...session.ride,
      summary: asString(input.summary),
      stops: session.ride.stops.map((s) => (reasons.get(s.id) ? { ...s, why: reasons.get(s.id) } : s)),
    };
    return { content: 'Shown on the map.' };
  }

  return { content: `Unknown tool ${name}`, isError: true };
}

export function createAgent({ client, planDeps } = {}) {
  const anthropic = client ?? new Anthropic({ apiKey: config.anthropicApiKey });

  /** Runs one rider message through the agent. `session` keeps {messages, ride} between calls. */
  async function chat(session, userText) {
    // Append-only history: earlier turns (including thinking blocks) are never edited.
    session.messages.push({ role: 'user', content: userText });

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const response = await anthropic.beta.messages.create({
        model: config.model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: session.messages,
      });
      session.messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'refusal') {
        return { reply: "Sorry, I can't help with that one. Want to plan a ride instead?", ride: session.ride ?? null };
      }
      if (response.stop_reason === 'pause_turn') continue;

      const toolUses = response.content.filter((b) => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || !toolUses.length) {
        const reply = response.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        return { reply: reply || 'Your ride is on the map.', ride: session.ride ?? null };
      }

      // All tool results go back in a single user message.
      const results = [];
      for (const use of toolUses) {
        const { content, isError } = await runTool(use.name, use.input ?? {}, session, planDeps);
        results.push({ type: 'tool_result', tool_use_id: use.id, content, ...(isError ? { is_error: true } : {}) });
      }
      session.messages.push({ role: 'user', content: results });
    }

    return { reply: 'That took more steps than expected. Your latest ride is on the map.', ride: session.ride ?? null };
  }

  return { chat };
}
