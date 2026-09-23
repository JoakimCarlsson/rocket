// Command api serves the Rocket API and the embedded web app.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"runtime/debug"
	"syscall"

	"github.com/JoakimCarlsson/rocket/internal/account"
	"github.com/JoakimCarlsson/rocket/internal/config"
	"github.com/JoakimCarlsson/rocket/internal/engineer"
	"github.com/JoakimCarlsson/rocket/internal/httpx"
	"github.com/JoakimCarlsson/rocket/internal/rocket"
	"github.com/JoakimCarlsson/rocket/internal/schema"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joakimcarlsson/ai/llm"
	llmopenai "github.com/joakimcarlsson/ai/llm/openai"
	llmopenrouter "github.com/joakimcarlsson/ai/llm/openrouter"
)

// maxTokens bounds one engineer answer. A turn is a short sentence and a
// handful of actions; this leaves room for a ridiculous request.
const maxTokens = 4000

// contextWindow is advertised for a model the catalogue has no entry for.
const contextWindow = 128_000

// appTitle is how OpenRouter attributes requests from this app.
const appTitle = "ROCKET.JDADDY"

// version is the reported build version; override with -ldflags.
var version = "dev"

func main() {
	if err := run(); err != nil {
		slog.Error("api failed", "error", err)
		os.Exit(1)
	}
}

// run loads configuration, wires the server and serves until a signal.
func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(
		context.Background(),
		syscall.SIGINT,
		syscall.SIGTERM,
	)
	defer stop()

	if cfg.DevAuth {
		slog.WarnContext(ctx, "dev auth is on; anyone who can reach the api "+
			"can mint a session at POST /api/dev/auth/token")
	}

	pool, err := pgxpool.New(ctx, cfg.Postgres.URL())
	if err != nil {
		return fmt.Errorf("connecting to postgres: %w", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("pinging postgres: %w", err)
	}
	if err := schema.Verify(ctx, pool); err != nil {
		return err
	}

	var eng *engineer.Engineer
	if cfg.OpenRouter.Configured() {
		eng = engineer.New(newOpenRouter(cfg.OpenRouter))
		slog.InfoContext(ctx, "hosted engineer", "model", cfg.OpenRouter.Model)
	} else {
		slog.WarnContext(ctx, "OPENROUTER_API_KEY unset; "+
			"the web app will use its local engineer")
	}

	srv := httpx.New(
		httpx.Config{
			Addr:    cfg.Addr,
			Version: buildVersion(),
			Google:  cfg.Google,
			DevAuth: cfg.DevAuth,
		},
		httpx.Deps{
			Engineer: eng,
			Accounts: account.NewStore(pool),
			Rockets:  rocket.NewStore(pool),
		},
	)
	return srv.Start(ctx)
}

// newOpenRouter builds the OpenRouter client. Reasoning is kept low because
// a turn needs a quick answer, not deliberation, and require_parameters stops
// OpenRouter routing to a provider that would ignore the strict schema.
func newOpenRouter(cfg config.OpenRouter) llm.LLM {
	return llmopenrouter.NewLLM(
		llmopenai.WithAPIKey(cfg.APIKey),
		llmopenai.WithModel(openRouterModel(cfg.Model)),
		llmopenai.WithMaxTokens(maxTokens),
		llmopenai.WithTimeout(config.OpenRouterTimeout),
		llmopenai.WithExtraHeaders(map[string]string{
			"X-OpenRouter-Title": appTitle,
		}),
		llmopenai.WithRequestJSONField(
			"reasoning",
			map[string]any{"effort": "low"},
		),
		llmopenai.WithRequestJSONField(
			"provider",
			map[string]any{"require_parameters": true},
		),
	)
}

// openRouterModel resolves an OpenRouter model id against the library's
// catalogue, declaring a custom model with structured outputs for one it does
// not list, since OpenRouter serves far more models than it catalogues.
func openRouterModel(id string) llm.Model {
	for _, m := range llmopenrouter.Models {
		if m.APIModel == id {
			return m
		}
	}
	return llm.NewCustomModel(
		llm.WithModelID(id),
		llm.WithAPIModel(id),
		llm.WithName(id),
		llm.WithProvider("openrouter"),
		llm.WithContextWindow(contextWindow),
		llm.WithStructuredOutput(true),
	)
}

// buildVersion falls back to the VCS revision when version is unset.
func buildVersion() string {
	if version != "dev" {
		return version
	}
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, s := range info.Settings {
			if s.Key == "vcs.revision" && s.Value != "" {
				rev := s.Value
				if len(rev) > 12 {
					rev = rev[:12]
				}
				return rev
			}
		}
	}
	return version
}
