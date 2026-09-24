// Package physics is the rocket flight engine. It validates a rocket
// configuration, derives its masses, engines and aerodynamics, and integrates
// a launch: planar translation around a round, rotating Earth plus the
// vehicle's pitch as a rigid body, steered by a thrust-vector controller.
// The autopilot flies a zero-angle-of-attack gravity turn from a pitch-over
// kick it picks by rehearsing the flight, then hands over to Unified Powered
// Flight Guidance (UPFG), ported from the PEGAS kOS implementation, for
// orbital insertion.
//
// Everything that decides whether a launch works lives here, on the server,
// so the web app only renders what it is told.
package physics
