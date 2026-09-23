// Package config reads the process environment.
//
// It is the only package that does. A package that reaches for os.Getenv
// decides its caller's configuration for them, and the caller is a binary.
package config
