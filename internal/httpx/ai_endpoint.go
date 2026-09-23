package httpx

import (
	"net/http"

	"github.com/JoakimCarlsson/rocket/internal/engineer"
	"github.com/joakimcarlsson/minmux/openapi"
	"github.com/joakimcarlsson/minmux/router"
)

// maxTurnBytes bounds one user turn. A full rocket description with history
// is a few kilobytes; anything far past that is not the web app talking.
const maxTurnBytes = 32 << 10

// aiStatus is the body of GET /api/ai.
type aiStatus struct {
	Available bool   `json:"available" desc:"Whether a hosted model is configured."`
	ID        string `json:"id"        desc:"The provider id, or none when unavailable."`
	Label     string `json:"label"     desc:"The model's display name. Empty when unavailable."`
}

// interpretCommand is the body of POST /api/ai.
type interpretCommand struct {
	Message string `json:"message" desc:"The user turn, built by the web app from the current rocket, recent changes and the player's instruction."`
}

// interpretParams binds a POST /api/ai request.
type interpretParams struct {
	Body interpretCommand `body:""`
}

// registerAI wires the AI engineer endpoints.
func (s *Server) registerAI() {
	ai := s.router.Group("/api/ai", openapi.Tags("AI"))

	ai.Get(
		"",
		s.handleAIStatus,
		openapi.Summary("Hosted model status"),
		openapi.Description(
			"Reports whether a hosted model is configured so the web app can pick a provider.",
		),
		openapi.ReturnsBody[aiStatus](http.StatusOK, "Provider status"),
	)

	ai.Post(
		"",
		s.handleInterpret,
		openapi.Summary("Interpret one instruction"),
		openapi.Description(
			"Hands one user turn to the hosted model and returns its raw JSON actions for the web app to validate.",
		),
		openapi.ReturnsBody[map[string]any](
			http.StatusOK, "The model's actions, unvalidated."),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusBadRequest, "The message was empty or too long."),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusBadGateway, "The model call failed."),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusServiceUnavailable, "No hosted model is configured."),
	)
}

// handleAIStatus reports the configured hosted model, if any.
func (s *Server) handleAIStatus(c *router.Context) {
	if s.engineer == nil {
		c.JSON(http.StatusOK, aiStatus{ID: "none"})
		return
	}
	c.JSON(http.StatusOK, aiStatus{
		Available: true,
		ID:        engineer.ID,
		Label:     s.engineer.Label(),
	})
}

// handleInterpret forwards one turn to the hosted model.
func (s *Server) handleInterpret(c *router.Context, p interpretParams) {
	if s.engineer == nil {
		problem(c, statusProblem(
			http.StatusServiceUnavailable,
			"no hosted model is configured",
		))
		return
	}
	if p.Body.Message == "" || len(p.Body.Message) > maxTurnBytes {
		problem(c, router.BadRequest("message must be 1 to 32768 bytes"))
		return
	}
	out, err := s.engineer.Interpret(c.Ctx(), p.Body.Message)
	if err != nil {
		upstreamFailed(c, "asking the model", err)
		return
	}
	c.Bytes(http.StatusOK, "application/json", out)
}
