package httpx

import (
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/JoakimCarlsson/rocket/internal/physics"
	"github.com/JoakimCarlsson/rocket/internal/rocket"
	"github.com/joakimcarlsson/minmux/openapi"
	"github.com/joakimcarlsson/minmux/router"
)

// publishCommand is the body of POST /api/rockets.
type publishCommand struct {
	Name   string         `json:"name"   desc:"The rocket's name, 1 to 80 characters."`
	Prompt string         `json:"prompt" desc:"What the player told the engineer, shown on the card. At most 200 characters."`
	Config map[string]any `json:"config" desc:"The rocket configuration as the web app models it. Stored as sent; the web app validates it on read. At most 64 KiB."`
}

// publishParams binds a POST /api/rockets request.
type publishParams struct {
	Body publishCommand `body:""`
}

// feedParams binds a GET /api/rockets request.
type feedParams struct {
	Before string `query:"before" desc:"The next cursor from the previous page. Omit for the newest rockets."`
	Limit  int    `query:"limit"  desc:"How many rockets to return, 1 to 48. Defaults to 12."`
}

// rocketParams names one rocket in the path.
type rocketParams struct {
	ID string `path:"id" desc:"The rocket's id."`
}

// rocketResponse is one published rocket.
type rocketResponse struct {
	ID        string         `json:"id"         desc:"The rocket's id."`
	Creator   string         `json:"creator"    desc:"The display name of the player who published it. Empty when they have none."`
	Name      string         `json:"name"       desc:"The rocket's name."`
	Prompt    string         `json:"prompt"     desc:"What the player told the engineer."`
	Config    map[string]any `json:"config"     desc:"The rocket configuration, as published."`
	Likes     int            `json:"likes"      desc:"How many players like it."`
	Liked     bool           `json:"liked"      desc:"Whether the caller likes it. Always false when nobody is signed in."`
	Mine      bool           `json:"mine"       desc:"Whether the caller published it."`
	CreatedAt time.Time      `json:"created_at" desc:"When it was published."`
	Launch    *launchSummary `json:"launch"     desc:"How its first launch goes, flown by the server. Null when the stored config no longer parses."`
}

// launchSummary is the outcome of a rocket's first launch.
type launchSummary struct {
	Outcome  physics.Outcome `json:"outcome"  desc:"How the launch ended."`
	Headline string          `json:"headline" desc:"The mission report headline."`
	Grade    string          `json:"grade"    desc:"success, partial or failure."`
	Stats    physics.Stats   `json:"stats"    desc:"The rocket's build-panel numbers."`
}

// firstLaunch flies a published rocket once, or returns nil when its config
// no longer parses.
func firstLaunch(config map[string]any) *launchSummary {
	r, err := physics.ParseRocketMap(config)
	if err != nil {
		return nil
	}
	p := physics.Launch(r, 1)
	return &launchSummary{
		Outcome:  p.Outcome,
		Headline: p.Report.Headline,
		Grade:    p.Report.Grade,
		Stats:    p.Stats,
	}
}

// feedResponse is one page of the Explore feed.
type feedResponse struct {
	Rockets []rocketResponse `json:"rockets" desc:"The rockets on this page, newest first."`
	Next    string           `json:"next"    desc:"The cursor for the next page, passed as before. Empty on the last page."`
}

// likeResponse is a rocket's like state after a change.
type likeResponse struct {
	Likes int  `json:"likes" desc:"How many players like it now."`
	Liked bool `json:"liked" desc:"Whether the caller likes it now."`
}

// toRocketResponse maps a rocket onto the wire for viewerID.
func toRocketResponse(r rocket.Rocket, viewerID string) rocketResponse {
	return rocketResponse{
		ID:        r.ID,
		Creator:   r.Creator,
		Name:      r.Name,
		Prompt:    r.Prompt,
		Config:    r.Config,
		Likes:     r.Likes,
		Liked:     r.Liked,
		Mine:      viewerID != "" && r.UserID == viewerID,
		CreatedAt: r.CreatedAt,
		Launch:    firstLaunch(r.Config),
	}
}

// registerRockets wires publishing, the Explore feed and likes.
func (s *Server) registerRockets() {
	rockets := s.router.Group("/api/rockets", openapi.Tags("Rockets"))

	rockets.Post("", s.handlePublish,
		openapi.Summary("Publish a rocket to Explore"),
		openapi.Description(
			"Stores the signed-in player's rocket so it appears on the Explore feed and at its own share link.",
		),
		openapi.Security(sessionScheme),
		openapi.ReturnsBody[rocketResponse](
			http.StatusCreated, "The published rocket."),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusBadRequest, "The name, prompt or config broke a limit."),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusUnauthorized, "Nobody is signed in."),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusInternalServerError, "The rocket could not be stored."),
	)

	rockets.Get(
		"",
		s.handleFeed,
		openapi.Summary("Read the Explore feed"),
		openapi.Description(
			"Published rockets, newest first, a page at a time. Public; a signed-in caller also learns which ones they like.",
		),
		openapi.OptionalSecurity(),
		openapi.ReturnsBody[feedResponse](
			http.StatusOK,
			"One page of rockets.",
		),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusBadRequest, "The cursor was not a rocket id."),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusInternalServerError, "The feed could not be read."),
	)

	rockets.Get("/{id}", s.handleGetRocket,
		openapi.Summary("Read one rocket"),
		openapi.Description(
			"The rocket behind a share link. Public; a signed-in caller also learns whether they like it.",
		),
		openapi.OptionalSecurity(),
		openapi.ReturnsBody[rocketResponse](http.StatusOK, "The rocket."),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusNotFound, "No rocket has that id."),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusInternalServerError, "The rocket could not be read."),
	)

	for _, route := range []struct {
		register func(string, any, ...router.Option) *router.Endpoint
		handler  func(*router.Context, rocketParams)
		summary  string
	}{
		{rockets.Put, s.handleLike, "Like a rocket"},
		{rockets.Delete, s.handleUnlike, "Stop liking a rocket"},
	} {
		route.register("/{id}/like", route.handler,
			openapi.Summary(route.summary),
			openapi.Description(
				"Idempotent: repeating it leaves the like as it is.",
			),
			openapi.Security(sessionScheme),
			openapi.ReturnsBody[likeResponse](
				http.StatusOK, "The rocket's like state now."),
			openapi.ReturnsBody[router.ProblemDetails](
				http.StatusUnauthorized, "Nobody is signed in."),
			openapi.ReturnsBody[router.ProblemDetails](
				http.StatusNotFound, "No rocket has that id."),
			openapi.ReturnsBody[router.ProblemDetails](
				http.StatusInternalServerError,
				"The like could not be changed.",
			),
		)
	}
}

// handlePublish stores the signed-in player's rocket.
func (s *Server) handlePublish(c *router.Context, p publishParams) {
	u, ok := currentUser(c)
	if !ok {
		return
	}
	stored, err := rocket.Publish(c.Ctx(), s.rockets, u.ID, rocket.Draft{
		Name:   p.Body.Name,
		Prompt: p.Body.Prompt,
		Config: p.Body.Config,
	})
	switch {
	case errors.Is(err, rocket.ErrInvalid):
		problem(c, router.BadRequest(invalidDetail(err)))
		return
	case err != nil:
		fail(c, "publishing the rocket", err)
		return
	}
	c.JSON(http.StatusCreated, toRocketResponse(stored, u.ID))
}

// handleFeed answers with one page of the Explore feed.
func (s *Server) handleFeed(c *router.Context, p feedParams) {
	viewer := s.viewerID(c.Request)
	page, err := rocket.Feed(c.Ctx(), s.rockets, viewer, p.Before, p.Limit)
	switch {
	case errors.Is(err, rocket.ErrInvalid):
		problem(c, router.BadRequest(invalidDetail(err)))
		return
	case err != nil:
		fail(c, "reading the feed", err)
		return
	}
	out := feedResponse{
		Rockets: make([]rocketResponse, 0, len(page.Rockets)),
		Next:    page.Next,
	}
	out.Rockets = out.Rockets[:len(page.Rockets)]
	var wg sync.WaitGroup
	for i, r := range page.Rockets {
		wg.Go(func() { out.Rockets[i] = toRocketResponse(r, viewer) })
	}
	wg.Wait()
	c.JSON(http.StatusOK, out)
}

// handleGetRocket answers with one rocket.
func (s *Server) handleGetRocket(c *router.Context, p rocketParams) {
	viewer := s.viewerID(c.Request)
	r, err := rocket.Get(c.Ctx(), s.rockets, viewer, p.ID)
	switch {
	case errors.Is(err, rocket.ErrNotFound):
		problem(c, router.NotFound("no rocket has that id"))
		return
	case err != nil:
		fail(c, "reading the rocket", err)
		return
	}
	c.JSON(http.StatusOK, toRocketResponse(r, viewer))
}

// handleLike records that the signed-in player likes a rocket.
func (s *Server) handleLike(c *router.Context, p rocketParams) {
	s.setLiked(c, p.ID, true)
}

// handleUnlike removes the signed-in player's like from a rocket.
func (s *Server) handleUnlike(c *router.Context, p rocketParams) {
	s.setLiked(c, p.ID, false)
}

// setLiked is the shared body of the like and unlike handlers.
func (s *Server) setLiked(c *router.Context, id string, liked bool) {
	u, ok := currentUser(c)
	if !ok {
		return
	}
	likes, err := rocket.SetLiked(c.Ctx(), s.rockets, u.ID, id, liked)
	switch {
	case errors.Is(err, rocket.ErrNotFound):
		problem(c, router.NotFound("no rocket has that id"))
		return
	case err != nil:
		fail(c, "changing the like", err)
		return
	}
	c.JSON(http.StatusOK, likeResponse{Likes: likes, Liked: liked})
}

// invalidDetail turns a wrapped [rocket.ErrInvalid] into the detail a client
// is shown: the part that says what was wrong.
func invalidDetail(err error) string {
	_, detail, ok := strings.Cut(err.Error(), ": ")
	if !ok {
		return err.Error()
	}
	return detail
}
