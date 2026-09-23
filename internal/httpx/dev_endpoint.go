package httpx

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/JoakimCarlsson/rocket/internal/account"
	"github.com/joakimcarlsson/minmux/openapi"
	"github.com/joakimcarlsson/minmux/router"
)

// devTokenParams binds who the issued session should belong to. Both are
// optional so that a bare POST works, which is the point of the endpoint.
type devTokenParams struct {
	Email string `query:"email" desc:"The address to sign in as. A user is created for it on first use. Defaults to dev@localhost."`
	Name  string `query:"name"  desc:"The display name for that user. Defaults to the local part of the email."`
}

// devTokenResponse is the session the caller may now use.
type devTokenResponse struct {
	Token     string    `json:"token"      desc:"The session token. Send it as 'Authorization: Bearer <token>', or as the rocket_session cookie."`
	UserID    string    `json:"user_id"    desc:"The id of the user the session belongs to."`
	Email     string    `json:"email"      desc:"The address the session was opened for."`
	ExpiresAt time.Time `json:"expires_at" desc:"When the session stops being accepted."`
}

// registerDev registers the local sign-in bypass. It is called only when
// ROCKET_DEV_AUTH is on, so in production the route does not exist and does
// not appear in the OpenAPI document.
func (s *Server) registerDev() {
	s.router.Post("/api/dev/auth/token", s.devToken,
		openapi.Tags("Dev"),
		openapi.Summary("Issue a session without signing in with Google"),
		openapi.Description(
			"Local development only: opens a session for any address and hands back the raw token, so a script or an agent can curl the API without a browser. Registered only when ROCKET_DEV_AUTH is on, which the config refuses for an https public URL. The token is an ordinary session — same table, same expiry, revoked by /api/auth/logout — and the response also sets the cookie, so a browser that hits this endpoint is signed in too.\n\n    TOKEN=$(curl -sX POST 'http://localhost:8080/api/dev/auth/token' | jq -r .token)\n    curl -H \"Authorization: Bearer $TOKEN\" http://localhost:8080/api/auth/me",
		),
		openapi.NoSecurity(),
		openapi.ReturnsBody[devTokenResponse](
			http.StatusOK, "The session to authenticate with."),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusBadRequest, "The email was not an address."),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusInternalServerError,
			"The session could not be opened.",
		),
	)
}

// devToken opens a session for whoever the caller says they are. There is no
// credential to check: that is the whole of what the switch turns on, and why
// it is refused anywhere the site is served over https.
func (s *Server) devToken(c *router.Context, p devTokenParams) {
	identity, err := account.DevIdentity(p.Email, p.Name)
	switch {
	case errors.Is(err, account.ErrBadEmail):
		problem(c, router.BadRequest(err.Error()))
		return
	case err != nil:
		fail(c, "reading the identity", err)
		return
	}

	user, session, err := s.startSession(c, identity)
	if err != nil {
		fail(c, "opening the session", err)
		return
	}
	slog.WarnContext(c.Ctx(), "dev session issued",
		"user_id", user.ID, "email", user.Email)
	c.JSON(http.StatusOK, devTokenResponse{
		Token:     session.Token,
		UserID:    user.ID,
		Email:     user.Email,
		ExpiresAt: session.ExpiresAt,
	})
}
