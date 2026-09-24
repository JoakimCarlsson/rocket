# ROCKET.JDADDY

Design ridiculous fictional rockets by talking to an AI engineer, then launch them and watch what happens. Flights run on a simplified textbook physics model (rocket equation, drag, gravity, staging, stability); it is a game, not an engineering tool.

## Layout

- `web/` — the Next.js app, built as a static export (`web/out`).
- `cmd/api`, `internal/` — the Go API. It serves `/api/*` and the embedded static export, holds the OpenRouter key, and runs the flight physics so launch results cannot be forged in the browser.

## Run

```bash
cp .env.example .env   # set OPENROUTER_API_KEY
make run               # api on :8080 (air), web on http://localhost:3000
make fmt
make lint
```

`next dev` proxies `/api` to the Go API. Without `OPENROUTER_API_KEY` the API still starts but the AI engineer is offline. `OPENROUTER_MODEL` can select another model that supports structured outputs. The app detects the provider via `GET /api/ai`. API docs are at `/api/docs`.

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
| Shape helpers for rendering: stack heights, radii, fin planform, decor anchors | `web/src/lib/rocket/geometry.ts` |
| Physics engine: config validation, vehicle model (KSP-style propellants, nozzles, masses, Barrowman centre of pressure, drag), Kerbin-sized planet and atmosphere, analysis (TWR, Δv per burn, static margin, reliability) | `internal/physics/{rocket,geometry,vehicle,planet,analyze}.go` |
| Flight: RK4 over planar translation and rigid-body pitch around a rotating planet, gimbal and reaction-wheel attitude control, wind, staging, structural limits, seeded hardware failures | `internal/physics/{flight,fly}.go` |
| Ascent autopilot: MechJeb-style classic ascent (vertical rise, angle-of-attack-limited gravity turn, cut-off at an 80 km apoapsis, coast, circularisation), with the turn shape chosen by rehearsal flights in calm and windy air | `internal/physics/{fly,ascent}.go` |
| Launch plan (outcome, report, staging summary, repair notes) and random-rocket engine tuning | `internal/physics/{plan,tune}.go`, `internal/httpx/physics_endpoint.go` |
| Client for the physics API and playback of a flight with smooth time warp | `web/src/lib/physics/*`, `web/src/lib/sim/playback.ts` |
| Joke meters | `web/src/lib/rocket/stats.ts` |
| AI action schema and output validation | `web/src/lib/ai/actions.ts` |
| Provider interface, hosted-model client | `web/src/lib/ai/{provider,remote-provider,client}.ts` |
| Hosted engineer (OpenRouter via `joakimcarlsson/ai`, structured outputs) and endpoint | `internal/engineer`, `internal/httpx/ai_endpoint.go` |
| 3D rendering (R3F): parts, animated rocket, bay, launch scene, particles, thumbnails | `web/src/components/three/*` |
| UI | `web/src/components/ui/*`, `web/src/components/Builder.tsx`, `web/src/components/explore/*`, `web/src/components/share/*` |
| State (undo/redo, history, launch flow) | `web/src/lib/store.ts` |
| Persistence and sharing | `web/src/lib/persistence.ts`, `web/src/lib/share.ts`, `web/src/lib/feed/community.ts` |
| Sound hooks (synthesised WebAudio) | `web/src/lib/sound.ts` |

The model only ever returns JSON actions. Each action is validated against a Zod schema and clamped to hard limits before it touches the rocket; nothing the model returns is executed. Adding a client-side provider means implementing `AIProvider`.
