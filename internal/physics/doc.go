// Package physics is the rocket flight engine. It validates a rocket
// configuration, derives its masses, engines and aerodynamics, and integrates
// a launch from a Kerbin-sized planet: planar translation around a round,
// rotating world plus the vehicle's pitch as a rigid body, steered by gimbals
// and reaction wheels. The world and parts are scaled like Kerbal Space
// Program's, so a launch takes minutes, while every force in it is real.
//
// The autopilot flies MechJeb's classic ascent: straight up, a gravity turn
// held to a safe angle of attack, engine cut-off when apoapsis reaches
// 80 km, a coast, and a circularisation burn at apoapsis. It picks the shape
// of its turn by rehearsing the flight in calm air and in strong winds.
//
// Everything that decides whether a launch works lives here, on the server,
// so the web app only renders what it is told.
package physics
