package account

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// googleIssuers are the two spellings Google uses in the iss claim.
var googleIssuers = []string{
	"accounts.google.com",
	"https://accounts.google.com",
}

// idTokenClaims is the part of Google's ID token we read.
type idTokenClaims struct {
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
	Aud           string `json:"aud"`
	Iss           string `json:"iss"`
	Exp           int64  `json:"exp"`
}

// GoogleIdentity reads who signed in out of an ID token Google returned for
// clientID, reporting [ErrUnverifiedEmail] for an address Google has not
// verified.
//
// The signature is not checked, and that is sound only for a token that came
// back over TLS in the direct response to our own call to Google's token
// endpoint, which OpenID Connect Core §3.1.3.7 names as the case where
// signature validation may be skipped. The issuer, audience, expiry and
// verified flag are all checked here.
func GoogleIdentity(
	raw, clientID string,
	now time.Time,
) (Identity, error) {
	claims, err := parseIDToken(raw)
	if err != nil {
		return Identity{}, err
	}
	if err := claims.check(clientID, now); err != nil {
		return Identity{}, err
	}
	return Identity{
		Sub:        claims.Sub,
		Email:      claims.Email,
		Name:       claims.Name,
		PictureURL: claims.Picture,
	}, nil
}

// parseIDToken decodes the claims out of a JWT without verifying its
// signature. See [GoogleIdentity] for why that is sound here.
func parseIDToken(raw string) (idTokenClaims, error) {
	parts := strings.Split(raw, ".")
	if len(parts) != 3 {
		return idTokenClaims{}, errors.New("id_token is not a JWT")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return idTokenClaims{}, fmt.Errorf("decoding the claims: %w", err)
	}
	var out idTokenClaims
	if err := json.Unmarshal(payload, &out); err != nil {
		return idTokenClaims{}, fmt.Errorf("reading the claims: %w", err)
	}
	return out, nil
}

// check rejects claims that are not Google's, not ours, not current, or name
// an address Google has not verified.
func (c idTokenClaims) check(clientID string, now time.Time) error {
	if c.Iss != googleIssuers[0] && c.Iss != googleIssuers[1] {
		return fmt.Errorf("id_token issued by %q, not Google", c.Iss)
	}
	if c.Aud != clientID {
		return errors.New("id_token was issued for another client")
	}
	if c.Exp == 0 || now.After(time.Unix(c.Exp, 0)) {
		return errors.New("id_token has expired")
	}
	if c.Sub == "" || c.Email == "" {
		return errors.New("id_token names no account")
	}
	if !c.EmailVerified {
		return ErrUnverifiedEmail
	}
	return nil
}
