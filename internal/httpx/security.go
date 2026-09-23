package httpx

import (
	"net/http"
	"strings"
	"time"

	"github.com/JoakimCarlsson/rocket/internal/account"
	"github.com/joakimcarlsson/minmux/auth"
	"github.com/joakimcarlsson/minmux/openapi"
	"github.com/joakimcarlsson/minmux/router"
)

// sessionScheme is the security scheme every guarded route names, in both
// openapi.Security(sessionScheme) and the generated document.
const sessionScheme = "sessionCookie"

// sessionCookie is the cookie the session token travels in.
const sessionCookie = "rocket_session"

// flowCookie holds the state and PKCE verifier for one sign-in in progress.
const flowCookie = "rocket_oauth"

// flowTTL bounds how long a started sign-in may take to come back.
const flowTTL = 10 * time.Minute

// securitySchemes is what the OpenAPI document declares. One entry per scheme
// the routes may name; a route naming anything else is a 401 at runtime.
// There is still only the one scheme under dev auth: the bearer header it also
// accepts carries the very same token, so it is a second spelling of this
// credential rather than a second credential.
func securitySchemes(devAuth bool) map[string]*openapi.SecurityScheme {
	desc := "Opaque session token, set by the Google sign-in flow."
	if devAuth {
		desc += " Dev auth is on, so the same token is also accepted as" +
			" 'Authorization: Bearer <token>'; POST /api/dev/auth/token" +
			" issues one."
	}
	return map[string]*openapi.SecurityScheme{
		sessionScheme: openapi.APIKey("cookie", sessionCookie, desc),
	}
}

// verifiers resolves a credential per scheme. There are no scopes yet: a
// session either exists or it does not, and ownership is the domain's
// question, not the middleware's.
func (s *Server) verifiers() map[string]auth.Verifier {
	return map[string]auth.Verifier{
		sessionScheme: s.verifySession,
	}
}

// verifySession resolves the session token into the user it belongs to. It
// is an [auth.Verifier]: no token means anonymous, so an optional route falls
// through, and an unknown or expired one is a 401.
func (s *Server) verifySession(r *http.Request, _ []string) (any, error) {
	token := s.sessionToken(r)
	if token == "" {
		return nil, auth.ErrNoCredential
	}
	return account.Authenticate(r.Context(), s.accounts, token)
}

// sessionToken reads the session token off the request. Normally that is the
// cookie and nothing else. Under dev auth an "Authorization: Bearer <token>"
// header is read as well, because a script or an agent curling the API has no
// cookie jar; it names the same opaque token the cookie would carry, so the
// header buys no access the cookie does not.
func (s *Server) sessionToken(r *http.Request) string {
	if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
		return c.Value
	}
	if !s.devAuth {
		return ""
	}
	raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok {
		return ""
	}
	return strings.TrimSpace(raw)
}

// currentUser returns the signed-in user, writing a 401 and reporting false
// when there is none. A route annotated openapi.Security(sessionScheme) is
// already guarded by the middleware; this is the type-safe read of what it
// resolved.
func currentUser(c *router.Context) (account.User, bool) {
	u, ok := auth.Principal[account.User](c.Ctx())
	if !ok {
		problem(c, router.Unauthorized("sign in to continue"))
		return account.User{}, false
	}
	return u, true
}

// startSession opens a session for an identity and sets the cookie it travels
// in, returning the raw token so a caller that has no cookie jar can be
// handed it as well.
func (s *Server) startSession(
	c *router.Context,
	id account.Identity,
) (account.User, account.Session, error) {
	user, session, err := account.SignIn(c.Ctx(), s.accounts, id)
	if err != nil {
		return account.User{}, account.Session{}, err
	}
	s.setCookie(c, sessionCookie, session.Token, account.SessionTTL)
	return user, session, nil
}

// setCookie writes one of ours, with the attributes every cookie here shares.
// SameSite is Lax rather than Strict because the Google callback is a
// top-level cross-site redirect, and Strict would withhold the cookie on it.
func (s *Server) setCookie(
	c *router.Context,
	name, value string,
	maxAge time.Duration,
) {
	//nolint:gosec
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		MaxAge:   int(maxAge.Seconds()),
		HttpOnly: true,
		Secure:   s.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

// clearCookie expires one of ours.
func (s *Server) clearCookie(c *router.Context, name string) {
	//nolint:gosec
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     name,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   s.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}
