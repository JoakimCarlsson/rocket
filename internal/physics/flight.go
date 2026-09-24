package physics

import (
	"math"
	"math/rand/v2"
)

// EventType names something that happened during a flight.
type EventType string

// Flight events, in the order they can happen.
const (
	EventLiftoff     EventType = "liftoff"
	EventMaxQ        EventType = "maxq"
	EventBoosterSep  EventType = "booster_sep"
	EventStageSep    EventType = "stage_sep"
	EventFairingSep  EventType = "fairing_sep"
	EventEngineOut   EventType = "engine_out"
	EventBoosterFail EventType = "booster_fail"
	EventStall       EventType = "stall"
	EventSpin        EventType = "spin"
	EventPayloadPop  EventType = "payload_pop"
	EventExplode     EventType = "explode"
	EventBurnout     EventType = "burnout"
	EventImpact      EventType = "impact"
	EventOrbit       EventType = "orbit"
	EventWobble      EventType = "wobble"
)

// Event is a timed flight event, in seconds after ignition.
type Event struct {
	T    float64   `json:"t"            desc:"Seconds after ignition."`
	Type EventType `json:"type"         desc:"What happened."`
	ID   string    `json:"id,omitempty" desc:"The stage or booster involved, when there is one."`
}

// Sample is one recorded point of the trajectory.
type Sample struct {
	T         float64 `json:"t"         desc:"Seconds after ignition."`
	Altitude  float64 `json:"altitude"  desc:"Metres above sea level."`
	Downrange float64 `json:"downrange" desc:"Metres along the ground from the pad, east positive."`
	Speed     float64 `json:"speed"     desc:"Speed relative to the air in m/s."`
	Pitch     float64 `json:"pitch"     desc:"Body angle from local vertical in degrees, east positive."`
	AoA       float64 `json:"aoa"       desc:"Angle of attack in degrees."`
	Q         float64 `json:"q"         desc:"Dynamic pressure in pascals."`
	Mach      float64 `json:"mach"      desc:"Mach number."`
	Throttle  float64 `json:"throttle"  desc:"Throttle of the burning engines, 0 to 1."`
	G         float64 `json:"g"         desc:"Sensed acceleration in g."`
	Climb     float64 `json:"climb"     desc:"Rate of change of altitude in m/s."`
	Ground    float64 `json:"ground"    desc:"Rate of change of downrange in m/s."`
}

// flightEnd is how a flight finished.
type flightEnd string

const (
	endPad        flightEnd = "pad"
	endGoal       flightEnd = "goal"
	endOrbit      flightEnd = "orbit"
	endEscape     flightEnd = "escape"
	endSuborbital flightEnd = "suborbital"
	endCrash      flightEnd = "crash"
	endExplode    flightEnd = "explode"
	endSpin       flightEnd = "spin"
	endBreakup    flightEnd = "breakup"
	endPayload    flightEnd = "payload"
	endStall      flightEnd = "stall"
)

// usage is what one stage or booster did.
type usage struct {
	key     string
	ignited bool
	burned  float64
	failed  bool
}

// flight is the full result of integrating one launch.
type flight struct {
	end         flightEnd
	events      []Event
	samples     []Sample
	duration    float64
	maxAltitude float64
	maxQ        float64
	maxG        float64
	apogee      float64
	perigee     float64
	bound       bool
	excessSpeed float64
	deltaVUsed  float64
	usage       []usage
	landed      bool
	engineOuts  int
	fuelLeft    float64
	energy      float64
	orbited     bool
}

// vec is a 2D vector in the planet-centred inertial plane. The pad starts at
// (0, R) and east is +x.
type vec struct{ x, y float64 }

// add returns a + b.
func (a vec) add(b vec) vec { return vec{a.x + b.x, a.y + b.y} }

// sub returns a - b.
func (a vec) sub(b vec) vec { return vec{a.x - b.x, a.y - b.y} }

// scale returns a times k.
func (a vec) scale(k float64) vec { return vec{a.x * k, a.y * k} }

// dot returns the dot product of a and b.
func (a vec) dot(b vec) float64 { return a.x*b.x + a.y*b.y }

// cross returns the z component of a × b.
func (a vec) cross(b vec) float64 { return a.x*b.y - a.y*b.x }

// length returns the magnitude of a.
func (a vec) length() float64 { return math.Hypot(a.x, a.y) }

// unit returns a scaled to length 1.
func (a vec) unit() vec { return a.scale(1 / math.Max(1e-9, a.length())) }

// angleVec returns the unit vector at angle phi, counter-clockwise from +x.
func angleVec(phi float64) vec { return vec{math.Cos(phi), math.Sin(phi)} }

// wrap maps an angle into [-π, π].
func wrap(a float64) float64 { return math.Remainder(a, 2*math.Pi) }

// state is the rigid body: position, velocity, inertial body angle phi
// (counter-clockwise from +x) and pitch rate.
type state struct {
	pos, vel   vec
	phi, omega float64
}

// forces are the control inputs and mass properties held for one step.
type forces struct {
	mass, cm, inertia float64
	fixedThrust       float64
	gimbalThrust      float64
	sinGimbal         float64
	armGimbal         float64
	rcs               float64
	dragArea          float64
	cna, cp           float64
	damping           float64
	refArea           float64
	propeller         float64
	wind              wind
}

// wind is a seeded horizontal wind profile: a surface breeze plus a jet
// stream peaking near 11 km, blowing east (positive) or west.
type wind struct {
	surface float64
	jet     float64
}

// newWind rolls the day's weather.
func newWind(rng *rand.Rand) wind {
	sign := 1.0
	if rng.Float64() < 0.5 {
		sign = -1
	}
	return wind{surface: sign * (2 + 8*rng.Float64()), jet: sign * (10 + 45*rng.Float64())}
}

// at is the wind speed at an altitude, in m/s along local east.
func (w wind) at(altitude float64) float64 {
	if altitude > 30_000 {
		return 0
	}
	jet := (altitude - 11_000) / 4_000
	return w.surface*math.Exp(-altitude/2_000) + w.jet*math.Exp(-jet*jet)
}

// airVelocity is the atmosphere's velocity at a position: it turns with the
// planet, eastward at the pad, and carries the wind.
func airVelocity(p vec, w wind) vec {
	r := p.length()
	east := vec{p.y / r, -p.x / r}
	return vec{planetSpin * p.y, -planetSpin * p.x}.
		add(east.scale(w.at(r - planetRadius)))
}

// aeroState is the relative wind at a state.
type aeroState struct {
	rel      vec
	speed    float64
	q        float64
	mach     float64
	alpha    float64
	air      air
	altitude float64
}

// aeroAt computes the relative wind, dynamic pressure and angle of attack.
func aeroAt(s state, w wind) aeroState {
	altitude := s.pos.length() - planetRadius
	a := atmosphere(altitude)
	rel := s.vel.sub(airVelocity(s.pos, w))
	speed := rel.length()
	body := angleVec(s.phi)
	alpha := 0.0
	if speed > 1 {
		dir := rel.unit()
		alpha = math.Atan2(dir.cross(body), dir.dot(body))
	}
	return aeroState{
		rel: rel, speed: speed, q: 0.5 * a.density * speed * speed,
		mach: speed / a.speedOfSound, alpha: alpha, air: a, altitude: altitude,
	}
}

// derivative is the rate of change of the rigid-body state.
func derivative(s state, f forces) (dpos, dvel vec, dphi, domega float64) {
	aero := aeroAt(s, f.wind)
	body := angleVec(s.phi)
	normal := vec{-body.y, body.x}
	r := s.pos.length()
	gravity := s.pos.scale(-planetMu / (r * r * r))

	thrust := body.scale(f.fixedThrust + f.propeller*aero.air.density/1.225)
	cosGimbal := math.Sqrt(1 - f.sinGimbal*f.sinGimbal)
	thrust = thrust.add(body.scale(f.gimbalThrust * cosGimbal)).
		add(normal.scale(-f.gimbalThrust * f.sinGimbal))
	torque := f.armGimbal * f.gimbalThrust * f.sinGimbal

	force := thrust
	if aero.speed > 1 {
		wind := aero.rel.unit().scale(-1)
		force = force.add(wind.scale(aero.q * f.dragArea * dragRise(aero.mach)))
		sa, ca := math.Sin(aero.alpha), math.Cos(aero.alpha)
		normalCoefficient := f.cna*sa*ca + 1.2*sa*math.Abs(sa)
		lift := aero.q * f.refArea * normalCoefficient
		force = force.add(normal.scale(lift))
		torque += (f.cp - f.cm) * lift
		torque -= aero.q * f.refArea * f.damping / aero.speed * s.omega
	}
	torque += f.rcs
	return s.vel, force.scale(1 / f.mass).add(gravity), s.omega, torque / f.inertia
}

// rk4 advances the state one step with the forces held constant.
func rk4(s state, f forces, dt float64) state {
	step := func(base state, k1p, k1v vec, k1a, k1w, h float64) state {
		return state{
			pos: base.pos.add(k1p.scale(h)), vel: base.vel.add(k1v.scale(h)),
			phi: base.phi + k1a*h, omega: base.omega + k1w*h,
		}
	}
	p1, v1, a1, w1 := derivative(s, f)
	p2, v2, a2, w2 := derivative(step(s, p1, v1, a1, w1, dt/2), f)
	p3, v3, a3, w3 := derivative(step(s, p2, v2, a2, w2, dt/2), f)
	p4, v4, a4, w4 := derivative(step(s, p3, v3, a3, w3, dt), f)
	return state{
		pos:   s.pos.add(p1.add(p2.scale(2)).add(p3.scale(2)).add(p4).scale(dt / 6)),
		vel:   s.vel.add(v1.add(v2.scale(2)).add(v3.scale(2)).add(v4).scale(dt / 6)),
		phi:   s.phi + (a1+2*a2+2*a3+a4)*dt/6,
		omega: s.omega + (w1+2*w2+2*w3+w4)*dt/6,
	}
}

// orbit is the two-body orbit of a state. timeToApoapsis is infinite for an
// unbound orbit.
type orbit struct {
	apogee, perigee, apogeeRadius, excess float64
	timeToApoapsis                        float64
	bound                                 bool
}

// orbitOf computes apoapsis and periapsis altitudes and the time to
// apoapsis, or excess speed when the state escapes.
func orbitOf(s state) orbit {
	r := s.pos.length()
	v2 := s.vel.dot(s.vel)
	energy := v2/2 - planetMu/r
	h := s.pos.cross(s.vel)
	e := math.Sqrt(math.Max(0, 1+2*energy*h*h/(planetMu*planetMu)))
	if energy >= 0 {
		return orbit{
			apogee: math.Inf(1), apogeeRadius: math.Inf(1),
			perigee:        h*h/planetMu/(1+e) - planetRadius,
			excess:         math.Sqrt(2 * energy),
			timeToApoapsis: math.Inf(1),
		}
	}
	a := -planetMu / (2 * energy)
	return orbit{
		apogee:         a*(1+e) - planetRadius,
		perigee:        a*(1-e) - planetRadius,
		apogeeRadius:   a * (1 + e),
		timeToApoapsis: timeToApoapsis(s, a, e),
		bound:          true,
	}
}

// timeToApoapsis is how long a bound orbit of semi-major axis a and
// eccentricity e takes to reach apoapsis from the state, by Kepler's
// equation, or zero once the state is past apoapsis and falling.
func timeToApoapsis(s state, a, e float64) float64 {
	if e < 1e-6 {
		return 0
	}
	r := s.pos.length()
	radial := s.pos.dot(s.vel) / r
	cosE := clamp((1-r/a)/e, -1, 1)
	anomaly := math.Acos(cosE)
	if radial < 0 {
		anomaly = 2*math.Pi - anomaly
	}
	mean := anomaly - e*math.Sin(anomaly)
	motion := math.Sqrt(planetMu / (a * a * a))
	return math.Max(0, (math.Pi-mean)/motion)
}
