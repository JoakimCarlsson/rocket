package physics

import (
	"math"
	"strconv"
)

// Segment keys shared with the web app's renderer, which separates parts
// by these names.
const (
	upperOwner   = "upper"
	fairingOwner = "fairing"
)

// propellant is how one propellant combination behaves.
type propellant struct {
	Label        string
	Density      float64
	IspSea       float64
	IspVac       float64
	TankDensity  float64
	ThrustFactor float64
	EngineTWR    float64
	Throttleable bool
	Risk         float64
}

// propellantSpecs are game figures in the spirit of Kerbal Space Program:
// real propellant densities, but heavier tanks and engines and lower
// specific impulse than the real thing, so a stage carries 2 to 3 km/s.
var propellantSpecs = map[string]propellant{
	"solid":    {"SOLID", 1750, 175, 205, 460, 1.7, 90, false, 0.6},
	"kerolox":  {"KEROLOX", 1030, 265, 310, 240, 1, 60, true, 0.9},
	"methalox": {"METHALOX", 830, 285, 335, 205, 1, 55, true, 1},
	"hydrolox": {"HYDROLOX", 360, 290, 390, 110, 0.75, 45, true, 1.2},
}

// nozzle is how a nozzle shape trades sea-level against vacuum performance.
type nozzle struct{ sea, vac, thrust, risk float64 }

// nozzleSpecs: flared is a vacuum nozzle, aerospike compensates for altitude.
var nozzleSpecs = map[string]nozzle{
	"bell":      {1, 1, 1, 1},
	"aerospike": {1.07, 0.97, 0.95, 1.25},
	"flared":    {0.78, 1.08, 1, 1},
	"trumpet":   {0.96, 0.95, 1.12, 1.4},
}

// Destination targets on the Kerbin-sized planet: delta-v from the pad with
// typical losses, and the speed left over after escaping for Mars (a Duna
// transfer) and for falling into the Sun.
var (
	deltaVNeeded = map[string]float64{
		"nowhere": 1600, "orbit": 3400, "moon": 4300, "mars": 4500, "sun": 9300,
	}
	excessSpeedNeeded = map[string]float64{"mars": 920, "sun": 7480}
)

// moonDistance is the apoapsis radius that counts as reaching the Moon, the
// radius of the Mun's orbit.
const moonDistance = 12_000_000.0

var (
	dragCoefficient = map[string]float64{
		"needle": 0.22, "ogive": 0.27, "cone": 0.32, "spike": 0.3,
		"dome": 0.45, "blunt": 0.5, "none": 0.85,
	}
	noseCenterOfPressure = map[string]float64{
		"needle": 0.47, "ogive": 0.47, "cone": 0.67, "spike": 0.6,
		"dome": 0.4, "blunt": 0.4, "none": 0,
	}
	payloadDensity = map[string]float64{
		"capsule": 260, "fairing": 110, "satellite": 160,
		"cargo": 320, "habitat": 130, "none": 0,
	}
	finTipRatio = map[string]float64{
		"delta": 0, "swept": 0.35, "grid": 1, "tiny": 0.5, "shark": 0.25,
	}
	decorMass = map[string]float64{
		"antenna": 30, "ring": 400, "solarPanels": 250, "spikes": 150,
		"lights": 20, "wings": 1500, "flag": 10, "googlyEyes": 5, "duck": 2,
		"windows": 60, "tank": 900, "propeller": 300,
	}
	decorDrag = map[string]float64{
		"antenna": 0.05, "ring": 0.3, "solarPanels": 2, "spikes": 1.2,
		"lights": 0.05, "wings": 1.5, "flag": 0.3, "googlyEyes": 0.4,
		"duck": 0.3, "windows": 0, "tank": 0.4, "propeller": 1.5,
	}
	boosterDrag = map[string]float64{"cone": 0.35, "ogive": 0.3, "blunt": 0.6}
	sillyDecor  = map[string]bool{
		"googlyEyes": true, "duck": true, "propeller": true, "spikes": true,
	}
)

// engineModel is one engine. Thrust falls with ambient pressure acting on the
// nozzle exit, which is what makes Isp lower at sea level.
type engineModel struct {
	thrustVac float64
	ispVac    float64
	ispSea    float64
	flow      float64
	exitArea  float64
	mass      float64
}

// thrust is one engine's thrust at an ambient pressure, in newtons.
func (e engineModel) thrust(pressure float64) float64 {
	return math.Max(0, e.thrustVac-pressure*e.exitArea)
}

// newEngine sizes one engine of a cluster.
func newEngine(e Engine, prop string) engineModel {
	p := propellantSpecs[prop]
	n := nozzleSpecs[e.Style]
	chamber := 1 + (e.Power-5)*0.006
	thrustVac := 3.2e6 * e.Size * e.Size * (e.Power / 5) * p.ThrustFactor * n.thrust
	ispVac := p.IspVac * n.vac * chamber
	ispSea := p.IspSea * n.sea * chamber
	mass := thrustVac / (g0 * p.EngineTWR)
	if e.gimballed() {
		mass *= 1.04
	}
	return engineModel{
		thrustVac: thrustVac,
		ispVac:    ispVac,
		ispSea:    ispSea,
		flow:      thrustVac / (ispVac * g0),
		exitArea:  thrustVac * (1 - ispSea/ispVac) / seaLevelP,
		mass:      mass,
	}
}

// group is a stage or booster: a tank with engines under it.
type group struct {
	key          string
	id           string
	booster      bool
	index        int
	label        string
	propellant   string
	fuel         float64
	reserve      float64
	engines      int
	engine       engineModel
	gimbal       bool
	throttleable bool
	y            float64
	length       float64
	engineY      float64
	power        float64
	style        string
}

// massItem is a fixed mass on a segment, with the length it spans for
// moment-of-inertia purposes.
type massItem struct {
	owner  string
	mass   float64
	y      float64
	length float64
}

// liftItem is one normal-force contribution (Barrowman).
type liftItem struct {
	owner string
	cna   float64
	y     float64
}

// dragItem is one drag area in m².
type dragItem struct {
	owner string
	cda   float64
}

// vehicle is everything the flight model knows about a rocket.
type vehicle struct {
	stages          []*group
	boosters        []*group
	items           []massItem
	lift            []liftItem
	drag            []dragItem
	refDiameter     float64
	refArea         float64
	height          float64
	slenderness     float64
	payloadMass     float64
	crew            int
	hasFairing      bool
	propellerThrust float64
}

// frustumVolume is the volume of a truncated cone.
func frustumVolume(h, r1, r2 float64) float64 {
	return math.Pi * h * (r1*r1 + r1*r2 + r2*r2) / 3
}

// frustumArea is the slanted side area of a truncated cone.
func frustumArea(h, r1, r2 float64) float64 {
	return math.Pi * (r1 + r2) * math.Hypot(h, r1-r2)
}

// finLift is the Barrowman normal-force slope of a fin set, relative to the
// reference diameter, including body interference.
func finLift(count, span, root, tip, bodyRadius, refDiameter float64) float64 {
	if span <= 0 || root <= 0 {
		return 0
	}
	effective := count
	if count > 4 {
		effective = 4 + (count-4)*0.6
	}
	mid := math.Hypot(span, (root-tip)/2)
	interference := 1 + bodyRadius/(span+bodyRadius)
	relSpan := span / refDiameter
	chordRatio := 2 * mid / (root + tip)
	return interference * 4 * effective * relSpan * relSpan /
		(1 + math.Sqrt(1+chordRatio*chordRatio))
}

// noseLift is the normal-force slope of a nose of a given base radius,
// relative to the reference diameter.
func noseLift(radius, refDiameter float64) float64 {
	d := 2 * radius / refDiameter
	return 2 * d * d
}

// decorOwner is the segment a decoration rides on.
func (r *Rocket) decorOwner(attach string) string {
	if attach == "top" || attach == "payload" {
		return upperOwner
	}
	i := r.stageIndexAt(r.decorAnchor(attach))
	if i < 0 {
		return upperOwner
	}
	return "stage:" + r.Stages[i].ID
}

// buildVehicle derives the physical model of a rocket.
func buildVehicle(r *Rocket) *vehicle {
	v := &vehicle{}
	secs := r.sections()
	maxRadius := 1.0
	for _, s := range r.Stages {
		maxRadius = math.Max(maxRadius, s.Radius)
	}
	v.refDiameter = 2 * maxRadius
	v.refArea = math.Pi * maxRadius * maxRadius
	transition := func(owner string, fore, aft, y float64) {
		a, f := 2*aft/v.refDiameter, 2*fore/v.refDiameter
		cna := 2*a*a - 2*f*f
		if math.Abs(cna) > 1e-4 {
			v.lift = append(v.lift, liftItem{owner, cna, y})
		}
	}

	for i, sec := range secs {
		s := sec.stage
		key := "stage:" + s.ID
		p := propellantSpecs[s.Propellant]
		volume := frustumVolume(s.Height, sec.rBottom, sec.rTop)
		eng := newEngine(s.Engine, s.Propellant)
		count := int(s.Engine.Count)
		v.items = append(v.items, massItem{
			key, volume*p.TankDensity + eng.mass*float64(count),
			sec.base + s.Height*0.4, s.Height,
		})
		transition(key, sec.rTop, sec.rBottom, sec.base+s.Height/2)
		if i+1 < len(secs) {
			next := secs[i+1]
			h := next.base - sec.top
			v.items = append(v.items, massItem{
				key, frustumArea(h, sec.rTop, next.rBottom) * 45, sec.top + h/2, h,
			})
			transition(key, next.rBottom, sec.rTop, sec.top+h/2)
		}
		v.stages = append(v.stages, &group{
			key: key, id: s.ID, index: i, label: "S" + strconv.Itoa(i+1),
			propellant: s.Propellant, fuel: volume * 0.9 * p.Density,
			engines: count, engine: eng, gimbal: s.Engine.gimballed(),
			throttleable: p.Throttleable, y: sec.base + s.Height/2,
			length: s.Height, engineY: sec.base - s.Engine.Size*1.7,
			power: s.Engine.Power, style: s.Engine.Style,
		})
	}

	for i, b := range r.Boosters {
		key := "booster:" + b.ID
		p := propellantSpecs[b.Propellant]
		volume := math.Pi * b.Radius * b.Radius * b.Height
		eng := newEngine(b.Engine, b.Propellant)
		count := int(b.Engine.Count)
		nose := b.Radius * 2.6
		if b.Top == "blunt" {
			nose = b.Radius
		}
		v.items = append(v.items, massItem{
			key, volume*p.TankDensity + eng.mass*float64(count) + 350,
			b.Height * 0.45, b.Height,
		})
		v.lift = append(v.lift, liftItem{
			key, noseLift(b.Radius, v.refDiameter), b.Height + nose*0.5,
		})
		v.drag = append(v.drag, dragItem{
			key, boosterDrag[b.Top] * math.Pi * b.Radius * b.Radius,
		})
		v.boosters = append(v.boosters, &group{
			key: key, id: b.ID, booster: true, index: i, label: "B" + strconv.Itoa(i+1),
			propellant: b.Propellant, fuel: volume * 0.9 * p.Density,
			engines: count, engine: eng, gimbal: b.Engine.gimballed(),
			throttleable: p.Throttleable, y: b.Height / 2, length: b.Height,
			engineY: -b.Engine.Size * 1.7, power: b.Engine.Power,
			style: b.Engine.Style,
		})
	}

	pl := r.Payload
	baseY := secs[len(secs)-1].top
	pHeight := r.payloadHeight()
	rBase := r.upperRadius()
	rTop := r.payloadTopRadius()
	v.hasFairing = pl.Kind == "fairing"
	shell := upperOwner
	if v.hasFairing {
		shell = fairingOwner
	}
	v.payloadMass = frustumVolume(pHeight, rBase, rTop)*payloadDensity[pl.Kind] + pl.Crew*150
	v.crew = int(pl.Crew)
	v.items = append(v.items, massItem{upperOwner, v.payloadMass, baseY + pHeight/2, pHeight})
	if v.hasFairing {
		v.items = append(v.items, massItem{
			fairingOwner, frustumArea(pHeight, rBase, rTop) * 12, baseY + pHeight/2, pHeight,
		})
	}
	if pl.HeatShield {
		v.items = append(v.items, massItem{upperOwner, v.payloadMass * 0.1, baseY, 0.5})
	}
	if pl.Parachutes {
		v.items = append(v.items, massItem{upperOwner, v.payloadMass * 0.04, baseY + pHeight, 0.5})
	}
	transition(shell, rTop, rBase, baseY+pHeight/2)

	noseLength := topHeight(pl.Top, rBase)
	noseBase := baseY + pHeight
	if pl.Top != "none" {
		density := 18.0
		if pl.Top == "dome" {
			density = 54
		} else if v.hasFairing {
			density = 12
		}
		v.items = append(v.items, massItem{
			shell, frustumArea(noseLength, rTop, 0) * density,
			noseBase + noseLength/3, noseLength,
		})
	}
	v.lift = append(v.lift, liftItem{
		shell, noseLift(rTop, v.refDiameter),
		noseBase + noseLength*(1-noseCenterOfPressure[pl.Top]),
	})
	cd := dragCoefficient[pl.Top]
	if pl.Kind == "capsule" {
		cd += 0.04
	}
	v.drag = append(v.drag, dragItem{upperOwner, cd * v.refArea})

	if r.Fins != nil {
		f := r.Fins
		span, root := r.finGeometry()
		tip := root * finTipRatio[f.Shape]
		key := v.stages[0].key
		scale := 1.0
		switch f.Shape {
		case "grid":
			scale = 1.2
		case "tiny":
			scale = 0.5
		}
		v.lift = append(v.lift, liftItem{
			key, finLift(f.Count, span, root, tip, secs[0].rBottom, v.refDiameter) * scale, root * 0.5,
		})
		areal, drag := 35.0, 0.05
		if f.Shape == "grid" {
			areal, drag = 70, 0.2
		}
		v.items = append(v.items, massItem{key, f.Count * span * (root + tip) / 2 * areal, root * 0.5, root})
		v.drag = append(v.drag, dragItem{key, f.Count * span * drag})
	}

	if r.Legs != nil {
		key := v.stages[0].key
		v.items = append(v.items, massItem{key, r.Legs.Count * 600 * r.Legs.Size * r.Legs.Size, 1, 3})
		v.drag = append(v.drag, dragItem{key, r.Legs.Count * 0.3 * r.Legs.Size})
		v.stages[0].reserve = v.stages[0].fuel * 0.08
	}

	for _, d := range r.Decor {
		owner := r.decorOwner(d.Attach)
		y := r.decorAnchor(d.Attach)
		scale := d.Size * d.Size * d.Size * d.Count
		v.items = append(v.items, massItem{owner, decorMass[d.Kind] * scale, y, d.Size})
		v.drag = append(v.drag, dragItem{owner, decorDrag[d.Kind] * d.Size * d.Size * d.Count})
		switch d.Kind {
		case "tank":
			target := v.stages[len(v.stages)-1]
			for _, s := range v.stages {
				if s.key == owner {
					target = s
				}
			}
			tankRadius := 0.7 * d.Size
			volume := math.Pi * tankRadius * tankRadius * 6 * d.Size
			target.fuel += volume * d.Count * 0.9 * propellantSpecs[target.propellant].Density
		case "wings":
			v.lift = append(v.lift, liftItem{
				owner, finLift(2, 6*d.Size, 7*d.Size, 2*d.Size, math.Max(1, secs[0].rBottom), v.refDiameter),
				y + 0.5*d.Size,
			})
		case "propeller":
			v.propellerThrust += 4000 * scale
		}
	}

	v.height = r.totalHeight()
	v.slenderness = v.height / v.refDiameter
	return v
}

// groups lists every propulsion group, stages first.
func (v *vehicle) groups() []*group {
	return append(append([]*group{}, v.stages...), v.boosters...)
}

// owners is every segment key of the unstaged vehicle.
func (v *vehicle) owners() map[string]bool {
	out := map[string]bool{}
	for _, i := range v.items {
		out[i.owner] = true
	}
	for _, g := range v.groups() {
		out[g.key] = true
	}
	return out
}

// fullTanks is the loaded propellant of every group.
func (v *vehicle) fullTanks() map[string]float64 {
	out := map[string]float64{}
	for _, g := range v.groups() {
		out[g.key] = g.fuel
	}
	return out
}

// massProperties is the attached mass, the height of its centre of mass and
// its pitch moment of inertia about that centre.
func (v *vehicle) massProperties(attached map[string]bool, fuel map[string]float64) (mass, cm, inertia float64) {
	var moment float64
	for _, i := range v.items {
		if attached[i.owner] {
			mass += i.mass
			moment += i.mass * i.y
		}
	}
	for _, g := range v.groups() {
		if attached[g.key] {
			mass += fuel[g.key]
			moment += fuel[g.key] * g.y
		}
	}
	mass = math.Max(1, mass)
	cm = moment / mass
	for _, i := range v.items {
		if attached[i.owner] {
			arm := i.y - cm
			inertia += i.mass * (arm*arm + i.length*i.length/12)
		}
	}
	for _, g := range v.groups() {
		if attached[g.key] {
			m := fuel[g.key]
			arm := g.y - cm
			inertia += m * (arm*arm + g.length*g.length/12)
		}
	}
	return mass, cm, math.Max(1, inertia)
}

// centerOfPressure is the total normal-force slope and where it acts.
func (v *vehicle) centerOfPressure(attached map[string]bool) (cna, y float64) {
	var moment float64
	for _, l := range v.lift {
		if attached[l.owner] {
			cna += l.cna
			moment += l.cna * l.y
		}
	}
	if cna < 0.1 {
		return 0.1, 0
	}
	return cna, moment / cna
}

// dampingSum is Σ CNα·l² about a centre of mass, which sets aerodynamic
// pitch damping.
func (v *vehicle) dampingSum(attached map[string]bool, cm float64) float64 {
	sum := 0.0
	for _, l := range v.lift {
		if attached[l.owner] {
			arm := l.y - cm
			sum += math.Abs(l.cna) * arm * arm
		}
	}
	return sum
}

// dragArea is the attached zero-lift drag area.
func (v *vehicle) dragArea(attached map[string]bool) float64 {
	sum := 0.0
	for _, d := range v.drag {
		if attached[d.owner] {
			sum += d.cda
		}
	}
	return sum
}
