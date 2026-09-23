package config

import (
	"fmt"
	"os"
	"time"

	"github.com/joho/godotenv"
)

// How long the server and the calls it makes are given. Shutdown drains
// in-flight requests, ReadHeader bounds how long a client may take to send
// its headers, and OpenRouter bounds a model call a player is waiting on.
const (
	ShutdownTimeout   = 10 * time.Second
	ReadHeaderTimeout = 10 * time.Second
	OpenRouterTimeout = 90 * time.Second
)

// Config is everything the process reads from its environment.
type Config struct {
	Addr       string // ROCKET_ADDR
	OpenRouter OpenRouter
}

// OpenRouter is the hosted model the AI engineer talks to. APIKey empty means
// no hosted model: the API still starts and reports it unavailable, and the
// web app falls back to its local engineer.
type OpenRouter struct {
	APIKey string // OPENROUTER_API_KEY
	// Model must support strict structured outputs.
	Model string // OPENROUTER_MODEL
}

// Configured reports whether a hosted model can be called.
func (o OpenRouter) Configured() bool {
	return o.APIKey != ""
}

// Defaults for a zero-config local run.
const (
	defaultAddr  = ":8080"
	defaultModel = "bytedance-seed/seed-2.0-mini"
)

// Load reads the environment, first applying any .env in the working
// directory. A missing .env is not an error, and real environment variables
// win over the file.
func Load() (Config, error) {
	if err := loadDotenv(); err != nil {
		return Config{}, err
	}
	return Config{
		Addr: env("ROCKET_ADDR", defaultAddr),
		OpenRouter: OpenRouter{
			APIKey: os.Getenv("OPENROUTER_API_KEY"),
			Model:  env("OPENROUTER_MODEL", defaultModel),
		},
	}, nil
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
