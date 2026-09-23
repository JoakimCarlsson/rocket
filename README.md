# ROCKET.JDADDY

Design ridiculous fictional rockets by talking to an AI engineer, then launch them and watch what happens. This is a game: every number is a made-up simulation value.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
```

For local development, a local keyword interpreter can play the engineer. Production requires `OPENROUTER_API_KEY`: copy `.env.example` to `.env.local` and set the key. `OPENROUTER_MODEL` can select another model that supports structured outputs. The app detects the provider via `GET /api/ai` and falls back to the local engineer if a call fails.

## Docker production

Set `OPENROUTER_API_KEY` in `.env.local`, then build and start the production container:

```bash
docker compose --env-file .env.local up --build -d
```

The app is available at http://localhost:3002. `OPENROUTER_MODEL` is optional; Compose requires the API key before starting. Stop it with `docker compose down`.

Pushes to `main` also deploy through the self-hosted GitHub Actions runner. The workflow reads the repository's `OPENROUTER_API_KEY` secret and checks `/api/ai` after starting the container.

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
