# RideTaste 🚲

**An AI agent that plans bike rides around your taste.**

Tell it the films, music and food you love, where you're starting and how far you want to ride.
RideTaste asks **Qloo's Taste AI** which cafés, food spots and sights people with your taste enjoy,
picks the best stops that fit your distance, draws the route on a map and explains why each stop suits you.

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com) (2026).

---

## How it works

```
 rider ──chat──► Claude agent ──plan_ride──► 1. geocode start (OpenStreetMap Nominatim)
                     │                       2. favourites → Qloo entities      (Qloo /search)
                     │                       3. entities + location → places   (Qloo /v2/insights)
                     │                       4. pick stops (taste vs distance)
                     │                       5. bike route through the stops   (OSRM bike profile)
                     │◄──── stops, affinities, distances ────┘
                     └──show_ride──► map + stop cards with "why this fits you"
```

**Qloo is the core of the app.** Without it there's no way to go from "I love *Spirited Away* and
Prateek Kuhad" to "this café and this lake". Qloo's cross-domain taste graph makes that jump:
your favourites become `signal.interests.entities` and the location becomes `filter.location`
on a `urn:entity:place` insights query. Each place comes back with an **affinity** score.

**Choosing stops.** The planner greedily inserts stops at their cheapest point in the ride. Each round it
picks the place with the best score:

$$\text{score} = \text{affinity} \times \text{preference} \times 0.75^{\text{repeats}} - \lambda \cdot \Delta\lvert L - T \rvert$$

- *preference* is the rider's weight for cafés, food or sights. "No sightseeing" sets sights to 0.
- *repeats* counts chosen stops of the same type, so rides mix cafés, food and sights.
- *L* is the ride length so far, *T* the requested distance and $\lambda = 0.6 / T$. While the ride is too
  short, a detour helps. Once it's long enough, a detour costs. The ride never goes over $1.15\,T$.

**The agent** (Claude, through the Anthropic API) runs the conversation. It asks for anything missing,
turns favourites into typed tastes (movie, artist, food…), calls `plan_ride`, and handles changes
like "shorter", "more food" or "end near a lake". It then calls `show_ride` to write a one-line reason for
each stop. It is told to base every claim on the tool data and never invent opening hours or prices.

## Features

- Chat-based planning with follow-up changes, plus a quick-plan form that works without the AI agent
- Loop rides or one-way rides (start A, finish B)
- Taste-matched stops with a match score and a reason for each
- Real bike routing on OpenStreetMap, with "at km X" for each stop
- **Download GPX** to load the ride into Strava, Komoot or a bike computer
- Works on phones, with light and dark mode
- **Demo mode**: without a Qloo key it runs on clearly labelled sample data for Pune, so anyone can try the app

## Run it locally

You need Node.js 20.12 or newer.

```bash
git clone https://github.com/Blop77/Hackfw.git ridetaste
cd ridetaste
npm install
cp .env.example .env      # add your keys (optional, see below)
npm start                 # http://localhost:3000
```

| Variable | Needed for | Without it |
|---|---|---|
| `ANTHROPIC_API_KEY` | The chat agent | Only the quick-plan form works |
| `QLOO_API_KEY` | Real taste-matched places | Uses **sample data** for Pune (shown with a "Demo data" badge) |
| `QLOO_BASE_URL` | The Qloo API host given with your key | Defaults to `https://hackathon.api.qloo.com` |

Run the tests (no network or keys needed):

```bash
npm test
```

## Deploy

The repo includes a [Render](https://render.com) blueprint (`render.yaml`):

1. In Render, choose **New → Blueprint** and pick this repository.
2. Enter `ANTHROPIC_API_KEY` and `QLOO_API_KEY` when asked.
3. Render builds and gives you a public URL. Use it as the demo link on Devpost.

Any Node host works: run `npm ci && npm start` and set `PORT`.

## Project layout

| File | What it does |
|---|---|
| `src/agent.js` | Claude agent loop, system prompt and the `plan_ride` / `show_ride` tools |
| `src/planner.js` | The pipeline and the stop-picking algorithm |
| `src/qloo.js` | Qloo client (`/search`, `/v2/insights`) with tolerant response parsing |
| `src/geo.js` | Distances, geocoding, bike routing, with offline fallbacks |
| `src/demo-data.js` | Sample data for demo mode (not from Qloo) |
| `src/server.js` | HTTP server and JSON API |
| `public/` | Web app (plain HTML/CSS/JS + Leaflet) |
| `tests/` | Unit and API tests (`node --test`) |

## Limitations

- Qloo's place coverage varies by city. If results look thin, try a bigger city.
- Distances are approximate when the public routing service is unavailable. The app says when that happens.
- The public OpenStreetMap geocoder and router have fair-use limits. Fine for a demo, not for heavy traffic.
- Chat sessions are kept in memory and reset when the server restarts.
- Always check the route yourself before riding. RideTaste doesn't know about traffic, road works or closures.

## Credits

- Taste data: [Qloo](https://www.qloo.com) Taste AI
- AI agent: [Claude](https://www.anthropic.com) by Anthropic
- Maps, geocoding and routing: [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors,
  [Nominatim](https://nominatim.org), [OSRM](https://project-osrm.org) (bike profile hosted by FOSSGIS)
- Map library: [Leaflet](https://leafletjs.com) 1.9.4 (BSD-2-Clause, bundled in `public/vendor/leaflet`)

## License

MIT. See [LICENSE](LICENSE).
