package physics

import (
	"math"
	"math/rand/v2"
)

// Autopilot and structure settings.
const (
	targetApoapsis    = 80_000.0
	turnStartSpeed    = 60.0
	turnStartAlt      = 1_000.0
	aoaBudget         = 40_000.0
	minTurnAoA        = 1 * math.Pi / 180
	coastAttitudeAlt  = 60_000.0
	coastAttitudeQ    = 300.0
	holdTime          = 15.0
	safeClearance     = 5_000.0
	climbTime         = 30.0
	maxHoldClimb      = 150.0
	circularizeLead   = 1.0
	maxCoast          = 150.0
	circularized      = 3_000.0
	flattenAltitude   = 45_000.0
	flattenClimb      = 30.0
	reburnMargin      = 1_500.0
	qThrottle         = 35_000.0
	pullUpAltitude    = 5_000.0
	pullUpPath        = 40 * math.Pi / 180
	minTimeToApoapsis = 40.0
	minThrottle       = 0.35
	maxTime           = 3000.0
	sampleEvery       = 0.25
	coastSampleEvery  = 2.0
	gimbalRange       = 6 * math.Pi / 180
	controlBand       = 0.8
	controlDamping    = 0.9
	wheelAccel        = 0.04
	wheelTorque       = 3e5
	hopApoapsis       = 90_000.0
	lostControlAoA    = 25 * math.Pi / 180
	qAlphaLimit       = 250_000.0
	hardQLimit        = 90_000.0
	stagingCoast      = 1.0
	fairingAltitude   = 50_000.0
	liftoffTimeout    = 8.0
)

// phase is what the ascent autopilot is doing.
type phase int

const (
	phaseVertical phase = iota
	phaseAscent
	phaseCoast
	phaseCircularize
	phaseDepart
	phaseHop
	phasePassive
)

// ascentProfile is the autopilot's gravity turn, as in MechJeb's classic
// ascent: the flight path leans from vertical at the start of the turn to
// horizontal at turnEnd, following (fraction of the way)^shape.
type ascentProfile struct {
	turnEnd float64
	shape   float64
}

// flightPlan is how the autopilot flies, and whether this is a
// failure-free rehearsal, in the given weather, used to choose the profile.
type flightPlan struct {
	profile   ascentProfile
	rehearsal bool
	weather   wind
}

// failure is a scheduled hardware failure.
type failure struct {
	t    float64
	key  string
	kind string
}

// nav is where the vehicle is and how it moves, in the local frame.
type nav struct {
	aero      aeroState
	radius    float64
	up, east  vec
	climb     float64
	across    float64
	orbit     orbit
	airPath   float64
	surface   float64
	inertPath float64
}

// flyer integrates one launch. It owns the vehicle's changing state: which
// parts are attached, what fuel is left, the autopilot phase and the record.
type flyer struct {
	r           *Rocket
	v           *vehicle
	rng         *rand.Rand
	plan        flightPlan
	risks       []risk
	groups      []*group
	attached    map[string]bool
	fuel        map[string]float64
	alive       map[string]int
	ignited     map[string]bool
	failed      map[string]bool
	failures    []failure
	events      []Event
	samples     []Sample
	weather     wind
	gLimit      float64
	qAlpha      float64
	disturbance float64
	goal        string

	s          state
	t          float64
	phase      phase
	stageIndex int
	turnFrom   float64
	pauseUntil float64
	lifted     bool
	lost       bool
	stalled    bool
	orbited    bool
	end        flightEnd

	lastCommand float64
	hadCommand  bool
	lastSample  float64
	parts       int
	cna, cp     float64
	dragArea    float64

	maxAltitude, maxQ, maxQTime, maxG, deltaVUsed float64
	announcedMaxQ, landed                         bool
	engineOuts                                    int
}

// fly integrates one launch.
func fly(r *Rocket, v *vehicle, rng *rand.Rand, chaos float64, plan flightPlan) flight {
	f := newFlyer(r, v, rng, chaos, plan)
	for f.end == "" && f.t < maxTime {
		f.step()
	}
	return f.result()
}

// newFlyer puts the vehicle on the pad and rolls the day's dice: weather,
// and which hardware fails when.
func newFlyer(r *Rocket, v *vehicle, rng *rand.Rand, chaos float64, plan flightPlan) *flyer {
	f := &flyer{
		r: r, v: v, rng: rng, plan: plan,
		groups:      v.groups(),
		attached:    v.owners(),
		fuel:        v.fullTanks(),
		alive:       map[string]int{},
		ignited:     map[string]bool{},
		failed:      map[string]bool{},
		gLimit:      6,
		qAlpha:      qAlphaLimit * clamp(20/v.slenderness, 0.4, 1.2),
		disturbance: (4 + chaos*0.04) * math.Pi / 180,
		goal:        r.Destination,
		lastSample:  -1,
		parts:       -1,
		s: state{
			pos: vec{0, planetRadius},
			vel: vec{surfaceSpeed, 0},
			phi: math.Pi/2 - r.Tilt*math.Pi/180,
		},
	}
	if v.crew > 0 {
		f.gLimit = 4
	}
	for _, g := range f.groups {
		f.alive[g.key] = g.engines
	}
	if plan.rehearsal {
		f.goal = "orbit"
		f.weather = plan.weather
	} else {
		f.risks = risks(r, v)
		f.weather = newWind(rng)
	}
	if f.goal == "nowhere" {
		f.phase = phaseHop
	}
	f.ignite(v.stages[0])
	for _, b := range v.boosters {
		f.ignite(b)
	}
	if rk := f.riskOf(upperOwner, "payload"); rk != nil && rng.Float64() < rk.p {
		f.failures = append(f.failures, failure{20 + 160*rng.Float64(), upperOwner, "payload_pop"})
	}
	if rk := f.riskOf("decor", "structure"); rk != nil && rng.Float64() < rk.p {
		f.failures = append(f.failures, failure{8 + 90*rng.Float64(), "decor", "explode"})
	}
	if !plan.rehearsal && chaos > 45 && rng.Float64() < chaos/150 {
		f.emitAt(4+26*rng.Float64(), EventWobble, "")
	}
	return f
}

// riskOf finds one hardware risk of this flight.
func (f *flyer) riskOf(key, kind string) *risk {
	for i := range f.risks {
		if f.risks[i].key == key && f.risks[i].kind == kind {
			return &f.risks[i]
		}
	}
	return nil
}

// emitAt records an event at a given time.
func (f *flyer) emitAt(at float64, kind EventType, id string) {
	f.events = append(f.events, Event{T: at, Type: kind, ID: id})
}

// emit records an event now.
func (f *flyer) emit(kind EventType, id string) { f.emitAt(f.t, kind, id) }

// ignite lights a group and rolls whether, and when, it fails.
func (f *flyer) ignite(g *group) {
	f.ignited[g.key] = true
	rk := f.riskOf(g.key, "engine")
	if rk == nil || f.rng.Float64() >= rk.p {
		return
	}
	burn := (g.fuel - g.reserve) / math.Max(1, g.engine.flow*float64(g.engines))
	at := f.t + (0.05+0.9*f.rng.Float64())*burn
	roll := f.rng.Float64()
	kind := "explode"
	switch {
	case g.booster && roll >= 0.5:
		kind = "booster_fail"
	case !g.booster && g.engines >= 2 && roll >= 0.3:
		kind = "engine_out"
	case !g.booster && g.engines < 2 && roll >= 0.5:
		kind = "stall"
	}
	f.failures = append(f.failures, failure{at, g.key, kind})
}

// stage is the core stage currently in charge, or nil past the last one.
func (f *flyer) stage() *group {
	if f.stageIndex < len(f.v.stages) {
		return f.v.stages[f.stageIndex]
	}
	return nil
}

// hasFuel reports whether a group has usable propellant left.
func (f *flyer) hasFuel(g *group) bool { return f.fuel[g.key] > g.reserve+1e-3 }

// wantsThrust reports whether the autopilot wants the throttleable engines on.
func (f *flyer) wantsThrust() bool {
	switch f.phase {
	case phaseCoast, phasePassive:
		return false
	}
	return true
}

// burning lists the groups producing thrust now. Solid motors burn until
// empty once lit; liquid engines follow the autopilot.
func (f *flyer) burning() []*group {
	if f.t < f.pauseUntil || f.lost {
		return nil
	}
	var out []*group
	for _, g := range f.groups {
		if !f.attached[g.key] || !f.ignited[g.key] || f.alive[g.key] <= 0 || !f.hasFuel(g) {
			continue
		}
		if !g.booster && g != f.stage() {
			continue
		}
		if g.throttleable && !f.wantsThrust() {
			continue
		}
		out = append(out, g)
	}
	return out
}

// boostersAttached lists the strap-on boosters still on the vehicle.
func (f *flyer) boostersAttached() []*group {
	var out []*group
	for _, b := range f.v.boosters {
		if f.attached[b.key] {
			out = append(out, b)
		}
	}
	return out
}

// navigate works out the local frame, flight-path angles and orbit.
func (f *flyer) navigate() nav {
	aero := aeroAt(f.s, f.weather)
	r := f.s.pos.length()
	up := f.s.pos.scale(1 / r)
	east := vec{up.y, -up.x}
	surface := f.s.vel.sub(airVelocity(f.s.pos, wind{}))
	return nav{
		aero: aero, radius: r, up: up, east: east,
		climb:     f.s.vel.dot(up),
		across:    f.s.vel.dot(east),
		orbit:     orbitOf(f.s),
		airPath:   math.Atan2(aero.rel.dot(up), aero.rel.dot(east)),
		surface:   surface.length(),
		inertPath: math.Atan2(f.s.vel.dot(up), f.s.vel.dot(east)),
	}
}

// refreshAero recomputes the aerodynamic sums when parts come off.
func (f *flyer) refreshAero() {
	if len(f.attached) == f.parts {
		return
	}
	f.parts = len(f.attached)
	f.cna, f.cp = f.v.centerOfPressure(f.attached)
	f.dragArea = f.v.dragArea(f.attached)
}

// stageAhead is the vacuum thrust and propellant flow the next core burn
// would have at full throttle: the current stage, or the next one with fuel.
func (f *flyer) stageAhead() (thrust, flow float64) {
	for j := f.stageIndex; j < len(f.v.stages); j++ {
		g := f.v.stages[j]
		if f.failed[g.key] || f.fuel[g.key] <= g.reserve+1 {
			continue
		}
		n := float64(f.alive[g.key])
		return g.engine.thrust(0) * n, g.engine.flow * n
	}
	return 0, 0
}

// circularizeBurn estimates the burn at apoapsis that would round the orbit
// off: its delta-v and its duration at full throttle.
func (f *flyer) circularizeBurn(n nav, mass float64) (deltaV, duration float64) {
	o := n.orbit
	if !o.bound {
		return 0, 0
	}
	h := math.Abs(f.s.pos.cross(f.s.vel))
	deltaV = math.Max(0, circularSpeed(o.apogeeRadius)-h/o.apogeeRadius)
	thrust, flow := f.stageAhead()
	if thrust <= 0 {
		return deltaV, math.Inf(1)
	}
	exhaust := thrust / flow
	return deltaV, mass / flow * (1 - math.Exp(-deltaV/exhaust))
}

// advancePhase moves the autopilot through its program.
func (f *flyer) advancePhase(n nav, mass float64) {
	alt := n.aero.altitude
	o := n.orbit
	switch f.phase {
	case phaseVertical:
		if f.lifted && (n.surface > turnStartSpeed || alt > turnStartAlt) {
			f.phase = phaseAscent
			f.turnFrom = alt
		}
	case phaseAscent:
		switch {
		case o.apogee >= targetApoapsis && o.timeToApoapsis > maxCoast:
			f.phase = phaseCircularize
		case o.apogee >= targetApoapsis:
			f.phase = phaseCoast
		case alt > flattenAltitude && n.climb < flattenClimb:
			f.phase = phaseCircularize
		}
	case phaseCoast:
		_, duration := f.circularizeBurn(n, mass)
		switch {
		case alt < atmosphereTop && o.apogee < targetApoapsis-reburnMargin:
			f.phase = phaseAscent
		case o.timeToApoapsis <= duration/2+circularizeLead:
			f.phase = phaseCircularize
		}
	case phaseHop:
		if o.apogee >= hopApoapsis {
			f.phase = phasePassive
		}
	case phaseCircularize:
		enough := math.Min(math.Min(o.apogee, targetApoapsis)-circularized, atmosphereTop+safeClearance)
		if o.bound && o.perigee >= atmosphereTop && o.perigee >= enough {
			f.orbitReached()
		}
	}
}

// orbitReached finishes the ascent: an orbit mission is done, anything
// further departs for its destination.
func (f *flyer) orbitReached() {
	if f.goal == "orbit" {
		f.end = endGoal
		return
	}
	f.phase = phaseDepart
}

// throttle is the setting for the throttleable engines: full, eased off for
// dynamic pressure and the g limit, and trimmed as a burn's target nears.
func (f *flyer) throttle(n nav, mass, fixed, variable float64) float64 {
	if variable <= 0 {
		return 1
	}
	t := 1.0
	switch f.phase {
	case phaseVertical, phaseAscent, phaseHop:
		if n.aero.q > qThrottle {
			t = 1 - (n.aero.q-qThrottle)/8_000
		}
		if f.phase == phaseAscent {
			t = math.Min(t, (targetApoapsis-n.orbit.apogee)/3_000)
		}
	case phaseCircularize:
		remaining := circularSpeed(n.radius) - n.across
		t = remaining / math.Max(1e-3, 2*(fixed+variable)/mass)
	}
	t = math.Min(t, (f.gLimit*g0*mass-fixed)/variable)
	return clamp(t, minThrottle, 1)
}

// elevation is the thrust direction the autopilot wants, as an angle above
// the local horizon. accel is the thrust acceleration now; while coasting the
// vehicle lines up for the burn to come using the next stage's.
func (f *flyer) elevation(n nav, accel, mass float64) float64 {
	switch f.phase {
	case phaseAscent:
		span := math.Max(1, f.plan.profile.turnEnd-f.turnFrom)
		fraction := clamp((n.aero.altitude-f.turnFrom)/span, 0, 1)
		program := math.Pi / 2 * (1 - math.Pow(fraction, f.plan.profile.shape))
		return clamp(f.limitAoA(n, program, f.pullUp(n)), 0, math.Pi/2)
	case phaseCoast:
		if n.aero.altitude < coastAttitudeAlt && n.aero.q > coastAttitudeQ {
			return n.airPath
		}
		thrust, _ := f.stageAhead()
		return f.holdAltitude(n, thrust/mass)
	case phaseCircularize:
		return f.holdAltitude(n, accel)
	case phaseDepart:
		return n.inertPath
	case phasePassive:
		return n.airPath
	}
	return math.Pi / 2
}

// limitAoA keeps a commanded elevation within the angle of attack the air
// allows: generous in thin air, a degree or two through max-Q. pullUp, from
// 0 to 1, raises the nose above the flight path by up to twice that angle.
// A path drifting west of vertical counts as vertical, so the turn always
// goes east.
func (f *flyer) limitAoA(n nav, want, pullUp float64) float64 {
	if n.aero.speed < 30 {
		return want
	}
	path := math.Min(n.airPath, math.Pi/2)
	limit := clamp(aoaBudget/math.Max(1, n.aero.q)*math.Pi/180, minTurnAoA, math.Pi/2)
	limited := path + clamp(want-path, -limit, limit)
	if pullUp <= 0 {
		return limited
	}
	return math.Max(limited, path+2*limit*pullUp)
}

// pullUp is how hard the ascent should raise its nose, from 0 to 1, because
// apoapsis is coming up too soon on a flight path that has already turned
// well over: a rocket that levels off in the air while short of its target
// apoapsis only drags itself back down.
func (f *flyer) pullUp(n nav) float64 {
	if n.aero.altitude < pullUpAltitude || n.orbit.apogee >= targetApoapsis ||
		n.airPath > pullUpPath {
		return 0
	}
	return clamp((minTimeToApoapsis-n.orbit.timeToApoapsis)/minTimeToApoapsis, 0, 1)
}

// holdAltitude points the thrust mostly horizontal, tilted just enough to
// bring the climb rate to what the burn wants over holdTime and to make up
// the gravity that orbital speed does not yet balance. Below the edge of
// space the burn keeps climbing gently, since an orbit must clear the air.
func (f *flyer) holdAltitude(n nav, accel float64) float64 {
	if accel <= 0 {
		return 0
	}
	wantClimb := clamp((atmosphereTop+safeClearance-n.aero.altitude)/climbTime, 0, maxHoldClimb)
	deficit := gravityAt(n.radius) - n.across*n.across/n.radius
	vertical := deficit + (wantClimb-n.climb)/holdTime
	return math.Asin(clamp(vertical/accel, -0.1, 0.9))
}

// step advances the flight by one integration step.
func (f *flyer) step() {
	n := f.navigate()
	aero := n.aero
	mass, cm, inertia := f.v.massProperties(f.attached, f.fuel)
	f.refreshAero()
	f.advancePhase(n, mass)
	if f.end != "" {
		return
	}

	live := f.burning()
	pressure := aero.air.pressure
	var fixed, variable float64
	for _, g := range live {
		thrust := g.engine.thrust(pressure) * float64(f.alive[g.key])
		if g.throttleable {
			variable += thrust
		} else {
			fixed += thrust
		}
	}
	throttle := f.throttle(n, mass, fixed, variable)
	scaleOf := func(g *group) float64 {
		if g.throttleable {
			return throttle
		}
		return 1
	}
	var gimballed, armSum, rigid float64
	for _, g := range live {
		thrust := g.engine.thrust(pressure) * float64(f.alive[g.key]) * scaleOf(g)
		if g.gimbal {
			gimballed += thrust
			armSum += thrust * math.Max(0, cm-g.engineY)
		} else {
			rigid += thrust
		}
	}
	thrust := fixed + variable*throttle
	accel := thrust / mass

	elevation := f.elevation(n, accel, mass)
	command := math.Atan2(n.east.y*math.Cos(elevation)+n.up.y*math.Sin(elevation),
		n.east.x*math.Cos(elevation)+n.up.x*math.Sin(elevation))

	dt := 0.05
	switch {
	case !f.lifted || aero.q > 50:
	case len(live) > 0:
		dt = 0.1
	default:
		dt = 0.5
	}

	arm := 0.0
	if gimballed > 0 {
		arm = armSum / gimballed
	}
	gimbal, wheels, saturated := f.control(command, dt, aero, cm, inertia, gimballed, arm)

	if !f.lifted {
		weight := mass * gravityAt(n.radius)
		if thrust*angleVec(f.s.phi).dot(n.up) > weight {
			f.lifted = true
			f.emit(EventLiftoff, "")
		} else if f.t > liftoffTimeout || len(live) == 0 {
			f.end = endPad
			return
		}
	}

	forces := forces{
		mass: mass, cm: cm, inertia: inertia,
		fixedThrust: rigid, gimbalThrust: gimballed,
		sinGimbal: gimbal, armGimbal: arm, rcs: wheels,
		dragArea: f.dragArea, cna: f.cna, cp: f.cp,
		damping: f.v.dampingSum(f.attached, cm), refArea: f.v.refArea,
		propeller: f.v.propellerThrust, wind: f.weather,
	}
	if f.lifted {
		next := rk4(f.s, forces, dt)
		gravity := f.s.pos.scale(-planetMu / (n.radius * n.radius * n.radius))
		sensed := next.vel.sub(f.s.vel).scale(1 / dt).sub(gravity)
		f.maxG = math.Max(f.maxG, sensed.length()/g0)
		f.s = next
		f.deltaVUsed += accel * dt
	} else {
		f.s.vel = airVelocity(f.s.pos, wind{})
		f.s.pos = f.s.pos.add(f.s.vel.scale(dt))
	}
	for _, g := range live {
		used := g.engine.flow * float64(f.alive[g.key]) * scaleOf(g) * dt
		f.fuel[g.key] = math.Max(g.reserve, f.fuel[g.key]-used)
	}

	f.t += dt
	f.track(aero)
	f.record(aero, throttle*boolf(len(live) > 0), accel, len(live) > 0)
	f.checkImpact()
	if f.end == "" {
		f.checkFailures()
	}
	if f.end == "" {
		f.checkStructure(aero, len(live) > 0, saturated)
	}
	if f.end == "" {
		f.separate()
		f.checkGoals()
	}
}

// control is the attitude controller: a critically damped pitch loop that
// asks the gimbal for torque first and the reaction wheels for the rest,
// feeding forward the aerodynamic torque it expects. The wheels have a fixed
// torque, so they steer a small rocket briskly and a big one barely.
// saturated reports that both asked for more than they have.
func (f *flyer) control(command, dt float64, aero aeroState, cm, inertia, gimballed, arm float64) (gimbal, wheels float64, saturated bool) {
	commandRate := 0.0
	if f.hadCommand {
		commandRate = clamp(wrap(command-f.lastCommand)/dt, -0.2, 0.2)
	}
	f.lastCommand, f.hadCommand = command, true
	if !f.lifted || f.lost {
		return 0, 0, f.lost
	}
	errAngle := wrap(command - f.s.phi)
	want := inertia * (controlBand*controlBand*errAngle +
		2*controlDamping*controlBand*(commandRate-f.s.omega))
	aeroTorque := 0.0
	if aero.speed > 1 {
		sa, ca := math.Sin(aero.alpha), math.Cos(aero.alpha)
		aeroTorque = (f.cp - cm) * aero.q * f.v.refArea * (f.cna*sa*ca + 1.2*sa*math.Abs(sa))
	}
	if gimballed > 0 && arm > 0 {
		gimbal = clamp((want-aeroTorque)/(gimballed*arm), -math.Sin(gimbalRange), math.Sin(gimbalRange))
	}
	rest := want - aeroTorque - gimbal*gimballed*arm
	wheel := math.Min(inertia*wheelAccel, wheelTorque)
	return gimbal, clamp(rest, -wheel, wheel), math.Abs(rest) > wheel
}

// track updates the flight's peak readings and announces max-Q once passed.
func (f *flyer) track(aero aeroState) {
	f.maxAltitude = math.Max(f.maxAltitude, aero.altitude)
	if aero.q > f.maxQ {
		f.maxQ, f.maxQTime = aero.q, f.t
	} else if !f.announcedMaxQ && f.maxQ > 5_000 && aero.q < f.maxQ*0.9 {
		f.announcedMaxQ = true
		f.emitAt(f.maxQTime, EventMaxQ, "")
	}
}

// record stores a trajectory sample, densely while powered or in the air.
func (f *flyer) record(aero aeroState, throttle, accel float64, powered bool) {
	every := sampleEvery
	if !powered && aero.q < 50 {
		every = coastSampleEvery
	}
	if f.t-f.lastSample < every {
		return
	}
	f.lastSample = f.t
	f.samples = append(f.samples, f.sample(throttle, accel))
}

// sample is the vehicle's state now, in the ground-relative terms the web
// app plays back.
func (f *flyer) sample(throttle, accel float64) Sample {
	aero := aeroAt(f.s, f.weather)
	r := f.s.pos.length()
	up := f.s.pos.scale(1 / r)
	east := vec{up.y, -up.x}
	localUp := math.Atan2(f.s.pos.x, f.s.pos.y)
	pitch := wrap(math.Pi/2-f.s.phi-localUp) * 180 / math.Pi
	return Sample{
		T:         round(f.t, 0.01),
		Altitude:  round(math.Max(0, r-planetRadius), 0.1),
		Downrange: round((localUp-planetSpin*f.t)*planetRadius, 0.1),
		Speed:     round(aero.speed, 0.1),
		Pitch:     round(pitch, 0.01),
		AoA:       round(aero.alpha*180/math.Pi, 0.01),
		Q:         round(aero.q, 1),
		Mach:      round(aero.mach, 0.01),
		Throttle:  round(throttle, 0.01),
		G:         round(accel/g0, 0.01),
		Climb:     round(f.s.vel.dot(up), 0.01),
		Ground:    round((f.s.vel.dot(east)/r-planetSpin)*planetRadius, 0.01),
	}
}

// checkImpact ends the flight when the vehicle hits the ground.
func (f *flyer) checkImpact() {
	r := f.s.pos.length()
	if !f.lifted || r >= planetRadius || f.s.vel.dot(f.s.pos) >= 0 {
		return
	}
	f.emit(EventImpact, "")
	switch {
	case f.stalled:
		f.end = endStall
	case f.lost:
		f.end = endSpin
	default:
		f.end = endCrash
	}
}

// groupByKey finds a propulsion group.
func (f *flyer) groupByKey(key string) *group {
	for _, g := range f.groups {
		if g.key == key {
			return g
		}
	}
	return nil
}

// checkFailures fires the hardware failures whose time has come.
func (f *flyer) checkFailures() {
	for i := 0; i < len(f.failures); i++ {
		fl := f.failures[i]
		if fl.t > f.t {
			continue
		}
		f.failures = append(f.failures[:i], f.failures[i+1:]...)
		i--
		g := f.groupByKey(fl.key)
		if g != nil && (!f.attached[g.key] || !f.hasFuel(g)) {
			continue
		}
		id := ""
		if g != nil {
			id = g.id
		}
		switch fl.kind {
		case "payload_pop":
			f.emit(EventPayloadPop, "")
			f.end = endPayload
		case "explode":
			f.emit(EventExplode, id)
			f.end = endExplode
		case "engine_out":
			f.alive[g.key]--
			f.engineOuts++
			f.emit(EventEngineOut, id)
		case "booster_fail":
			f.failed[g.key] = true
			delete(f.attached, g.key)
			f.emit(EventBoosterFail, id)
		case "stall":
			f.alive[g.key] = 0
			f.failed[g.key] = true
			f.stalled = true
			f.phase = phasePassive
			f.emit(EventStall, id)
		}
		if f.end != "" {
			return
		}
	}
}

// checkStructure loses control when the air turns the vehicle sideways
// faster than it can steer back, and breaks it up when the air load
// exceeds what the structure takes.
func (f *flyer) checkStructure(aero aeroState, powered, saturated bool) {
	if !f.lifted {
		return
	}
	if powered && !f.lost && aero.q > 2_000 && math.Abs(aero.alpha) > lostControlAoA+f.disturbance {
		f.lost = true
		f.phase = phasePassive
		f.emit(EventSpin, "")
	}
	bending := aero.q*math.Abs(aero.alpha)*180/math.Pi > f.qAlpha
	if !bending && aero.q <= hardQLimit {
		return
	}
	f.emit(EventExplode, "")
	falling := f.s.vel.dot(f.s.pos) < 0
	switch {
	case f.stalled:
		f.end = endStall
	case !powered && falling && f.maxAltitude >= atmosphereTop:
		f.end = endSuborbital
	case !powered && falling:
		f.end = endCrash
	case bending && (f.lost || saturated):
		f.end = endSpin
	default:
		f.end = endBreakup
	}
}

// separate drops the fairing, spent boosters and spent stages, and lights
// the next stage.
func (f *flyer) separate() {
	if f.v.hasFairing && f.attached[fairingOwner] && f.s.pos.length()-planetRadius > fairingAltitude {
		delete(f.attached, fairingOwner)
		f.emit(EventFairingSep, "")
	}
	boosters := f.boostersAttached()
	if len(boosters) > 0 {
		empty := true
		for _, b := range boosters {
			if f.hasFuel(b) {
				empty = false
			}
		}
		if empty {
			for _, b := range boosters {
				delete(f.attached, b.key)
			}
			f.emit(EventBoosterSep, "")
			boosters = nil
		}
	}
	cur := f.stage()
	if !f.lifted || cur == nil || !f.attached[cur.key] || f.hasFuel(cur) ||
		f.lost || f.failed[cur.key] {
		return
	}
	if len(boosters) > 0 && f.stageIndex+1 < len(f.v.stages) {
		for _, b := range boosters {
			delete(f.attached, b.key)
		}
		f.emit(EventBoosterSep, "")
	}
	if len(boosters) > 0 && f.stageIndex+1 >= len(f.v.stages) {
		return
	}
	if f.stageIndex+1 >= len(f.v.stages) {
		if f.phase != phasePassive {
			f.emit(EventBurnout, "")
		}
		f.phase = phasePassive
		return
	}
	next := f.v.stages[f.stageIndex+1]
	delete(f.attached, cur.key)
	f.emit(EventStageSep, cur.id)
	if f.stageIndex == 0 && f.r.Legs != nil {
		f.landed = f.rng.Float64() < 0.9
	}
	f.stageIndex++
	f.pauseUntil = f.t + stagingCoast
	if rk := f.riskOf(next.key, "separation"); rk != nil && f.rng.Float64() < rk.p {
		f.failed[next.key] = true
		f.alive[next.key] = 0
		f.stalled = true
		f.phase = phasePassive
		f.emitAt(f.t+stagingCoast, EventStall, next.id)
		return
	}
	f.ignite(next)
}

// checkGoals ends the flight once its destination is reached or nothing more
// can happen: orbit, escape, or a fall back from space.
func (f *flyer) checkGoals() {
	o := orbitOf(f.s)
	falling := f.s.vel.dot(f.s.pos) < 0
	if !f.orbited && o.bound && o.perigee >= atmosphereTop {
		f.orbited = true
		f.emit(EventOrbit, "")
	}
	if f.orbited || f.phase == phaseDepart || f.phase == phasePassive {
		if f.goal == "moon" && o.apogeeRadius >= moonDistance {
			f.end = endGoal
			return
		}
		if need, ok := excessSpeedNeeded[f.goal]; ok && o.excess >= need {
			f.end = endGoal
			return
		}
	}
	if f.goal == "nowhere" && f.maxAltitude >= atmosphereTop && falling {
		f.end = endGoal
		return
	}
	if f.phase != phasePassive || len(f.burning()) > 0 {
		return
	}
	switch {
	case !o.bound:
		f.end = endEscape
	case o.perigee >= atmosphereTop:
		f.end = endOrbit
	case f.lost || f.stalled:
	case o.apogee >= atmosphereTop && f.goal != "nowhere":
		f.maxAltitude = math.Max(f.maxAltitude, o.apogee)
		f.end = endSuborbital
	case f.maxAltitude >= atmosphereTop && falling:
		f.end = endSuborbital
	}
}

// result summarises the finished flight.
func (f *flyer) result() flight {
	end := f.end
	if end == "" {
		switch {
		case f.stalled:
			end = endStall
		case f.maxAltitude >= atmosphereTop:
			end = endSuborbital
		default:
			end = endCrash
		}
	}
	if len(f.samples) == 0 || f.samples[len(f.samples)-1].T < round(f.t, 0.01) {
		f.samples = append(f.samples, f.sample(0, 0))
	}
	final := orbitOf(f.s)
	fuelLeft := 0.0
	for _, g := range f.v.stages {
		if f.attached[g.key] {
			fuelLeft += math.Max(0, f.fuel[g.key]-g.reserve)
		}
	}
	var used []usage
	for _, g := range f.groups {
		usable := math.Max(1, g.fuel-g.reserve)
		used = append(used, usage{
			key: g.key, ignited: f.ignited[g.key],
			burned: clamp(1-(f.fuel[g.key]-g.reserve)/usable, 0, 1), failed: f.failed[g.key],
		})
	}
	if f.events == nil {
		f.events = []Event{}
	}
	sortEvents(f.events)
	return flight{
		end: end, events: f.events, samples: f.samples, duration: f.t,
		maxAltitude: f.maxAltitude, maxQ: f.maxQ, maxG: f.maxG,
		apogee: final.apogee, perigee: final.perigee, bound: final.bound,
		excessSpeed: final.excess, deltaVUsed: f.deltaVUsed, usage: used,
		landed: f.landed, engineOuts: f.engineOuts,
		fuelLeft: fuelLeft,
		energy:   f.s.vel.dot(f.s.vel)/2 - planetMu/f.s.pos.length(),
		orbited:  f.orbited,
	}
}

// hasControl reports whether the attached stack has a gimballed engine.
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
