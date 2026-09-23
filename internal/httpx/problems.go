package httpx

import (
	"log/slog"
	"net/http"

	"github.com/joakimcarlsson/minmux/router"
)

// problem writes an RFC 7807 body at its own status.
func problem(c *router.Context, pd *router.ProblemDetails) {
	c.JSON(pd.Status, pd)
}

// upstreamFailed logs the cause and answers 502 with a detail that names the
// step rather than repeating the error.
func upstreamFailed(c *router.Context, doing string, err error) {
	slog.ErrorContext(c.Request.Context(), "upstream failed",
		"doing", doing,
		"error", err,
	)
	problem(c, statusProblem(http.StatusBadGateway, "failed "+doing))
}

// statusProblem builds a problem for a status minmux has no constructor for.
func statusProblem(status int, detail string) *router.ProblemDetails {
	return &router.ProblemDetails{
		Status: status,
		Title:  http.StatusText(status),
		Detail: detail,
	}
}
