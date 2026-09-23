# ROCKET.JDADDY

Design ridiculous fictional rockets by talking to an AI engineer, then launch them and watch what happens. This is a game: every number is a made-up simulation value.

## Layout

- `web/` — the Next.js app, built as a static export (`web/out`).
- `cmd/api`, `internal/` — the Go API. It serves `/api/*` and the embedded static export, and holds the OpenRouter key.

## Run

```bash
cp .env.example .env   # set OPENROUTER_API_KEY
make run               # api on :8080 (air), web on http://localhost:3000
make fmt
make lint
```

`next dev` proxies `/api` to the Go API. Without `OPENROUTER_API_KEY` the API still starts and the app falls back to its local keyword engineer. `OPENROUTER_MODEL` can select another model that supports structured outputs. The app detects the provider via `GET /api/ai`. API docs are at `/api/docs`.

## Docker production

```bash
docker compose up --build -d
```

The image builds the static export, embeds it in the Go binary, and serves everything on one port: http://localhost:3002. Compose reads `OPENROUTER_API_KEY` from `.env` and refuses to start without it. Stop it with `docker compose down`.

The Deploy workflow runs on the self-hosted GitHub Actions runner, reads the repository's `OPENROUTER_API_KEY` secret and checks `/api/ai` after starting the container.

## Pages

- `/` — construction bay: prompt, watch the rocket change, launch, mission report, repair, share.
- `/explore` — infinite feed of seeded and procedurally generated community rockets; REMIX loads one into the bay.
- `/r?id=…` — shared rocket page. The id is either a community slug (`c-…`, `g-…`) or the whole rocket encoded in the URL. Add `&card=1` for a 1200×630 share card with PNG export. Old `/r/{id}` links redirect here.

## Architecture

| Concern | Where |
| --- | --- |
| Rocket config types, defaults, limits, schema validation | `web/src/lib/rocket/{types,defaults,limits,schema}.ts` |
| Applying actions to a config (pure) | `web/src/lib/rocket/apply.ts` |
| Procedural generation: config → positioned parts, nozzles, labels | `web/src/lib/rocket/layout.ts` |
| Fictional stats and joke meters | `web/src/lib/rocket/stats.ts` |
| AI action schema and output validation | `web/src/lib/ai/actions.ts` |
| Provider interface, local engineer, remote provider, auto-fallback | `web/src/lib/ai/{provider,local-provider,local-interpreter,remote-provider,client}.ts` |
| Hosted engineer (OpenRouter via `joakimcarlsson/ai`, structured outputs) and endpoint | `internal/engineer`, `internal/httpx/ai_endpoint.go` |
| Launch simulation (outcome + event timeline, seeded) | `web/src/lib/sim/simulate.ts` |
| 3D rendering (R3F): parts, animated rocket, bay, launch scene, particles, thumbnails | `web/src/components/three/*` |
| UI | `web/src/components/ui/*`, `web/src/components/Builder.tsx`, `web/src/components/explore/*`, `web/src/components/share/*` |
| State (undo/redo, history, launch flow) | `web/src/lib/store.ts` |
| Persistence and sharing | `web/src/lib/persistence.ts`, `web/src/lib/share.ts`, `web/src/lib/feed/community.ts` |
| Sound hooks (synthesised WebAudio) | `web/src/lib/sound.ts` |

The model only ever returns JSON actions. Each action is validated against a Zod schema and clamped to hard limits before it touches the rocket; nothing the model returns is executed. Adding a client-side provider means implementing `AIProvider`.
