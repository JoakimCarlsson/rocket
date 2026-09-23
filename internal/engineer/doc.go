// Package engineer is the hosted AI engineer: it hands one player turn to a
// language model and returns the rocket actions it answers with.
//
// It returns data only. The web app validates every action and clamps it to
// the game's limits before anything touches a rocket, so nothing the model
// says is trusted here beyond being well-formed JSON.
package engineer
