# Devpost submission draft: RideTaste

Paste-ready text for https://qloo.devpost.com. Fill in everything marked **TODO** after testing with
the real Qloo key, and don't claim anything you haven't checked.

---

## Project name (≤ 60)

```
RideTaste: AI Bike Rides Planned Around Your Taste
```

## Elevator pitch (≤ 200)

```
Tell the agent the films, music and food you love. It plans a bike ride with café and food stops picked by Qloo's taste AI, and explains why each stop fits you.
```

## About the project (Markdown)

```markdown
## Inspiration
I ride my bike a lot around Pune, and the hardest part of a weekend ride isn't the route, it's deciding *where to stop*. Map apps show me the nearest café, not the one I'd actually like. I wanted a riding buddy who knows my taste: if I love lo-fi music, Studio Ghibli films and South Indian food, the ride should go past places that fit that vibe.

## What it does
RideTaste is an AI agent that plans bike rides around your taste.
1. You chat with it: say where you're starting, roughly how far you want to ride, and a few films, artists, foods or books you love.
2. The agent turns your favourites into Qloo entities and asks **Qloo's Taste AI** for places near you that people with your taste enjoy.
3. It picks 1–6 stops that fit your distance, routes the ride for a bike, and shows it on a map with a short reason for each stop.
4. You can change it: "shorter", "more food, less sightseeing", "end near a lake".
5. You can download the ride as **GPX** for Strava, Komoot or a bike computer.

## How I built it
- **Qloo Insights API:** `/search` resolves each favourite to a Qloo entity, and `/v2/insights` with `filter.type=urn:entity:place`, `signal.interests.entities` and `filter.location` returns nearby places with an affinity score. Qloo is the core of the app: without it there's no link from "I love Spirited Away" to "this café".
- **Agent:** Claude (Anthropic API) with two tools. `plan_ride` runs the pipeline and `show_ride` writes a grounded one-line reason for each stop. The system prompt tells it to use only tool data, never invent opening hours or prices, and say when data is sample or approximate.
- **Choosing stops:** a greedy planner inserts each stop at its cheapest point in the ride and scores candidates by taste and distance fit:

$$\text{score} = \text{affinity} \times \text{preference} \times 0.75^{\text{repeats}} - \lambda \cdot \Delta\lvert L - T \rvert$$

where *L* is the current ride length, *T* the requested distance and \\( \lambda = 0.6/T \\). While the ride is too short a detour helps; once it's long enough a detour costs. The 0.75 repeat factor mixes cafés, food and sights.
- **Maps:** OpenStreetMap geocoding (Nominatim), bike routing (OSRM bike profile) and Leaflet.
- **Stack:** Node.js with no framework, plain HTML/CSS/JS and 35 automated tests (`node --test`).

## Challenges I ran into
- **Rides came out far too short.** My first scoring rule just penalised detours, so a 15 km request gave a 5 km ride, because the best-matching places were all close together. Scoring by how much a stop moves the ride *towards the requested distance* fixed it.
- **Honest explanations.** Qloo's affinity says how much people with your taste like a place, not *which* favourite caused it. I had to stop the agent from claiming "because you like X".
- **Working without keys.** I built a clearly labelled demo mode and offline fallbacks for geocoding and routing, so the app and its tests run anywhere.
- TODO: anything you hit when you switch to the live Qloo key (e.g. coverage in Pune).

## Accomplishments that I'm proud of
- TODO (e.g. the first real ride you took with it)

## What I learned
- TODO (e.g. agent tool design, the Qloo taste graph, routing APIs)

## What's next for RideTaste
- Group rides that blend everyone's taste
- Opening hours, elevation and traffic-aware routing
- Save and share favourite rides
```

## How to test (add to the end of "About the project")

```markdown
## Try it in 30 seconds
1. Open the live demo: <RENDER URL>. If the first load is slow, the free server is waking up; give it up to a minute.
2. Click one of the **"Try one"** examples (e.g. *Ghibli & filter coffee · Pune*). The agent plans a ride with Qloo.
3. Open **"How Qloo picked these stops"** under the map to see the Qloo entities, the places Qloo returned, and how the stops were chosen.
4. In the chat, tap **More food** or type *"make it shorter and end near a lake"* to watch the agent re-plan.
5. Click **Download GPX** to take the ride into Strava, Komoot or a bike computer.
```

## Built with

```
javascript, node.js, qloo, claude, anthropic-api, leaflet, openstreetmap, osrm, nominatim, html5, css3, render
```

## Try it out links

- GitHub: https://github.com/Blop77/Hackfw
- Live demo: TODO (Render URL after deploying)

## Media

- Screenshots (3:2): chat and map, stop cards, mobile view
- Video: TODO 1–2 minute screen recording on YouTube
