# ROCKET.AI

Design ridiculous fictional rockets by talking to an AI engineer, then launch them and watch what happens. This is a game: every number is a made-up simulation value.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
```

No API key is needed: a local keyword interpreter plays the engineer. To use a hosted model through OpenRouter instead, copy `.env.example` to `.env.local` and set `OPENROUTER_API_KEY` (optionally `OPENROUTER_MODEL`, any model that supports structured outputs). The app detects it via `GET /api/ai` and falls back to the local engineer if a call fails.

## Pages

- `/` — construction bay: prompt, watch the rocket change, launch, mission report, repair, share.
- `/explore` — infinite feed of seeded and procedurally generated community rockets; REMIX loads one into the bay.
- `/r/[id]` — shared rocket page. The id is either a community slug (`c-…`, `g-…`) or the whole rocket encoded in the URL. Add `?card=1` for a 1200×630 share card with PNG export.

## Architecture

| Concern | Where |
| --- | --- |
| Rocket config types, defaults, limits, schema validation | `src/lib/rocket/{types,defaults,limits,schema}.ts` |
| Applying actions to a config (pure) | `src/lib/rocket/apply.ts` |
| Procedural generation: config → positioned parts, nozzles, labels | `src/lib/rocket/layout.ts` |
| Fictional stats and joke meters | `src/lib/rocket/stats.ts` |
| AI action schema and output validation | `src/lib/ai/actions.ts` |
| Provider interface, local engineer, remote provider, auto-fallback | `src/lib/ai/{provider,local-provider,local-interpreter,remote-provider,client}.ts` |
| Server model client (OpenRouter, structured outputs) and route | `src/lib/ai/server/*`, `src/app/api/ai/route.ts` |
| Launch simulation (outcome + event timeline, seeded) | `src/lib/sim/simulate.ts` |
| 3D rendering (R3F): parts, animated rocket, bay, launch scene, particles, thumbnails | `src/components/three/*` |
| UI | `src/components/ui/*`, `src/components/Builder.tsx`, `src/components/explore/*`, `src/components/share/*` |
| State (undo/redo, history, launch flow) | `src/lib/store.ts` |
| Persistence and sharing | `src/lib/persistence.ts`, `src/lib/share.ts`, `src/lib/feed/community.ts` |
| Sound hooks (synthesised WebAudio) | `src/lib/sound.ts` |

The model only ever returns JSON actions. Each action is validated against a Zod schema and clamped to hard limits before it touches the rocket; nothing the model returns is executed. Adding a provider means implementing `ModelClient` (server) or `AIProvider` (client).
