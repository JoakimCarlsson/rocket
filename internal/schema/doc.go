// Package schema owns the database schema: the migrations as written,
// the version they add up to, and the two ways to act on them.
//
// Migrate applies them and is the only thing that issues DDL; it runs
// as its own deploy step from cmd/migrate. Verify only reads, takes no
// lock, and lets a long-lived process refuse to start against a schema
// it was not built for. Keeping those apart is what lets the API scale
// to many replicas: they all verify, none of them migrate.
package schema
