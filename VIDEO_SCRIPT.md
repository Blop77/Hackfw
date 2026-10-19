# RideTaste demo video script (about 2 minutes)

Record this **after the Qloo key works**, with the badge showing **Live Qloo data**. Judges score how
well you use Qloo, so the video should show real Qloo results and say clearly where Qloo comes in.

**Setup:** the deployed app in a clean browser window (no bookmarks bar), zoomed to 110–125% so text is
readable. Have your phone ready for the last scene. Do one practice run first so the Render app
is awake and the first reply isn't slow.

**Tools:** OBS Studio or the Windows Game Bar (Win + G) for screen recording; your phone for the riding
clip. Speak slowly and keep it upbeat. Show the real app; never fake results.

---

## 0:00–0:15 · The problem (talking to camera, or riding footage)

> "I ride my bike around Pune almost every weekend. Picking the route is easy. Deciding *where to stop* is the hard part.
> Map apps show me the nearest café, not one I'd actually like."

*Show:* a few seconds of you riding, or a map app showing generic "cafés near me".

## 0:15–0:25 · Introduce RideTaste

> "So I built RideTaste: an AI agent that plans bike rides around your taste, using Qloo's Taste AI."

*Show:* the app's home screen, with the **Live Qloo data** badge visible.

## 0:25–0:55 · Chat with the agent

Type a real message, for example:

> *"I'm starting from FC Road, Pune and want to ride about 15 km. I love Spirited Away, Prateek Kuhad and masala dosa."*

> "I just tell it what I love: a film, a musician, a food. The agent sends each of those to Qloo's
> Search API and turns them into Qloo entities. Then it asks Qloo's Insights API which places near me
> people with that taste enjoy."

*Show:* the message being sent and the reply appearing.

## 0:55–1:25 · The ride

> "Now I get a 15 km loop with three stops. Each one has a match score from Qloo and a reason it fits me.
> The planner balances taste against distance, so the ride comes out close to the length I asked for."

*Show:* zoom into the map, scroll through the stop cards, and point at the match % and the "why" text.
**Say the actual stop names and numbers you see.** Don't read the ones from this script.

## 1:25–1:45 · Change it by chatting

Click the **More food** chip, or type *"Make it shorter and end near a lake."*

> "It's a real agent, so I can just say what I want changed and it re-plans with Qloo."

*Show:* the new ride appearing on the map.

## 1:45–1:55 · Take it on the road

> "One tap exports the ride as GPX for Strava, Komoot or a bike computer."

*Show:* clicking **Download GPX**, then a few seconds of the ride on your phone or bike.

## 1:55–2:05 · Close

> "Qloo is what makes this work: it's the only thing that connects 'I love Spirited Away' to a café
> I'd actually like. RideTaste: bike rides planned around your taste. The code is open source on GitHub."

*Show:* the app, then the GitHub repo page.

---

## Checklist before uploading

- [ ] The badge says **Live Qloo data**, not Demo data
- [ ] Every stop name and number you mention matches what's on screen
- [ ] No API keys, emails or private info visible anywhere (check the browser tabs and the Render dashboard)
- [ ] Under 3 minutes; Devpost judges often stop watching after that
- [ ] Uploaded to YouTube as **Public** or **Unlisted** (not Private), link pasted into Devpost
- [ ] Background music, if any, is royalty-free (e.g. YouTube Audio Library)
