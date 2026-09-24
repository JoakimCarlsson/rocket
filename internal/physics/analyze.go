package physics

import (
	"fmt"
	"math"
	"strings"
)

// Stats are the numbers the build panel shows.
type Stats struct {
	Height       float64 `json:"height"       desc:"Stack height in metres."`
	Mass         float64 `json:"mass"         desc:"Liftoff mass in tonnes."`
	Thrust       float64 `json:"thrust"       desc:"Sea-level liftoff thrust in kN."`
	TWR          float64 `json:"twr"          desc:"Liftoff thrust-to-weight ratio."`
	DeltaV       float64 `json:"deltaV"       desc:"Rocket-equation delta-v of every burn, in m/s."`
	DeltaVNeeded float64 `json:"deltaVNeeded" desc:"Delta-v the destination needs from the pad, losses included."`
	Stability    float64 `json:"stability"    desc:"Static margin at liftoff in calibers; negative needs active steering."`
	Crew         float64 `json:"crew"         desc:"Crew on board."`
	Cost         float64 `json:"cost"         desc:"Made-up cost in $M."`
	Reliability  float64 `json:"reliability"  desc:"Chance in percent that no hardware failure ends the mission."`
	Chaos        float64 `json:"chaos"        desc:"Joke meter, 0 to 100."`
}

// Burn is one phase of the rocket-equation staging breakdown.
type Burn struct {
	Label      string  `json:"label"      desc:"Which stages burn, e.g. S1 + BOOSTERS."`
	DeltaV     float64 `json:"deltaV"     desc:"Delta-v of the burn in m/s."`
	TWR        float64 `json:"twr"        desc:"Thrust-to-weight when the burn starts."`
	BurnTime   float64 `json:"burnTime"   desc:"Seconds at full throttle."`
	Propellant string  `json:"propellant" desc:"Propellants burning."`
}

// Problem is a physical reason a design cannot do its mission.
type Problem struct {
	Key  string `json:"key"  desc:"twr, deltaV, stability or crew."`
	Text string `json:"text" desc:"The problem in words the AI engineer can act on."`
}

// Analysis is everything the build panel needs about a rocket.
type Analysis struct {
	Stats    Stats     `json:"stats"`
	Staging  []Burn    `json:"staging"`
	Problems []Problem `json:"problems"`
}

// risk is one way hardware can let the mission down in a flight.
type risk struct {
	key       string
	kind      string
	p         float64
	lossShare float64
}

// Analyze derives the stats, staging and design problems of a rocket.
func Analyze(r *Rocket) Analysis {
	v := buildVehicle(r)
	stats := computeStats(r, v)
	return Analysis{Stats: stats, Staging: burns(v), Problems: problems(r, stats)}
}

// computeStats derives the build-panel numbers.
func computeStats(r *Rocket, v *vehicle) Stats {
	attached := v.owners()
	tanks := v.fullTanks()
	mass, cm, _ := v.massProperties(attached, tanks)
	thrust := 0.0
	for _, g := range append([]*group{v.stages[0]}, v.boosters...) {
		thrust += g.engine.thrust(seaLevelP) * float64(g.engines)
	}
	twr := thrust / (mass * g0)
	deltaV := 0.0
	for _, b := range burns(v) {
		deltaV += b.DeltaV
	}
	_, cp := v.centerOfPressure(attached)
	reliability := math.Round(clamp(hardwareReliability(risks(r, v)), 1, 99))

	parts := float64(len(r.Stages) + len(r.Boosters) + len(r.Decor))
	if r.Fins != nil {
		parts++
	}
	if r.Legs != nil {
		parts++
	}
	engines, peak, decor, silly := 0.0, 0.0, 0.0, 0.0
	for _, g := range v.groups() {
		engines += float64(g.engines)
		peak = math.Max(peak, g.power)
	}
	for _, d := range r.Decor {
		decor += d.Count
		if sillyDecor[d.Kind] {
			silly++
		}
	}
	finish := map[string]float64{
		"matte": 1, "satin": 1.1, "metallic": 1.25, "chrome": 1.8, "glossy": 1.15,
	}[r.Appearance.Finish]
	cost := (parts*14 + mass*0.00002 + engines*6 + r.Payload.Crew*9) * finish
	if r.Legs != nil {
		cost *= 0.8
	}

	chaos := 4 + float64(len(r.Boosters))*2.6 + decor*3.5 + silly*10 +
		math.Max(0, peak-5)*5 + math.Abs(r.Tilt)/1.8 + (100-reliability)*0.35 +
		math.Max(0, r.totalHeight()/r.totalWidth()-14)*1.5
	if r.Appearance.Pattern == "checker" {
		chaos += 6
	}

	return Stats{
		Height:       math.Round(v.height*10) / 10,
		Mass:         math.Round(mass/100) / 10,
		Thrust:       math.Round(thrust / 1000),
		TWR:          math.Round(twr*100) / 100,
		DeltaV:       math.Round(deltaV),
		DeltaVNeeded: deltaVNeeded[r.Destination],
		Stability:    math.Round((cm-cp)/v.refDiameter*10) / 10,
		Crew:         r.Payload.Crew,
		Cost:         math.Round(cost),
		Reliability:  reliability,
		Chaos:        math.Round(clamp(chaos, 0, 100)),
	}
}

// burns is the analytic staging breakdown. First-stage burns use a blended
// ambient pressure to stand in for the climb out of the atmosphere.
func burns(v *vehicle) []Burn {
	var out []Burn
	attached := v.owners()
	fuel := v.fullTanks()
	for _, s := range v.stages {
		fuel[s.key] = s.fuel - s.reserve
	}
	for i, stage := range v.stages {
		first := true
		for {
			var burning []*group
			for _, g := range append([]*group{stage}, v.boosters...) {
				if attached[g.key] && fuel[g.key] > 0 {
					burning = append(burning, g)
				}
			}
			if len(burning) == 0 || fuel[stage.key] <= 0 && i+1 < len(v.stages) {
				break
			}
			pressure := 0.0
			if i == 0 {
				pressure = seaLevelP * 0.35
			}
			var thrust, flow, ignition float64
			burnTime := math.Inf(1)
			labels := map[string]bool{}
			var names []string
			for _, g := range burning {
				n := float64(g.engines)
				thrust += g.engine.thrust(pressure) * n
				flow += g.engine.flow * n
				ignitionPressure := 0.0
				if i == 0 && first {
					ignitionPressure = seaLevelP
				}
				ignition += g.engine.thrust(ignitionPressure) * n
				burnTime = math.Min(burnTime, fuel[g.key]/(g.engine.flow*n))
				label := propellantSpecs[g.propellant].Label
				if !labels[label] {
					labels[label] = true
					names = append(names, label)
				}
			}
			m0, _, _ := v.massProperties(attached, fuel)
			m1 := m0 - flow*burnTime
			label := stage.label
			for _, g := range burning {
				if g.booster {
					label = stage.label + " + BOOSTERS"
					break
				}
			}
			out = append(out, Burn{
				Label:      label,
				DeltaV:     thrust / flow * math.Log(m0/math.Max(1, m1)),
				TWR:        ignition / (m0 * g0),
				BurnTime:   burnTime,
				Propellant: strings.Join(names, "+"),
			})
			first = false
			for _, g := range burning {
				left := fuel[g.key] - g.engine.flow*float64(g.engines)*burnTime
				if left < 1e-3 {
					left = 0
				}
				fuel[g.key] = left
			}
			empty := true
			for _, b := range v.boosters {
				if fuel[b.key] > 0 {
					empty = false
				}
			}
			if empty {
				for _, b := range v.boosters {
					delete(attached, b.key)
				}
			}
		}
		for _, b := range v.boosters {
			delete(attached, b.key)
		}
		delete(attached, stage.key)
	}
	return out
}

// risks lists the hardware failure modes of one flight. lossShare is how
// often the failure ends the mission rather than just degrading it.
func risks(r *Rocket, v *vehicle) []risk {
	var out []risk
	for _, g := range v.groups() {
		stress := 1 + math.Pow(math.Max(0, g.power-6), 2)*0.35
		perEngine := 0.002 * stress * nozzleSpecs[g.style].risk * propellantSpecs[g.propellant].Risk
		share := 1.0
		switch {
		case g.booster:
			share = 0.5
		case g.engines >= 2:
			share = 0.3
		}
		out = append(out, risk{
			g.key, "engine", 1 - math.Pow(1-perEngine, float64(g.engines)), share,
		})
	}
	for _, s := range v.stages[1:] {
		out = append(out, risk{s.key, "separation", 0.004, 1})
	}
	silly, decor := 0.0, 0.0
	for _, d := range r.Decor {
		decor += d.Count
		if sillyDecor[d.Kind] {
			silly++
		}
	}
	payload := 0.003 + silly*0.008
	if r.Payload.Top == "none" {
		payload += 0.01
	}
	out = append(out, risk{upperOwner, "payload", payload, 1})
	if decor > 0 {
		out = append(out, risk{"decor", "structure", decor * 0.0015, 1})
	}
	return out
}

// hardwareReliability is the percent chance that no failure ends the mission.
func hardwareReliability(rs []risk) float64 {
	p := 1.0
	for _, r := range rs {
		p *= 1 - r.p*r.lossShare
	}
	return 100 * p
}

// problems names the physical reasons a design cannot do its mission.
func problems(r *Rocket, s Stats) []Problem {
	out := []Problem{}
	if s.TWR < 1.15 {
		out = append(out, Problem{"twr", fmt.Sprintf(
			"liftoff thrust-to-weight %.2f (needs 1.2 to 1.6 to climb)", s.TWR)})
	}
	if s.DeltaV < s.DeltaVNeeded {
		out = append(out, Problem{"deltaV", fmt.Sprintf(
			"delta-v %.0f m/s of %.0f m/s needed for %s", s.DeltaV, s.DeltaVNeeded, r.Destination)})
	}
	if s.Stability < 0 && !r.Stages[0].Engine.gimballed() {
		out = append(out, Problem{"stability", fmt.Sprintf(
			"aerodynamically unstable (static margin %.1f calibers) with no gimballed first-stage engines", s.Stability)})
	}
	if r.Payload.Crew > 0 && (!r.Payload.HeatShield || !r.Payload.Parachutes) {
		out = append(out, Problem{"crew", "crew has no heat shield and parachutes to come home"})
	}
	return out
}
