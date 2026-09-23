package rocket

import (
	"errors"
	"regexp"
	"time"
)

// Limits on what one published rocket may carry. A full configuration is a
// few kilobytes; anything far past MaxConfigBytes is not the web app talking.
const (
	MaxNameLength   = 80
	MaxPromptLength = 200
	MaxConfigBytes  = 64 << 10
)

// How many rockets a feed page holds when the caller does not say, and the
// most it may ask for.
const (
	DefaultPageSize = 12
	MaxPageSize     = 48
)

// ErrNotFound is returned when no rocket has the id asked for.
var ErrNotFound = errors.New("rocket not found")

// ErrInvalid is wrapped by every error that rejects what a caller sent.
var ErrInvalid = errors.New("invalid rocket")

// uuidPattern matches the canonical text form of a UUID, which is every id
// this package hands out.
var uuidPattern = regexp.MustCompile(
	`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-` +
		`[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`,
)

// Rocket is one published rocket, as a particular viewer sees it.
type Rocket struct {
	ID      string
	UserID  string
	Creator string
	Name    string
	Prompt  string
	Config  map[string]any
	Likes   int
	// Liked reports whether the viewer the rocket was read for likes it.
	// It is false for an anonymous viewer.
	Liked     bool
	CreatedAt time.Time
}

// Draft is what a player publishes.
type Draft struct {
	Name   string
	Prompt string
	Config map[string]any
}

// Page is one stretch of the feed, newest first. Next is the cursor for the
// page after it, empty when there is none.
type Page struct {
	Rockets []Rocket
	Next    string
}

// validID reports whether id could name a rocket, so that a malformed one is
// answered as not found rather than as a database error.
func validID(id string) bool {
	return uuidPattern.MatchString(id)
}
