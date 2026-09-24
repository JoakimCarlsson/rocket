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

// flightPlan is how the autopilot flies: its pitch-over kick, and whether
// this is a calm, failure-free rehearsal used to choose that kick.
type flightPlan struct {
	kick      float64
	rehearsal bool
}

// mode is the ascent autopilot's phase.
type mode int

const (
	modeVertical mode = iota
	modePitchover
	modeGravityTurn
	modeGuided
	modeDepart
	modePassive
)

// Autopilot and structure settings.
const (
	targetAltitude   = 200_000.0
	targetPerigee    = 150_000.0
	pitchoverSpeed   = 50.0
	pitchoverAlt     = 1_000.0
	pitchoverLimit   = 20.0
	guidanceStartAlt = 20_000.0
	guidanceEngageQ  = 3_000.0
	guidanceCycle    = 1.0
	terminalHold     = 5.0
	commandSlew      = 2 * math.Pi / 180
	loadReliefStart  = 5_000.0
	driftTolerance   = 3 * math.Pi / 180
	driftGain        = 1.5
	driftSpeed       = 20.0
	loftAltitude     = 60_000.0
	loftMargin       = 5 * math.Pi / 180
	loftQ            = 15_000.0
	maxDriftLean     = 20 * math.Pi / 180
	maxTime          = 4000.0
	sampleEvery      = 0.5
	coastSampleEvery = 5.0
	gimbalRange      = 6 * math.Pi / 180
	controlBand      = 0.6
	controlDamping   = 0.85
	rcsAccel         = 0.02
	qLimitThrottle   = 32_000.0
	minThrottle      = 0.4
	lostControlAoA   = 25 * math.Pi / 180
	qAlphaLimit      = 180_000.0
	hardQLimit       = 200_000.0
	stagingCoast     = 1.5
	fairingAltitude  = 110_000.0
)

// vec is a 2D vector in the Earth-centred inertial plane. The pad starts at
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
// Earth, eastward at the pad, and carries the wind.
func airVelocity(p vec, w wind) vec {
	spin := surfaceSpeed / earthRadius
	r := p.length()
	east := vec{p.y / r, -p.x / r}
	return vec{spin * p.y, -spin * p.x}.add(east.scale(w.at(r - earthRadius)))
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
	altitude := s.pos.length() - earthRadius
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
	gravity := s.pos.scale(-earthMu / (r * r * r))

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

// orbit is the two-body orbit of a state.
type orbit struct {
	apogee, perigee, apogeeRadius, excess float64
	bound                                 bool
}

// orbitOf computes apogee and perigee altitudes, or excess speed when the
// state escapes.
func orbitOf(s state) orbit {
	r := s.pos.length()
	v2 := s.vel.dot(s.vel)
	energy := v2/2 - earthMu/r
	h := math.Abs(s.pos.cross(s.vel))
	e := math.Sqrt(math.Max(0, 1+2*energy*h*h/(earthMu*earthMu)))
	if energy >= 0 {
		return orbit{
			apogee: math.Inf(1), apogeeRadius: math.Inf(1),
			perigee: h*h/earthMu/(1+e) - earthRadius, excess: math.Sqrt(2 * energy),
		}
	}
	a := -earthMu / (2 * energy)
	return orbit{
		apogee: a*(1+e) - earthRadius, perigee: a*(1-e) - earthRadius,
		apogeeRadius: a * (1 + e), bound: true,
	}
}

// failure is a scheduled hardware failure.
type failure struct {
	t    float64
	key  string
	kind string
}

// fly integrates one launch.
func fly(r *Rocket, v *vehicle, rng *rand.Rand, chaos float64, plan flightPlan) flight {
	rs := risks(r, v)
	if plan.rehearsal {
		rs = nil
	}
	riskOf := func(key, kind string) *risk {
		for i := range rs {
			if rs[i].key == key && rs[i].kind == kind {
				return &rs[i]
			}
		}
		return nil
	}
	groups := v.groups()
	attached := v.owners()
	fuel := v.fullTanks()
	alive := map[string]int{}
	for _, g := range groups {
		alive[g.key] = g.engines
	}
	ignited := map[string]bool{}
	failed := map[string]bool{}
	var failures []failure
	var events []Event
	var samples []Sample
	destination := r.Destination
	gLimit := 6.0
	if v.crew > 0 {
		gLimit = 4
	}
	qAlpha := qAlphaLimit * clamp(20/v.slenderness, 0.4, 1.2)
	disturbance := (4 + chaos*0.04) * math.Pi / 180
	weather := newWind(rng)
	if plan.rehearsal {
		weather = wind{}
	}

	s := state{
		pos: vec{0, earthRadius},
		vel: vec{surfaceSpeed, 0},
		phi: math.Pi/2 - r.Tilt*math.Pi/180,
	}
	var (
		t, pauseUntil, maxAltitude, maxQ, maxQTime, maxG, deltaVUsed float64
		lastSample                                                   = -1.0
		stageIndex, engineOuts                                       int
		md                                                           = modeVertical
		enginesOn, lifted, reachedOrbit, stalled, lostControl        bool
		announcedMaxQ, landed                                        bool
		end                                                          flightEnd
		throttle                                                     float64
		gimbalCommand, aoa                                           float64
		saturated                                                    bool
		cachedParts                                                  = -1
		cachedCNA, cachedCP, cachedDrag                              float64
		kick, pitchoverAt, nextGuidance, commandElevation            float64
		guidanceOK, commandSet, memorySet, converged                 bool
		guidanceDir                                                  vec3
		memory                                                       upfgMemory
		lastCommand, cutoffAt                                        float64
		terminal                                                     bool
		hadCommand                                                   bool
		dt0                                                          = 0.05
	)
	enginesOn = true

	emitAt := func(at float64, kind EventType, id string) {
		events = append(events, Event{T: at, Type: kind, ID: id})
	}
	emit := func(kind EventType, id string) { emitAt(t, kind, id) }
	ignite := func(g *group) {
		ignited[g.key] = true
		rk := riskOf(g.key, "engine")
		if rk == nil || rng.Float64() >= rk.p {
			return
		}
		burn := (g.fuel - g.reserve) / math.Max(1, g.engine.flow*float64(g.engines))
		at := t + (0.05+0.9*rng.Float64())*burn
		roll := rng.Float64()
		kind := "explode"
		switch {
		case g.booster && roll >= 0.5:
			kind = "booster_fail"
		case !g.booster && g.engines >= 2 && roll >= 0.3:
			kind = "engine_out"
		case !g.booster && g.engines < 2 && roll >= 0.5:
			kind = "stall"
		}
		failures = append(failures, failure{at, g.key, kind})
	}
	ignite(v.stages[0])
	for _, b := range v.boosters {
		ignite(b)
	}
	if rk := riskOf(upperOwner, "payload"); rk != nil && rng.Float64() < rk.p {
		failures = append(failures, failure{30 + 230*rng.Float64(), upperOwner, "payload_pop"})
	}
	if rk := riskOf("decor", "structure"); rk != nil && rng.Float64() < rk.p {
		failures = append(failures, failure{8 + 112*rng.Float64(), "decor", "explode"})
	}
	if !plan.rehearsal && chaos > 45 && rng.Float64() < chaos/150 {
		emitAt(4+26*rng.Float64(), EventWobble, "")
	}

	target := upfgTarget{
		radius:   earthRadius + targetAltitude,
		velocity: math.Sqrt(earthMu / (earthRadius + targetAltitude)),
	}
	boostersAttached := func() bool {
		for _, b := range v.boosters {
			if attached[b.key] {
				return true
			}
		}
		return false
	}
	boosterSegment := func(coreThrust, coreFlow, coreLeft float64) (upfgStage, float64, float64) {
		var thrust, flow, dropped float64
		burn := math.Inf(1)
		for _, b := range v.boosters {
			if !attached[b.key] {
				continue
			}
			dropped += fuel[b.key]
			for _, item := range v.items {
				if item.owner == b.key {
					dropped += item.mass
				}
			}
			if alive[b.key] == 0 || fuel[b.key] <= 1 {
				continue
			}
			n := float64(alive[b.key])
			thrust += b.engine.thrust(0) * n
			flow += b.engine.flow * n
			burn = math.Min(burn, fuel[b.key]/(b.engine.flow*n))
		}
		if thrust == 0 {
			return upfgStage{}, 0, 0
		}
		burn = math.Min(burn, coreLeft/coreFlow)
		now, _, _ := v.massProperties(attached, fuel)
		total := thrust + coreThrust
		rate := flow + coreFlow
		after := now - rate*burn - (dropped - flow*burn)
		return upfgStage{
			thrust: total, flow: rate, exhaust: total / rate,
			burnTime: burn, mass: now,
		}, after, coreFlow * burn
	}
	upfgStages := func() []upfgStage {
		var out []upfgStage
		for j := stageIndex; j < len(v.stages); j++ {
			g := v.stages[j]
			if failed[g.key] || alive[g.key] == 0 {
				break
			}
			left := fuel[g.key] - g.reserve
			if left <= 1 {
				continue
			}
			engines := float64(alive[g.key])
			thrust := g.engine.thrust(0) * engines
			flow := g.engine.flow * engines
			boosted := 0.0
			if j == stageIndex && boostersAttached() {
				segment, after, burned := boosterSegment(thrust, flow, left)
				if segment.burnTime > 0 {
					out = append(out, segment)
					left -= burned
					boosted = after
				}
			}
			stack := map[string]bool{}
			for k, on := range attached {
				stack[k] = on
			}
			for _, lower := range v.stages[:j] {
				delete(stack, lower.key)
			}
			for _, b := range v.boosters {
				delete(stack, b.key)
			}
			at, _, _ := v.massProperties(stack, fuel)
			if boosted > 0 {
				at = boosted
			}
			exhaust := thrust / flow
			limit := gLimit * g0
			end := at - left
			limited := at
			if g.throttleable {
				limited = thrust / limit
			}
			switch {
			case !g.throttleable || limited <= end:
				out = append(out, upfgStage{
					thrust: thrust, flow: flow, exhaust: exhaust,
					burnTime: left / flow, mass: at,
				})
			case limited >= at:
				out = append(out, upfgStage{
					thrust: thrust, flow: flow, exhaust: exhaust,
					burnTime: exhaust / limit * math.Log(at/end), mass: at, limit: limit,
				})
			default:
				out = append(out,
					upfgStage{
						thrust: thrust, flow: flow, exhaust: exhaust,
						burnTime: (at - limited) / flow, mass: at,
					},
					upfgStage{
						thrust: thrust, flow: flow, exhaust: exhaust,
						burnTime: exhaust / limit * math.Log(limited/end), mass: limited, limit: limit,
					})
			}
		}
		return out
	}
	guide := func(mass float64) (vec3, float64, bool) {
		stages := upfgStages()
		if len(stages) == 0 {
			return vec3{}, 0, false
		}
		r3, v3 := lift3(s.pos), lift3(s.vel)
		if !memorySet {
			memory, memorySet, converged = newUPFG(r3, v3, target), true, false
		}
		iterations := 1
		if !converged {
			iterations = 40
		}
		var dir vec3
		var tgo float64
		for i := range iterations {
			expected := memory.tgo
			if converged {
				expected -= guidanceCycle
			}
			d, next, mem := upfg(stages, target, r3, v3, mass, memory)
			if math.IsNaN(next) || math.IsNaN(d.x) || math.IsInf(next, 0) {
				memorySet, converged = false, false
				return vec3{}, 0, false
			}
			memory, dir, tgo = mem, d, next
			switch {
			case converged && math.Abs(next-expected) > 10:
				converged = false
			case !converged && i > 0 && math.Abs(next-expected) < 0.5:
				converged = true
			}
			if converged {
				break
			}
		}
		return dir, tgo, converged
	}

	stage := func() *group {
		if stageIndex < len(v.stages) {
			return v.stages[stageIndex]
		}
		return nil
	}
	hasFuel := func(g *group) bool { return fuel[g.key] > g.reserve+1e-3 }
	burning := func() []*group {
		if t < pauseUntil || lostControl && md == modePassive {
			return nil
		}
		var out []*group
		for _, g := range groups {
			if !attached[g.key] || !ignited[g.key] || alive[g.key] <= 0 || !hasFuel(g) {
				continue
			}
			if !g.booster && g != stage() {
				continue
			}
			if g.throttleable && (!enginesOn || md == modePassive) {
				continue
			}
			out = append(out, g)
		}
		return out
	}

	for end == "" && t < maxTime {
		aero := aeroAt(s, weather)
		altitude := aero.altitude
		r0 := s.pos.length()
		up := s.pos.scale(1 / r0)
		east := vec{up.y, -up.x}
		vr := s.vel.dot(up)
		vh := s.vel.dot(east)
		orb := orbitOf(s)
		mass, cm, inertia := v.massProperties(attached, fuel)
		if len(attached) != cachedParts {
			cachedParts = len(attached)
			cachedCNA, cachedCP = v.centerOfPressure(attached)
			cachedDrag = v.dragArea(attached)
		}
		cna, cp := cachedCNA, cachedCP
		pressure := aero.air.pressure

		live := burning()
		var fixed, variable, gimballed, armSum float64
		for _, g := range live {
			thrust := g.engine.thrust(pressure) * float64(alive[g.key])
			if g.throttleable {
				variable += thrust
			} else {
				fixed += thrust
			}
			if g.gimbal {
				gimballed += thrust
				armSum += thrust * math.Max(0, cm-g.engineY)
			}
		}
		throttle = 1
		if variable > 0 {
			if aero.q > qLimitThrottle {
				throttle = math.Min(throttle, 1-(aero.q-qLimitThrottle)/8_000)
			}
			throttle = math.Min(throttle, (gLimit*g0*mass-fixed)/variable)
			throttle = clamp(throttle, minThrottle, 1)
		}
		thrust := fixed + variable*throttle
		accel := thrust / mass

		surfaceVel := s.vel.sub(airVelocity(s.pos, wind{}))
		gamma := math.Atan2(surfaceVel.dot(up), surfaceVel.dot(east))
		inertialGamma := math.Atan2(vr, vh)
		if lifted && md == modeVertical && destination != "nowhere" &&
			(aero.speed > pitchoverSpeed || altitude > pitchoverAlt) &&
			math.Abs(math.Pi/2-gamma) < driftTolerance {
			md = modePitchover
			pitchoverAt = t
		}
		if md == modePitchover && (gamma <= math.Pi/2-kick || t-pitchoverAt > pitchoverLimit) {
			md = modeGravityTurn
		}
		if md == modeGuided && terminal && t >= cutoffAt && fixed == 0 {
			enginesOn = false
			md = modePassive
		}
		if (md == modeGravityTurn || md == modeGuided) && altitude > guidanceStartAlt &&
			t >= nextGuidance && !terminal {
			nextGuidance = t + guidanceCycle
			dir, tgo, ok := guide(mass)
			switch {
			case !ok:
				guidanceOK = false
			case md == modeGuided && tgo < terminalHold:
				guidanceDir = dir
				terminal = true
				cutoffAt = t + tgo
			default:
				guidanceDir = dir
				guidanceOK = true
				if md == modeGravityTurn && aero.q < guidanceEngageQ {
					md = modeGuided
				}
			}
		}

		elevation := math.Pi / 2
		switch md {
		case modeVertical:
			elevation = math.Pi / 2
			if surfaceVel.length() > driftSpeed {
				elevation += clamp(driftGain*(math.Pi/2-gamma), -maxDriftLean, maxDriftLean)
			}
		case modePitchover:
			elevation = math.Pi/2 - kick
		case modeGravityTurn:
			relief := clamp((aero.q-loadReliefStart)/loadReliefStart, 0, 1)
			airGamma := math.Atan2(aero.rel.dot(up), aero.rel.dot(east))
			elevation = gamma + relief*wrap(airGamma-gamma)
			floor := math.Pi / 2 * clamp(1-altitude/loftAltitude, 0, 1)
			margin := loftMargin * clamp(1-aero.q/loftQ, 0, 1)
			if accel < 1.1*earthMu/(r0*r0) {
				margin = 0
			}
			elevation = clamp(math.Max(elevation, math.Min(floor, elevation+margin)), 0, math.Pi/2-kick)
		case modeGuided:
			if guidanceOK {
				elevation = math.Atan2(guidanceDir.dot(lift3(up)), guidanceDir.dot(lift3(east)))
			} else {
				elevation = inertialGamma
			}
		case modeDepart:
			elevation = inertialGamma
		case modePassive:
			elevation = gamma
		}
		if destination == "nowhere" {
			elevation = math.Pi / 2
		}
		if lifted {
			if !commandSet {
				commandElevation, commandSet = elevation, true
			}
			step := commandSlew * math.Max(dt0, 0.05)
			if md == modeGravityTurn || md == modeVertical || md == modePitchover {
				step = math.Pi
			}
			commandElevation += clamp(wrap(elevation-commandElevation), -step, step)
			elevation = commandElevation
		}
		command := math.Atan2(east.y*math.Cos(elevation)+up.y*math.Sin(elevation),
			east.x*math.Cos(elevation)+up.x*math.Sin(elevation))
		errAngle := wrap(command - s.phi)
		commandRate := 0.0
		if hadCommand {
			commandRate = clamp(wrap(command-lastCommand)/dt0, -0.2, 0.2)
		}
		lastCommand, hadCommand = command, true
		want := inertia * (controlBand*controlBand*errAngle + 2*controlDamping*controlBand*(commandRate-s.omega))
		aeroTorque := 0.0
		if aero.speed > 1 {
			sa, ca := math.Sin(aero.alpha), math.Cos(aero.alpha)
			aeroTorque = (cp - cm) * aero.q * v.refArea * (cna*sa*ca + 1.2*sa*math.Abs(sa))
		}
		arm := 0.0
		if gimballed > 0 {
			arm = armSum / gimballed
		}
		gimbalThrust := gimballed
		if variable > 0 {
			gimbalThrust = 0
			for _, g := range live {
				if g.gimbal {
					scale := 1.0
					if g.throttleable {
						scale = throttle
					}
					gimbalThrust += g.engine.thrust(pressure) * float64(alive[g.key]) * scale
				}
			}
		}
		gimbalCommand = 0
		saturated = true
		if gimbalThrust > 0 && arm > 0 {
			ideal := (want - aeroTorque) / (gimbalThrust * arm)
			gimbalCommand = clamp(ideal, -math.Sin(gimbalRange), math.Sin(gimbalRange))
			saturated = math.Abs(ideal) > math.Sin(gimbalRange)
		}
		rcs := 0.0
		if lifted && hasControl(v, attached) {
			rest := want - aeroTorque - gimbalCommand*gimbalThrust*arm
			rcs = clamp(rest, -inertia*rcsAccel, inertia*rcsAccel)
		}
		if !lifted {
			rcs, gimbalCommand = 0, 0
		}

		dt := 0.05
		switch {
		case !lifted || aero.q > 50:
		case len(live) > 0:
			dt = 0.1
		default:
			dt = 0.5
		}
		dt0 = dt

		if !lifted {
			weight := mass * earthMu / (r0 * r0)
			if thrust*angleVec(s.phi).dot(up) > weight {
				lifted = true
				kick = plan.kick
				emit(EventLiftoff, "")
			} else if t > 8 || len(live) == 0 {
				end = endPad
				break
			}
		}

		fixedThrust := 0.0
		for _, g := range live {
			if !g.gimbal {
				scale := 1.0
				if g.throttleable {
					scale = throttle
				}
				fixedThrust += g.engine.thrust(pressure) * float64(alive[g.key]) * scale
			}
		}
		f := forces{
			mass: mass, cm: cm, inertia: inertia,
			fixedThrust: fixedThrust, gimbalThrust: gimbalThrust,
			sinGimbal: gimbalCommand, armGimbal: arm, rcs: rcs,
			dragArea: cachedDrag, cna: cna, cp: cp,
			damping: v.dampingSum(attached, cm), refArea: v.refArea,
			propeller: v.propellerThrust, wind: weather,
		}
		if lifted {
			next := rk4(s, f, dt)
			sensed := next.vel.sub(s.vel).scale(1 / dt).sub(s.pos.scale(-earthMu / (r0 * r0 * r0)))
			maxG = math.Max(maxG, sensed.length()/g0)
			s = next
			deltaVUsed += thrust / mass * dt
		} else {
			s.vel = airVelocity(s.pos, wind{})
			s.pos = s.pos.add(s.vel.scale(dt))
		}
		for _, g := range live {
			scale := 1.0
			if g.throttleable {
				scale = throttle
			}
			fuel[g.key] = math.Max(g.reserve, fuel[g.key]-g.engine.flow*float64(alive[g.key])*scale*dt)
		}

		t += dt
		aoa = aero.alpha
		maxAltitude = math.Max(maxAltitude, altitude)
		if aero.q > maxQ {
			maxQ, maxQTime = aero.q, t
		} else if !announcedMaxQ && maxQ > 5_000 && aero.q < maxQ*0.9 {
			announcedMaxQ = true
			emitAt(maxQTime, EventMaxQ, "")
		}
		every := sampleEvery
		if len(live) == 0 && aero.q < 50 {
			every = coastSampleEvery
		}
		if t-lastSample >= every {
			lastSample = t
			localUp := math.Atan2(s.pos.x, s.pos.y)
			pitch := wrap(math.Pi/2-s.phi-localUp) * 180 / math.Pi
			samples = append(samples, Sample{
				T:         round(t, 0.01),
				Altitude:  round(math.Max(0, s.pos.length()-earthRadius), 1),
				Downrange: round((localUp-surfaceSpeed/earthRadius*t)*earthRadius, 1),
				Speed:     round(aero.speed, 0.1),
				Pitch:     round(pitch, 0.01),
				AoA:       round(aoa*180/math.Pi, 0.01),
				Q:         round(aero.q, 1),
				Mach:      round(aero.mach, 0.01),
				Throttle:  round(throttle*boolf(len(live) > 0), 0.01),
				G:         round(accel/g0, 0.01),
			})
		}

		if lifted && s.pos.length() < earthRadius && s.vel.dot(up) < 0 {
			emit(EventImpact, "")
			switch {
			case stalled:
				end = endStall
			case lostControl:
				end = endSpin
			default:
				end = endCrash
			}
			break
		}

		for i := 0; i < len(failures); i++ {
			fl := failures[i]
			if fl.t > t {
				continue
			}
			failures = append(failures[:i], failures[i+1:]...)
			i--
			var g *group
			for _, candidate := range groups {
				if candidate.key == fl.key {
					g = candidate
				}
			}
			if g != nil && (!attached[g.key] || !hasFuel(g)) {
				continue
			}
			id := ""
			if g != nil {
				id = g.id
			}
			switch fl.kind {
			case "payload_pop":
				emit(EventPayloadPop, "")
				end = endPayload
			case "explode":
				emit(EventExplode, id)
				end = endExplode
			case "engine_out":
				alive[g.key]--
				engineOuts++
				emit(EventEngineOut, id)
			case "booster_fail":
				failed[g.key] = true
				delete(attached, g.key)
				emit(EventBoosterFail, id)
			case "stall":
				alive[g.key] = 0
				failed[g.key] = true
				stalled = true
				md = modePassive
				emit(EventStall, id)
			}
		}
		if end != "" {
			break
		}

		if lifted && len(live) > 0 && !lostControl && aero.q > 2_000 && math.Abs(aoa) > lostControlAoA+disturbance {
			lostControl = true
			md = modePassive
			enginesOn = false
			emit(EventSpin, "")
		}
		bending := aero.q*math.Abs(aoa)*180/math.Pi > qAlpha
		if lifted && (bending || aero.q > hardQLimit) {
			emit(EventExplode, "")
			switch {
			case stalled:
				end = endStall
			case len(live) == 0 && vr < 0 && maxAltitude >= karmanLine:
				end = endSuborbital
			case len(live) == 0 && vr < 0:
				end = endCrash
			case bending && (lostControl || saturated):
				end = endSpin
			default:
				end = endBreakup
			}
			break
		}

		if v.hasFairing && attached[fairingOwner] && altitude > fairingAltitude {
			delete(attached, fairingOwner)
			emit(EventFairingSep, "")
		}

		var boosters []*group
		for _, b := range v.boosters {
			if attached[b.key] {
				boosters = append(boosters, b)
			}
		}
		if len(boosters) > 0 {
			empty := true
			for _, b := range boosters {
				if hasFuel(b) {
					empty = false
				}
			}
			if empty {
				for _, b := range boosters {
					delete(attached, b.key)
				}
				emit(EventBoosterSep, "")
			}
		}

		if cur := stage(); lifted && cur != nil && attached[cur.key] && !hasFuel(cur) &&
			len(boosters) == 0 && !lostControl && !failed[cur.key] {
			if stageIndex+1 >= len(v.stages) {
				if md != modePassive {
					emit(EventBurnout, "")
				}
				md = modePassive
			} else {
				next := v.stages[stageIndex+1]
				delete(attached, cur.key)
				emit(EventStageSep, cur.id)
				if stageIndex == 0 && r.Legs != nil {
					landed = rng.Float64() < 0.9
				}
				stageIndex++
				pauseUntil = t + stagingCoast
				if rk := riskOf(next.key, "separation"); rk != nil && rng.Float64() < rk.p {
					failed[next.key] = true
					alive[next.key] = 0
					stalled = true
					md = modePassive
					emitAt(t+stagingCoast, EventStall, next.id)
				} else {
					ignite(next)
				}
			}
		}

		if !reachedOrbit && orb.bound && orb.perigee >= targetPerigee {
			reachedOrbit = true
			emit(EventOrbit, "")
			if destination == "orbit" || plan.rehearsal {
				end = endGoal
				break
			}
			md = modeDepart
			enginesOn = true
		}
		if reachedOrbit || md == modeDepart || md == modePassive {
			if destination == "moon" && orb.apogeeRadius >= lunarDistance {
				end = endGoal
				break
			}
			if need, ok := excessSpeedNeeded[destination]; ok && orb.excess >= need {
				end = endGoal
				break
			}
		}
		if destination == "nowhere" && maxAltitude >= karmanLine && vr < 0 {
			end = endGoal
			break
		}
		if md == modePassive && len(burning()) == 0 {
			switch {
			case !orb.bound:
				end = endEscape
			case orb.perigee >= 120_000:
				end = endOrbit
			case maxAltitude >= karmanLine && vr < 0 && !lostControl && !stalled:
				end = endSuborbital
			}
		}
	}

	if end == "" {
		switch {
		case stalled:
			end = endStall
		case maxAltitude >= karmanLine:
			end = endSuborbital
		default:
			end = endCrash
		}
	}
	final := orbitOf(s)
	fuelLeft := 0.0
	for _, g := range v.stages {
		if attached[g.key] {
			fuelLeft += math.Max(0, fuel[g.key]-g.reserve)
		}
	}
	var used []usage
	for _, g := range groups {
		usable := math.Max(1, g.fuel-g.reserve)
		used = append(used, usage{
			key: g.key, ignited: ignited[g.key],
			burned: clamp(1-(fuel[g.key]-g.reserve)/usable, 0, 1), failed: failed[g.key],
		})
	}
	sortEvents(events)
	return flight{
		end: end, events: events, samples: samples, duration: t,
		maxAltitude: maxAltitude, maxQ: maxQ, maxG: maxG,
		apogee: final.apogee, perigee: final.perigee, bound: final.bound,
		excessSpeed: final.excess, deltaVUsed: deltaVUsed, usage: used,
		landed: landed, engineOuts: engineOuts,
		fuelLeft: fuelLeft,
		energy:   s.vel.dot(s.vel)/2 - earthMu/s.pos.length(),
		orbited:  reachedOrbit,
	}
}

// hasControl reports whether the attached stack carries avionics that can
// run reaction control: any gimballed engine counts.
func hasControl(v *vehicle, attached map[string]bool) bool {
	for _, g := range v.groups() {
		if attached[g.key] && g.gimbal {
			return true
		}
	}
	return false
}

// round rounds v to a multiple of step.
func round(v, step float64) float64 {
	return math.Round(v/step) * step
}

// boolf is 1 for true and 0 for false.
func boolf(b bool) float64 {
	if b {
		return 1
	}
	return 0
}

// sortEvents orders events by time, keeping insertion order for ties.
func sortEvents(events []Event) {
	for i := 1; i < len(events); i++ {
		for j := i; j > 0 && events[j].T < events[j-1].T; j-- {
			events[j], events[j-1] = events[j-1], events[j]
		}
	}
}
