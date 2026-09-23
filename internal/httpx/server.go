package httpx

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/JoakimCarlsson/rocket/internal/account"
	"github.com/JoakimCarlsson/rocket/internal/config"
	"github.com/JoakimCarlsson/rocket/internal/engineer"
	"github.com/joakimcarlsson/minmux/auth"
	"github.com/joakimcarlsson/minmux/openapi"
	"github.com/joakimcarlsson/minmux/router"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

// Config is how the server is set up: where it listens, what build it says
// it is, and the sign-in provider it talks to. None of it changes while it
// runs.
type Config struct {
	// Addr is the address to listen on.
	Addr string
	// Version is the build this process is, reported in the API document.
	Version string
	// Google carries the OAuth client and the origin the browser reaches
	// this app on, which is what the callback URL and the cookie's Secure
	// attribute are derived from.
	Google config.Google
	// DevAuth registers the local sign-in bypass and makes the session token
	// acceptable as a bearer header. Local development only.
	DevAuth bool
}

// Deps are the subsystems the handlers work through.
type Deps struct {
	// Engineer answers player turns. Nil means no hosted model is configured:
	// the AI endpoint reports it unavailable and the web app uses its local
	// engineer.
	Engineer *engineer.Engineer
	// Accounts holds users and their sessions. Required.
	Accounts *account.Store
}

// Server owns the minmux router and the underlying http.Server.
type Server struct {
	addr         string
	version      string
	router       *router.Router
	docs         *openapi.Generator
	engineer     *engineer.Engineer
	accounts     *account.Store
	google       *oauth2.Config
	googleHTTP   *http.Client
	cookieSecure bool
	devAuth      bool
}

// New constructs a Server with all routes registered.
func New(cfg Config, deps Deps) *Server {
	s := &Server{
		addr:     cfg.Addr,
		version:  cfg.Version,
		router:   router.New(),
		engineer: deps.Engineer,
		accounts: deps.Accounts,
		google: &oauth2.Config{
			ClientID:     cfg.Google.ClientID,
			ClientSecret: cfg.Google.ClientSecret,
			RedirectURL:  cfg.Google.RedirectURL(GoogleCallbackPath),
			Scopes:       []string{"openid", "email", "profile"},
			Endpoint:     google.Endpoint,
		},
		googleHTTP:   &http.Client{Timeout: config.GoogleTimeout},
		cookieSecure: cfg.Google.CookieSecure(),
		devAuth:      cfg.DevAuth,
	}
	s.docs = openapi.NewGenerator(openapi.Info{
		Title:       "Rocket",
		Version:     cfg.Version,
		Description: "Talk a rocket into existence, then launch it.",
	})
	s.docs.SecuritySchemes = securitySchemes(cfg.DevAuth)

	authn := auth.New(s.router, auth.Config{Verifiers: s.verifiers()})
	s.router.Use(router.Recover())
	s.router.Use(authn.Middleware())
	s.routes()
	return s
}

// routes registers every route on the router. The SPA is registered last
// because it matches everything.
func (s *Server) routes() {
	s.registerHealth()
	s.registerAccounts()
	if s.devAuth {
		s.registerDev()
	}
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
