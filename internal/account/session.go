package account

import "context"

// Authenticate resolves a raw session token into the user it belongs to,
// reporting [ErrNotFound] when the token is unknown or expired, which are the
// same answer to the caller: not signed in.
func Authenticate(
	ctx context.Context,
	store *Store,
	token string,
) (User, error) {
	return store.UserForSession(ctx, HashToken(token))
}

// SignOut revokes a raw session token. A token that is already gone is not an
// error: signing out twice has the outcome the caller asked for.
func SignOut(ctx context.Context, store *Store, token string) error {
	return store.DeleteSession(ctx, HashToken(token))
}
