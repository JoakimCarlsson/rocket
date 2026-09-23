package httpx

import (
	"net/http"

	"github.com/joakimcarlsson/minmux/scalar"
)

// specPath is where the generated OpenAPI document is served.
const specPath = "/api/openapi.json"

// registerDocs serves the generated OpenAPI document and the Scalar UI over
// it, both under /api so that the SPA fallback leaves them alone.
func (s *Server) registerDocs() {
	s.router.HandleFunc(
		http.MethodGet,
		specPath,
		s.docs.Handler(s.router),
	)
	s.router.HandleFunc(
		http.MethodGet,
		"/api/docs",
		scalar.Handler(specPath),
	)
}
