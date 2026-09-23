package httpx

import (
	"net/http"

	"github.com/joakimcarlsson/minmux/openapi"
	"github.com/joakimcarlsson/minmux/router"
)

// versionResponse is the body of GET /api/version.
type versionResponse struct {
	Version string `json:"version" desc:"The running build's version string."`
}

// registerHealth wires the liveness and version probes under /api.
func (s *Server) registerHealth() {
	meta := s.router.Group("/api", openapi.Tags("Meta"))

	meta.Get(
		"/healthz",
		s.handleHealthz,
		openapi.Summary("Liveness probe"),
		openapi.Description(
			"Returns 200 with body \"ok\" while the server is up.",
		),
		openapi.ReturnsBody[string](http.StatusOK, "Service is alive"),
	)

	meta.Get(
		"/version",
		s.handleVersion,
		openapi.Summary("Build version"),
		openapi.Description("Reports the running build's version string."),
		openapi.ReturnsBody[versionResponse](http.StatusOK, "Version payload"),
	)
}

// handleHealthz answers while the process is serving.
func (s *Server) handleHealthz(c *router.Context) {
	c.String(http.StatusOK, "ok")
}

// handleVersion reports the build version.
func (s *Server) handleVersion(c *router.Context) {
	c.JSON(http.StatusOK, versionResponse{Version: s.version})
}
