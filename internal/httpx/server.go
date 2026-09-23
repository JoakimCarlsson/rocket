package httpx

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/JoakimCarlsson/rocket/internal/config"
	"github.com/JoakimCarlsson/rocket/internal/engineer"
	"github.com/joakimcarlsson/minmux/openapi"
	"github.com/joakimcarlsson/minmux/router"
)

// Config is how the server is set up: where it listens and what build it
// says it is. None of it changes while it runs.
type Config struct {
	// Addr is the address to listen on.
	Addr string
	// Version is the build this process is, reported in the API document.
	Version string
}

// Deps are the subsystems the handlers work through.
type Deps struct {
	// Engineer answers player turns. Nil means no hosted model is configured:
	// the AI endpoint reports it unavailable and the web app uses its local
	// engineer.
	Engineer *engineer.Engineer
}

// Server owns the minmux router and the underlying http.Server.
type Server struct {
	addr     string
	version  string
	router   *router.Router
	docs     *openapi.Generator
	engineer *engineer.Engineer
}

// New constructs a Server with all routes registered.
func New(cfg Config, deps Deps) *Server {
	s := &Server{
		addr:     cfg.Addr,
		version:  cfg.Version,
		router:   router.New(),
		engineer: deps.Engineer,
	}
	s.docs = openapi.NewGenerator(openapi.Info{
		Title:       "Rocket",
		Version:     cfg.Version,
		Description: "Talk a rocket into existence, then launch it.",
	})
	s.router.Use(router.Recover())
	s.routes()
	return s
}

// routes registers every route on the router. The SPA is registered last
// because it matches everything.
func (s *Server) routes() {
	s.registerHealth()
	s.registerAI()
	s.registerDocs()
	s.registerSPA()
}

// Start runs the server until ctx is cancelled, then drains gracefully.
func (s *Server) Start(ctx context.Context) error {
	srv := &http.Server{
		Addr:              s.addr,
		Handler:           s.router,
		ReadHeaderTimeout: config.ReadHeaderTimeout,
	}

	errc := make(chan error, 1)
	go func() {
		slog.InfoContext(ctx, "api listening", "addr", s.addr)
		errc <- srv.ListenAndServe()
	}()

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
		shutCtx, cancel := context.WithTimeout(
			context.Background(),
			config.ShutdownTimeout,
		)
		defer cancel()
		return srv.Shutdown(shutCtx)
	}
}

// Handler exposes the router for tests via httptest.
func (s *Server) Handler() http.Handler {
	return s.router
}
