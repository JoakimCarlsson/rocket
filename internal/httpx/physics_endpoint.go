package httpx

import (
	"errors"
	"net/http"

	"github.com/JoakimCarlsson/rocket/internal/physics"
	"github.com/joakimcarlsson/minmux/openapi"
	"github.com/joakimcarlsson/minmux/router"
)

// maxAttempt bounds the launch counter a client may ask for.
const maxAttempt = 1_000_000

// rocketCommand carries one rocket configuration.
type rocketCommand struct {
	Rocket map[string]any `json:"rocket" desc:"The rocket configuration as the web app models it."`
}

// rocketBody binds a request whose body is a rocketCommand.
type rocketBody struct {
	Body rocketCommand `body:""`
}

// launchCommand is the body of POST /api/physics/launch.
type launchCommand struct {
	Rocket  map[string]any `json:"rocket"  desc:"The rocket configuration as the web app models it."`
	Attempt int            `json:"attempt" desc:"Which launch of this rocket, from 1. The same rocket and attempt always fly the same way."`
}

// launchParams binds a POST /api/physics/launch request.
type launchParams struct {
	Body launchCommand `body:""`
}

// tuneResponse is the body of POST /api/physics/tune.
type tuneResponse struct {
	Engines []physics.EngineSetting `json:"engines" desc:"Engine size and power for every stage and booster."`
}

// registerPhysics wires the flight engine: analysis, launches and tuning.
func (s *Server) registerPhysics() {
	g := s.router.Group("/api/physics", openapi.Tags("Physics"))

	g.Post(
		"/analyze",
		s.handleAnalyze,
		openapi.Summary("Analyze a rocket"),
		openapi.Description(
			"Derives the build panel's numbers: mass, thrust-to-weight, rocket-equation delta-v per burn, static margin, hardware reliability, and the physical problems that would stop the rocket reaching its destination.",
		),
		openapi.ReturnsBody[physics.Analysis](http.StatusOK, "The analysis"),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusBadRequest, "The rocket is not valid."),
	)

	g.Post(
		"/launch",
		s.handleLaunch,
		openapi.Summary("Launch a rocket"),
		openapi.Description(
			"Flies the rocket through the flight engine and returns the trajectory, events, mission report and staging summary. Deterministic for a rocket and attempt.",
		),
		openapi.ReturnsBody[physics.Plan](http.StatusOK, "The launch"),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusBadRequest, "The rocket is not valid."),
	)

	g.Post(
		"/tune",
		s.handleTune,
		openapi.Summary("Tune a random rocket's engines"),
		openapi.Description(
			"Picks engine sizes and powers that make a randomly generated rocket flyable, seeded by the rocket's own seed.",
		),
		openapi.ReturnsBody[tuneResponse](http.StatusOK, "Engine settings"),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusBadRequest, "The rocket is not valid."),
	)
}

// parseRocket validates a posted configuration, answering 400 when it is not
// a rocket.
func parseRocket(c *router.Context, config map[string]any) (*physics.Rocket, bool) {
	r, err := physics.ParseRocketMap(config)
	if errors.Is(err, physics.ErrInvalidRocket) {
		problem(c, router.BadRequest(err.Error()))
		return nil, false
	}
	if err != nil {
		fail(c, "reading the rocket", err)
		return nil, false
	}
	return r, true
}

// handleAnalyze answers POST /api/physics/analyze.
func (s *Server) handleAnalyze(c *router.Context, p rocketBody) {
	r, ok := parseRocket(c, p.Body.Rocket)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, physics.Analyze(r))
}

// handleLaunch answers POST /api/physics/launch.
func (s *Server) handleLaunch(c *router.Context, p launchParams) {
	if p.Body.Attempt < 1 || p.Body.Attempt > maxAttempt {
		problem(c, router.BadRequest("attempt must be 1 to 1000000"))
		return
	}
	r, ok := parseRocket(c, p.Body.Rocket)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, physics.Launch(r, p.Body.Attempt))
}

// handleTune answers POST /api/physics/tune.
func (s *Server) handleTune(c *router.Context, p rocketBody) {
	r, ok := parseRocket(c, p.Body.Rocket)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, tuneResponse{Engines: physics.Tune(r)})
}
