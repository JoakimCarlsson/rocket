package httpx

import (
	"context"
	"crypto/subtle"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/JoakimCarlsson/rocket/internal/account"
	"github.com/joakimcarlsson/minmux/openapi"
	"github.com/joakimcarlsson/minmux/router"
	"golang.org/x/oauth2"
)

// GoogleCallbackPath is where Google sends the browser back. It lives under
// /api so the SPA fallback leaves it alone, and it is exported so the wiring
// can build the redirect URL to register with Google from the same constant
// the route is served at.
const GoogleCallbackPath = "/api/auth/google/callback"

// signedInPath is where somebody lands once they are signed in: the builder.
const signedInPath = "/"

// callbackParams binds what Google appends to the callback URL. None carry
// ",required": Google sends code and state on success and error on refusal,
// and the handler tells those apart itself.
type callbackParams struct {
	Code  string `query:"code"  desc:"The authorization code to exchange for a token."`
	State string `query:"state" desc:"The opaque value handed to Google at the start, echoed back."`
	Error string `query:"error" desc:"Why Google refused, when it did. 'access_denied' is the player declining."`
}

// meResponse is who the caller is signed in as.
type meResponse struct {
	ID         string `json:"id"          desc:"The user's id."`
	Email      string `json:"email"       desc:"The Google account's email address."`
	Name       string `json:"name"        desc:"The display name Google gave, empty when it gave none."`
	PictureURL string `json:"picture_url" desc:"URL of the Google profile picture, empty when there is none."`
}

// toMeResponse maps a user onto the wire.
func toMeResponse(u account.User) meResponse {
	return meResponse{
		ID:         u.ID,
		Email:      u.Email,
		Name:       u.Name,
		PictureURL: u.PictureURL,
	}
}

// registerAccounts registers the sign-in flow: leave for Google, come back
// with a session, read it, end it.
func (s *Server) registerAccounts() {
	s.router.Get("/api/auth/google/start", s.startGoogle,
		openapi.Tags("Auth"),
		openapi.Summary("Start signing in with Google"),
		openapi.Description(
			"Redirects the browser to Google's consent screen. Follow it as a navigation, not a fetch: the response is a cross-origin redirect.",
		),
		openapi.NoSecurity(),
		openapi.Returns(
			http.StatusFound,
			"Google's consent screen, or the app when local sign-in is used.",
		),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusBadRequest,
			"Google sign-in is not configured.",
		),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusInternalServerError,
			"The sign-in could not be started.",
		),
	)

	s.router.Get(GoogleCallbackPath, s.googleCallback,
		openapi.Tags("Auth"),
		openapi.Summary("Finish signing in with Google"),
		openapi.Description(
			"Where Google sends the browser back. Exchanges the code, opens a session, sets the cookie and redirects to the app. Register this URL with the OAuth client; nothing else should call it.",
		),
		openapi.NoSecurity(),
		openapi.Returns(
			http.StatusFound, "The app, signed in."),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusBadRequest,
			"The state did not match, or Google sent no code.",
		),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusForbidden,
			"Google has not verified that email address.",
		),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusInternalServerError,
			"The sign-in could not be completed.",
		),
	)

	s.router.Get("/api/auth/me", s.me,
		openapi.Tags("Auth"),
		openapi.Summary("Read who is signed in"),
		openapi.Description(
			"The current user. The web app calls this on load to decide whether to offer sign-in.",
		),
		openapi.Security(sessionScheme),
		openapi.ReturnsBody[meResponse](
			http.StatusOK, "The signed-in user."),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusUnauthorized, "Nobody is signed in."),
	)

	s.router.Post("/api/auth/logout", s.logout,
		openapi.Tags("Auth"),
		openapi.Summary("Sign out"),
		openapi.Description(
			"Deletes the session and clears the cookie. The token is stored server-side, so this revokes it rather than merely forgetting it.",
		),
		openapi.Security(sessionScheme),
		openapi.Returns(
			http.StatusNoContent, "Signed out."),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusUnauthorized, "Nobody is signed in."),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusInternalServerError, "The session could not be ended."),
	)
}

// startGoogle sends the browser to Google, carrying a state to recognise the
// return by and a PKCE challenge to bind the code to this browser. Both halves
// go into a short-lived cookie, which is what makes the callback verifiable
// without server-side state. With no client id, Google would 400; under
// DevAuth that case opens a local session instead.
func (s *Server) startGoogle(c *router.Context) {
	if s.google.ClientID == "" {
		if !s.devAuth {
			problem(c, router.BadRequest(
				"google sign-in is not configured",
			))
			return
		}
		identity, err := account.DevIdentity("", "dev")
		if err != nil {
			fail(c, "reading the identity", err)
			return
		}
		if _, _, err := s.startSession(c, identity); err != nil {
			fail(c, "opening the session", err)
			return
		}
		c.Redirect(http.StatusFound, signedInPath)
		return
	}

	state, err := account.NewToken()
	if err != nil {
		fail(c, "starting the sign-in", err)
		return
	}
	verifier := oauth2.GenerateVerifier()

	s.setCookie(c, flowCookie, state+":"+verifier, flowTTL)
	c.Redirect(http.StatusFound, s.google.AuthCodeURL(
		state,
		oauth2.AccessTypeOnline,
		oauth2.S256ChallengeOption(verifier),
	))
}

// googleCallback turns the code Google handed the browser into a session. The
// player declining is a redirect back to the app rather than an error status:
// they did not fail at anything.
func (s *Server) googleCallback(c *router.Context, p callbackParams) {
	ctx := c.Ctx()
	s.clearCookie(c, flowCookie)

	if p.Error != "" {
		slog.InfoContext(ctx, "sign-in declined", "reason", p.Error)
		c.Redirect(http.StatusFound, "/?auth=denied")
		return
	}

	verifier, err := s.checkState(c, p.State)
	if err != nil {
		problem(c, router.BadRequest(err.Error()))
		return
	}
	if p.Code == "" {
		problem(c, router.BadRequest("google sent no authorization code"))
		return
	}

	identity, err := s.identityFrom(ctx, p.Code, verifier)
	switch {
	case errors.Is(err, account.ErrUnverifiedEmail):
		problem(c, router.Forbidden(
			"google has not verified that email address",
		))
		return
	case err != nil:
		fail(c, "reading the identity Google returned", err)
		return
	}

	user, _, err := s.startSession(c, identity)
	if err != nil {
		fail(c, "opening the session", err)
		return
	}
	slog.InfoContext(ctx, "signed in", "user_id", user.ID)
	c.Redirect(http.StatusFound, signedInPath)
}

// identityFrom exchanges the code Google handed the browser and reads who
// signed in out of the ID token that comes back. The exchange runs on the
// instrumented client, so the call to Google shows up as a span under the
// request that made it.
func (s *Server) identityFrom(
	ctx context.Context,
	code, verifier string,
) (account.Identity, error) {
	token, err := s.google.Exchange(
		context.WithValue(ctx, oauth2.HTTPClient, s.googleHTTP),
		code,
		oauth2.VerifierOption(verifier),
	)
	if err != nil {
		return account.Identity{}, err
	}

	raw, ok := token.Extra("id_token").(string)
	if !ok || raw == "" {
		return account.Identity{}, errors.New("no id_token in the response")
	}
	return account.GoogleIdentity(raw, s.google.ClientID, time.Now())
}

// checkState reads the flow cookie back and returns the PKCE verifier it
// carries, once the state in it matches the one Google echoed. A mismatch is
// the CSRF case: somebody else's callback arriving in this browser.
func (s *Server) checkState(
	c *router.Context,
	echoed string,
) (string, error) {
	cookie, err := c.Request.Cookie(flowCookie)
	if err != nil {
		return "", errors.New("no sign-in is in progress; start again")
	}
	state, verifier, ok := strings.Cut(cookie.Value, ":")
	if !ok {
		return "", errors.New("the sign-in cookie is malformed; start again")
	}
	if subtle.ConstantTimeCompare([]byte(state), []byte(echoed)) != 1 {
		return "", errors.New("the sign-in state did not match; start again")
	}
	return verifier, nil
}

// me answers with the signed-in user.
func (s *Server) me(c *router.Context) {
	u, ok := currentUser(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, toMeResponse(u))
}

// logout deletes the session the request authenticated with and clears the
// cookie. It revokes whichever token was presented, so signing out of a
// bearer-authenticated session works the same as out of a browser one.
func (s *Server) logout(c *router.Context) {
	if _, ok := currentUser(c); !ok {
		return
	}
	if token := s.sessionToken(c.Request); token != "" {
		if err := account.SignOut(c.Ctx(), s.accounts, token); err != nil {
			fail(c, "ending the session", err)
			return
		}
	}
	s.clearCookie(c, sessionCookie)
	c.NoContent()
}
