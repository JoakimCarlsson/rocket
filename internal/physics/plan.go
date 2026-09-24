package physics

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
	"math"
	"math/rand/v2"
	"strings"
)

// Outcome is how a launch ended, in game terms.
type Outcome string

// Every outcome a launch can have.
const (
	OutcomeOrbit            Outcome = "orbit"
	OutcomeLunar            Outcome = "lunar"
	OutcomeMars             Outcome = "mars"
	OutcomeSolar            Outcome = "solar"
	OutcomeHop              Outcome = "hop"
	OutcomeParked           Outcome = "parked"
	OutcomeEscape           Outcome = "escape"
	OutcomeSuborbital       Outcome = "suborbital"
	OutcomeBoosterFailure   Outcome = "booster_failure"
	OutcomeAgainstAllOdds   Outcome = "against_all_odds"
	OutcomePayloadEarly     Outcome = "payload_early"
	OutcomeStageMalfunction Outcome = "stage_malfunction"
	OutcomeSpin             Outcome = "spin"
	OutcomeBreakup          Outcome = "breakup"
	OutcomeCrash            Outcome = "crash"
	OutcomeExplode          Outcome = "explode"
	OutcomeFizzle           Outcome = "fizzle"
)

// ReportRow is one labelled line of the mission report.
type ReportRow struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

// Report is the mission report card.
type Report struct {
	Headline string      `json:"headline"`
	Grade    string      `json:"grade" desc:"success, partial or failure."`
	Rows     []ReportRow `json:"rows"`
	Quip     string      `json:"quip"`
	Chaos    float64     `json:"chaos"`
}

// StagingRow is what one stage or the booster set did.
type StagingRow struct {
	Label      string  `json:"label"`
	Propellant string  `json:"propellant"`
	DeltaV     float64 `json:"deltaV"`
	Burned     float64 `json:"burned" desc:"Share of usable propellant burned, 0 to 1."`
	Status     string  `json:"status" desc:"nominal, engine out, failed, unused or spare fuel."`
}

// Mission is the launch summary the AI engineer repairs from.
type Mission struct {
	Outcome  Outcome  `json:"outcome"`
	Headline string   `json:"headline"`
	Problems []string `json:"problems"`
}

// Plan is a launch: everything the web app needs to play it back and report it.
type Plan struct {
	Seed       uint64       `json:"seed"`
	Outcome    Outcome      `json:"outcome"`
	Duration   float64      `json:"duration"    desc:"Flight seconds the playback covers."`
	AltitudeKm float64      `json:"altitudeKm"`
	Report     Report       `json:"report"`
	Stats      Stats        `json:"stats"`
	Trajectory []Sample     `json:"trajectory"`
	Milestones []Event      `json:"milestones"`
	Staging    []StagingRow `json:"staging"`
	Mission    Mission      `json:"mission"`
}

// Launch flies a rocket. attempt picks the dice: the same rocket and attempt
// always fly the same way.
func Launch(r *Rocket, attempt int) Plan {
	seed := seedOf(r, attempt)
	rng := rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15))
	v := buildVehicle(r)
	stats := computeStats(r, v)
	f := fly(r, v, rng, stats.Chaos, flightPlan{kick: bestKick(r, v)})
	outcome := outcomeOf(r, f, stats)
	report := buildReport(r, stats, outcome, f, rng)
	return Plan{
		Seed:       seed,
		Outcome:    outcome,
		Duration:   f.duration,
		AltitudeKm: f.maxAltitude / 1000,
		Report:     report,
		Stats:      stats,
		Trajectory: f.samples,
		Milestones: f.events,
		Staging:    stagingRows(r, v, f),
		Mission:    mission(r, v, stats, outcome, report.Headline),
	}
}

// seedOf hashes the rocket and attempt into the launch's dice.
func seedOf(r *Rocket, attempt int) uint64 {
	data, _ := json.Marshal(r)
	h := fnv.New64a()
	_, _ = h.Write(data)
	_, _ = fmt.Fprintf(h, "#%d", attempt)
	return h.Sum64()
}

var goalOutcome = map[string]Outcome{
	"orbit": OutcomeOrbit, "moon": OutcomeLunar, "mars": OutcomeMars,
	"sun": OutcomeSolar, "nowhere": OutcomeHop,
}

// outcomeOf maps the physical end of a flight onto a game outcome.
func outcomeOf(r *Rocket, f flight, s Stats) Outcome {
	reached := func() Outcome {
		for _, e := range f.events {
			if e.Type == EventBoosterFail {
				return OutcomeBoosterFailure
			}
		}
		if s.Reliability < 45 {
			return OutcomeAgainstAllOdds
		}
		return goalOutcome[r.Destination]
	}
	switch f.end {
	case endPad:
		return OutcomeFizzle
	case endGoal:
		return reached()
	case endOrbit:
		if r.Destination == "orbit" {
			return reached()
		}
		return OutcomeParked
	case endEscape:
		return OutcomeEscape
	case endSuborbital:
		return OutcomeSuborbital
	case endPayload:
		return OutcomePayloadEarly
	case endStall:
		return OutcomeStageMalfunction
	case endSpin:
		return OutcomeSpin
	case endBreakup:
		return OutcomeBreakup
	case endExplode:
		return OutcomeExplode
	}
	return OutcomeCrash
}

var grades = map[Outcome][2]string{
	OutcomeOrbit:            {"ORBIT ACHIEVED", "success"},
	OutcomeLunar:            {"MOON REACHED", "success"},
	OutcomeMars:             {"WELCOME TO MARS", "success"},
	OutcomeSolar:            {"FALLING INTO THE SUN", "success"},
	OutcomeHop:              {"HOP COMPLETE", "success"},
	OutcomeAgainstAllOdds:   {"SOMEHOW SUCCESSFUL", "success"},
	OutcomeBoosterFailure:   {"MOSTLY SUCCESSFUL", "partial"},
	OutcomeParked:           {"PARKED IN ORBIT", "partial"},
	OutcomeEscape:           {"ESCAPED EARTH, MISSED TARGET", "partial"},
	OutcomeSuborbital:       {"SPACE, BRIEFLY", "partial"},
	OutcomePayloadEarly:     {"TECHNICALLY A DELIVERY", "partial"},
	OutcomeStageMalfunction: {"STAGE MALFUNCTION", "failure"},
	OutcomeSpin:             {"LOSS OF CONTROL", "failure"},
	OutcomeBreakup:          {"AERODYNAMIC DISASSEMBLY", "failure"},
	OutcomeCrash:            {"OUT OF PUFF", "failure"},
	OutcomeExplode:          {"RAPID UNSCHEDULED DISASSEMBLY", "failure"},
	OutcomeFizzle:           {"IT DID NOT LEAVE", "failure"},
}

// pick chooses one string with the launch's dice.
func pick(rng *rand.Rand, options []string) string {
	return options[rng.IntN(len(options))]
}

// formatKm formats an altitude given in kilometres.
func formatKm(km float64) string {
	switch {
	case km < 1:
		return fmt.Sprintf("%d m", int(math.Round(km*1000)))
	case km >= 1_000_000:
		return fmt.Sprintf("%.0f million km", km/1_000_000)
	}
	return withCommas(math.Round(km)) + " km"
}

// withCommas formats a whole number with thousands separators.
func withCommas(v float64) string {
	s := fmt.Sprintf("%.0f", math.Abs(v))
	var b strings.Builder
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(c)
	}
	if v < 0 {
		return "-" + b.String()
	}
	return b.String()
}

// whereabouts describes where the vehicle ended up.
func whereabouts(o Outcome, f flight) string {
	switch {
	case o == OutcomeLunar:
		return "Trans-lunar injection"
	case f.excessSpeed > 0:
		return fmt.Sprintf("Escape, v∞ %.1f km/s", f.excessSpeed/1000)
	case f.bound && f.perigee > 100_000:
		return formatKm(f.perigee/1000) + " × " + formatKm(f.apogee/1000)
	}
	return "Peak " + formatKm(f.maxAltitude/1000)
}

var cargoLines = map[Outcome][]string{
	OutcomeLunar:            {"On its way to the Moon", "Moon-bound, three days out"},
	OutcomeMars:             {"Mars-bound. Seven months.", "On a Mars transfer"},
	OutcomeSolar:            {"Falling into the Sun. On purpose.", "Extremely warm"},
	OutcomeHop:              {"Went up, came down", "Briefly in space"},
	OutcomeParked:           {"Delivered to the wrong orbit", "Waiting for a lift"},
	OutcomeEscape:           {"Orbiting the Sun instead", "Lost to deep space"},
	OutcomeSuborbital:       {"Saw space, came back", "Brief weightlessness achieved"},
	OutcomePayloadEarly:     {"Deployed early. Somewhere.", "Released at the wrong altitude"},
	OutcomeBoosterFailure:   {"Intact, rattled", "Mostly where it should be"},
	OutcomeStageMalfunction: {"In the ocean", "Returned to Earth prematurely"},
	OutcomeSpin:             {"Extremely well mixed", "Distributed over a wide area"},
	OutcomeBreakup:          {"Shredded by the air", "Now confetti"},
	OutcomeCrash:            {"Returned to Earth. Firmly.", "Lithobraked"},
	OutcomeExplode:          {"Scattered artistically", "Distributed across the county"},
	OutcomeFizzle:           {"Still on the pad", "Embarrassed"},
}

var quips = map[string][]string{
	"success": {
		"The engineers are pretending they expected this.",
		"Mission control is high-fiving nervously.",
		"Nobody is more surprised than me.",
	},
	"partial": {
		"We're calling this a success in the press release.",
		"The data is 'interesting'.",
		"Some of it went to space. That counts.",
	},
	"failure": {
		"On the bright side, excellent footage.",
		"We learned a lot. Mostly about fire.",
		"Let's call it a very loud test.",
	},
}

// buildReport writes the mission report card.
func buildReport(r *Rocket, s Stats, o Outcome, f flight, rng *rand.Rand) Report {
	headline, grade := grades[o][0], grades[o][1]
	payload := pick(rng, []string{"Delivered", "Deployed on schedule"})
	if lines, ok := cargoLines[o]; ok {
		payload = pick(rng, lines)
	}
	crew := "No crew. Smart."
	if r.Payload.Crew > 0 {
		switch {
		case grade != "failure":
			ride := "Comfortable"
			if f.maxG > 8 {
				ride = fmt.Sprintf("Flattened at %.1f g", f.maxG)
			} else if f.maxG > 5 {
				ride = "Heavy but fine"
			}
			home := "no heat shield, so they live there now"
			if r.Payload.HeatShield && r.Payload.Parachutes {
				home = "can come home"
			} else if r.Payload.HeatShield {
				home = "no parachutes for the way home"
			}
			crew = ride + ", " + home
		case o == OutcomeFizzle:
			crew = "Embarrassed, went home early"
		case r.Payload.Parachutes:
			crew = pick(rng, []string{"Aborted and parachuted. Furious.", "Safely ejected. Soggy."})
		default:
			crew = "No parachutes. Deeply unimpressed."
		}
	}
	recovery := "Nothing. It's all in the ocean"
	if r.Legs != nil {
		recovery = "First stage tried to land"
		if f.landed {
			recovery = "First stage landed"
		}
	}
	var anomalies []string
	if f.engineOuts > 0 {
		anomalies = append(anomalies, fmt.Sprintf("%d engine out", f.engineOuts))
	}
	for _, e := range f.events {
		switch e.Type {
		case EventBoosterFail:
			anomalies = append(anomalies, "booster failure")
		case EventSpin:
			anomalies = append(anomalies, "lost control")
		case EventStall:
			anomalies = append(anomalies, "stage did not light")
		}
	}
	rows := []ReportRow{
		{"ALTITUDE", whereabouts(o, f)},
		{"MAX-Q", fmt.Sprintf("%.1f kPa", f.maxQ/1000)},
		{"PEAK LOAD", fmt.Sprintf("%.1f g", f.maxG)},
		{"Δv SPENT", withCommas(f.deltaVUsed) + " m/s"},
		{"PAYLOAD", payload},
		{"CREW STATUS", crew},
		{"RECOVERY", recovery},
	}
	if len(anomalies) > 0 {
		rows = append(rows, ReportRow{"ANOMALIES", strings.Join(anomalies, ", ")})
	}
	return Report{
		Headline: "MISSION: " + headline,
		Grade:    grade,
		Rows:     rows,
		Quip:     pick(rng, quips[grade]),
		Chaos:    s.Chaos,
	}
}

// stagingRows summarises each stage against its rocket-equation budget.
func stagingRows(r *Rocket, v *vehicle, f flight) []StagingRow {
	phases := burns(v)
	engineOut := map[string]bool{}
	for _, e := range f.events {
		if e.Type == EventEngineOut {
			engineOut[e.ID] = true
		}
	}
	find := func(key string) usage {
		for _, u := range f.usage {
			if u.key == key {
				return u
			}
		}
		return usage{}
	}
	var rows []StagingRow
	if len(r.Boosters) > 0 {
		var burned float64
		failedAny := false
		for _, b := range v.boosters {
			u := find(b.key)
			burned += u.burned
			failedAny = failedAny || u.failed
		}
		burned /= float64(len(v.boosters))
		status := "nominal"
		switch {
		case failedAny:
			status = "failed"
		case burned < 0.97:
			status = "spare fuel"
		}
		rows = append(rows, StagingRow{
			Label:      fmt.Sprintf("BOOSTERS ×%d", len(r.Boosters)),
			Propellant: propellantSpecs[r.Boosters[0].Propellant].Label,
			Burned:     burned, Status: status,
		})
	}
	for i, s := range v.stages {
		u := find(s.key)
		dv := 0.0
		for _, p := range phases {
			if p.Label == s.label || strings.HasPrefix(p.Label, s.label+" +") {
				dv += p.DeltaV
			}
		}
		status := "nominal"
		switch {
		case u.failed:
			status = "failed"
		case engineOut[s.id]:
			status = "engine out"
		case !u.ignited || u.burned < 0.01:
			status = "unused"
		case u.burned < 0.97:
			status = "spare fuel"
		}
		rows = append(rows, StagingRow{
			Label: fmt.Sprintf("STAGE %d", i+1), Propellant: propellantSpecs[s.propellant].Label,
			DeltaV: dv, Burned: u.burned, Status: status,
		})
	}
	return rows
}

// mission names the physical causes of how a launch went, for AI repair.
func mission(r *Rocket, v *vehicle, s Stats, o Outcome, headline string) Mission {
	var out []string
	for _, p := range problems(r, s) {
		out = append(out, p.Text)
	}
	switch o {
	case OutcomeSpin:
		detail := ""
		if !hasControl(v, v.owners()) {
			detail = ", no gimballed engines"
		}
		out = append(out, fmt.Sprintf("lost aerodynamic control: static margin %.1f calibers%s", s.Stability, detail))
	case OutcomeBreakup:
		out = append(out, "air loads exceeded what the structure takes: too slender, too fast low down, or flying sideways into the wind")
	case OutcomeStageMalfunction:
		out = append(out, "an upper stage failed to ignite")
	case OutcomeExplode:
		out = append(out, "hardware failure; high engine power raises the odds")
	case OutcomePayloadEarly:
		out = append(out, "payload came loose; silly decorations and a missing nose make that likelier")
	}
	if r.Stages[0].Engine.Style == "flared" {
		out = append(out, "vacuum-flared nozzles on the first stage lose thrust at sea level")
	}
	if s.Reliability < 60 {
		out = append(out, fmt.Sprintf("hardware reliability %.0f%%", s.Reliability))
	}
	if r.Tilt != 0 {
		out = append(out, fmt.Sprintf("mounted at %.0f degrees", r.Tilt))
	}
	if out == nil {
		out = []string{}
	}
	return Mission{Outcome: o, Headline: headline, Problems: out}
}
