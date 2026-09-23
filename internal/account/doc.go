// Package account owns who is signed in. It is the only package that reads or
// writes the users and sessions tables; other subsystems take a [User] or a
// user ID from the caller and go no further.
package account
