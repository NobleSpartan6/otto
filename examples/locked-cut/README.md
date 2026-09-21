# Locked Cut

An isolated Otto creative experiment: a changed brief selects a different six-shot sequence while locked slots and a twelve-second duration stay fixed. It is not a video editor or a computer-use benchmark.

```sh
npm run demo:locked-cut
# http://127.0.0.1:5188
npm run test:locked-cut
npx tsc -p examples/locked-cut/tsconfig.json
```

No dependencies or models need downloading. The development server binds to loopback. Do not expose it publicly. No native build is required.

## Try the interaction

1. In the default **authored fixture** mode, click Make another cut for Quiet anticipation.
2. Lock any shot. Select Fast reveal and make another cut.
3. Play, pause or select a shot to seek. The locked slot and its two-second trim remain unchanged. Previous cut restores the prior sequence and clears locks explicitly.
4. Studio setup → import 8–12 videos you own. Supported browser codecs, distinct simple filenames, and a duration of at least two seconds are required. Give each clip descriptive tags; transcripts are optional. Import does not upload or copy the video files.
5. Choose Hosted TypeSafe Jev and enter a key in the session-only password field, or start the server with `TYPESAFE_API_KEY` already set. No saved Otto key is extracted. Never paste keys into a task conversation.
6. Ask for a cut. Only metadata and the brief go to TypeSafe; no video, pixels or audio. An unclear/invalid choice or provider failure holds the existing cut. There is no automatic retry or silent fixture fallback.

Fixture mode supports only the two preset briefs and never calls a model. It has ten authored test slates, not invented footage. Refreshing clears the in-memory project and key. Imported media playback is muted and always uses source seconds 0–2.

## The actual decision boundary

`sequence.ts` builds a bounded set of rotations and reversed rotations from eligible shots, reserving every locked slot. This deliberately does not search all permutations or guarantee the best edit is among the candidates. `decision.ts` uses Otto's existing TypeSafe serializer/parser (`core/typesafe.ts`) to make **one actual typed choice request** over the whole candidates plus a hold option. The model judges user-supplied tags/transcripts. Deterministic code validates distinct shots, locks, source duration and total timing before applying the result.

The prototype requires provider confidence ≥0.5 and a top-two probability margin ≥0.02. These are explicit, uncalibrated heuristics; they are not probabilities of editorial success. Last decision evidence retains the request associated with its result. A later brief edit does not rewrite that record. Export may include your supplied metadata; inspect it before sharing.

## Diffusion Studio handoff

Diffusion source downloads `index.tsx`. Put it in a new folder, then open that folder in Diffusion Studio. For imported clips, put the originals in that folder's `assets/` with their original simple filenames. The JSX defines a six-clip sequence, explicit source trims, a 1920×1080 scene and muted playback. The fixture export renders unmistakable test slates.

A separate exported fixture project was opened and captured in Diffusion Studio. The structural checks below describe that fixture only; no video-export or real-footage quality result is established.

## Evidence and limits

- Exhaustive 64 lock combinations across all constructed candidates pass: exact slot/trim preservation, six distinct shots and twelve seconds.
- One serializer/parser integration test uses **simulated transport**, not live Jev inference. It verifies a typed choice request and response path without claiming creative quality.
- Missing key, all locks, low confidence and provider failure preserve the current cut. Media/export validation is tested.
- Browser: fixture re-cut preserves a locked third shot; keyboard focus reaches Previous cut; 390px layout remains usable; missing-key path holds the cut. Eight tiny authored video test patterns imported and decoded at 160×90; playback and seeking were exercised. These test patterns are not user footage.
- Diffusion structural check: 12 seconds, six groups, zero issues. Captures at 0/4/10 seconds show expected slate IDs 01/03/06.
- **Live Jev inference, real owned-footage creative quality, open-model integration, savings and novelty are not established.** A session key and owned clips are required for a live demonstration.

Hosted Jev is TypeSafe's external model, documented at https://docs.typesafe.ai/introduction. No open-model backend is implemented. Otto's source license does not make hosted Jev open source.

## 40-second recording plan

This is a plan, not an already recorded demonstration. Keep fixture labels visible until owned footage and live inference have been verified.

- 0–6s: play the first cut, with the brief visible.
- 6–11s: pause; lock the strongest shot. Show its highlighted slot.
- 11–18s: switch the brief and request a cut. Retain the real waiting interval, or label any speed change in the edit.
- 18–30s: play the new sequence. The locked shot returns at exactly the same time; the surrounding selection changes.
- 30–35s: show the two strips or use Previous cut for a short comparison.
- 35–40s: show the resulting sequence in Diffusion Studio. End on the picture, not a claims slide.

For a public-facing demo, use owned media, record the actual model result (including a hold if that is what it returns), and save its evidence. Capture only the demo window; do not record the key field. Edit that recording in a fresh Diffusion project. Do not imply the fixture run establishes model performance.
