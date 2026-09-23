package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

// How long the server and the calls it makes are given. Shutdown drains
// in-flight requests, ReadHeader bounds how long a client may take to send
// its headers, OpenRouter bounds a model call a player is waiting on, and
// Google bounds the code exchange at the end of a sign-in.
const (
	ShutdownTimeout   = 10 * time.Second
	ReadHeaderTimeout = 10 * time.Second
	OpenRouterTimeout = 90 * time.Second
	GoogleTimeout     = 10 * time.Second
)

// Config is everything the process reads from its environment.
type Config struct {
	Addr       string // ROCKET_ADDR
	OpenRouter OpenRouter
	Postgres   Postgres
	Google     Google
	// DevAuth turns the local sign-in bypass on. Never true in production:
	// Load refuses it for an https public URL.
	DevAuth bool // ROCKET_DEV_AUTH
}

// OpenRouter is the hosted model the AI engineer talks to. APIKey empty means
// no hosted model: the API still starts and reports it unavailable, and the
// web app shows the engineer as offline.
type OpenRouter struct {
	APIKey string // OPENROUTER_API_KEY
	// Model must support strict structured outputs.
	Model string // OPENROUTER_MODEL
}

// Configured reports whether a hosted model can be called.
func (o OpenRouter) Configured() bool {
	return o.APIKey != ""
}

// Google is the OAuth client the sign-in flow runs against. PublicURL is the
// origin the browser sees — the dev server in development, the real host in
// production — and is what the redirect URL and CookieSecure are derived from,
// so the redirect can never drift from what Google has registered.
type Google struct {
	ClientID     string // GOOGLE_CLIENT_ID
	ClientSecret string // GOOGLE_CLIENT_SECRET
	PublicURL    string // ROCKET_PUBLIC_URL
}

// Origin is where the browser reaches this app, without a trailing slash, so
// that a path can be appended to it.
func (g Google) Origin() string {
	return strings.TrimSuffix(g.PublicURL, "/")
}

// RedirectURL is the absolute callback URL to register with Google, for a
// callback served at path.
func (g Google) RedirectURL(path string) string {
	return g.Origin() + path
}

// CookieSecure reports whether cookies may carry the Secure attribute, which
// is true exactly when the site is served over https. Localhost over plain
// http would otherwise never receive the session cookie back.
func (g Google) CookieSecure() bool {
	return strings.HasPrefix(g.PublicURL, "https://")
}

// Postgres is the connection to the account store. The variable names match
// what tern and docker compose read, so one set configures all three.
type Postgres struct {
	Host     string // PGHOST
	Port     int    // PGPORT
	Database string // PGDATABASE
	User     string // PGUSER
	Password string // PGPASSWORD
	SSLMode  string // PGSSLMODE
}

// URL renders the connection as a URL for pgx, escaping user and password.
func (p Postgres) URL() string {
	u := url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(p.User, p.Password),
		Host:   net.JoinHostPort(p.Host, strconv.Itoa(p.Port)),
		Path:   "/" + p.Database,
	}
	q := url.Values{}
	q.Set("sslmode", p.SSLMode)
	u.RawQuery = q.Encode()
	return u.String()
}

// Defaults for a local run, matching the compose file in the repo root.
const (
	defaultAddr     = ":8080"
	defaultModel    = "bytedance-seed/seed-2.0-mini"
	defaultHost     = "localhost"
	defaultPort     = 30003
	defaultDatabase = "rocket"
	defaultUser     = "rocket"
	defaultPassword = "rocket"
	defaultSSLMode  = "disable"
)

// Load reads the environment, first applying any .env in the working
// directory. A missing .env is not an error, and real environment variables
// win over the file.
func Load() (Config, error) {
	if err := loadDotenv(); err != nil {
		return Config{}, err
	}

	port, err := envInt("PGPORT", defaultPort)
	if err != nil {
		return Config{}, err
	}

	devAuth, err := envBool("ROCKET_DEV_AUTH", false)
	if err != nil {
		return Config{}, err
	}

	google, err := loadGoogle(devAuth)
	if err != nil {
		return Config{}, err
	}
	if devAuth && google.CookieSecure() {
		return Config{}, errors.New(
			"config: ROCKET_DEV_AUTH is set but ROCKET_PUBLIC_URL is https; " +
				"the sign-in bypass is for local development only",
		)
	}

	return Config{
		Addr: env("ROCKET_ADDR", defaultAddr),
		OpenRouter: OpenRouter{
			APIKey: os.Getenv("OPENROUTER_API_KEY"),
			Model:  env("OPENROUTER_MODEL", defaultModel),
		},
		Postgres: Postgres{
			Host:     env("PGHOST", defaultHost),
			Port:     port,
			Database: env("PGDATABASE", defaultDatabase),
			User:     env("PGUSER", defaultUser),
			Password: env("PGPASSWORD", defaultPassword),
			SSLMode:  env("PGSSLMODE", defaultSSLMode),
		},
		Google:  google,
		DevAuth: devAuth,
	}, nil
}

// loadGoogle reads the Google sign-in settings, requiring all three. Under
// devAuth they are optional instead, so a local machine with no OAuth client
// of its own can still sign in.
func loadGoogle(devAuth bool) (Google, error) {
	out := Google{
		ClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		ClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
		PublicURL:    os.Getenv("ROCKET_PUBLIC_URL"),
	}
	missing := []string{}
	for name, value := range map[string]string{
		"GOOGLE_CLIENT_ID":     out.ClientID,
		"GOOGLE_CLIENT_SECRET": out.ClientSecret,
		"ROCKET_PUBLIC_URL":    out.PublicURL,
	} {
		if value == "" {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 && !devAuth {
		sort.Strings(missing)
		return Google{}, fmt.Errorf(
			"config: unset: %s",
			strings.Join(missing, ", "),
		)
	}
	return out, nil
}

// loadDotenv applies .env when it exists.
func loadDotenv() error {
	err := godotenv.Load()
	if err == nil || os.IsNotExist(err) {
		return nil
	}
	return fmt.Errorf("config: reading .env: %w", err)
}

// env returns the variable, or fallback when it is unset or empty.
func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// envInt returns the variable parsed as an int, or fallback when it is unset
// or empty. A value that will not parse is an error rather than a fallback,
// because a typo in a port should not silently connect somewhere else.
func envInt(key string, fallback int) (int, error) {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback, nil
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("config: %s: %q is not a number", key, raw)
	}
	return v, nil
}

// envBool returns the variable parsed as a bool, or fallback when it is unset
// or empty. A value that will not parse is an error rather than a fallback,
// because a typo must not quietly leave a development switch off — or on.
func envBool(key string, fallback bool) (bool, error) {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback, nil
	}
	v, err := strconv.ParseBool(raw)
	if err != nil {
		return false, fmt.Errorf("config: %s: %q is not a bool", key, raw)
	}
	return v, nil
}
