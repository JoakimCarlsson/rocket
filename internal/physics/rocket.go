package physics

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"slices"
)

// Enumerated part values, matching the web app's model.
var (
	nozzleStyles  = []string{"bell", "aerospike", "flared", "trumpet"}
	propellants   = []string{"solid", "kerolox", "methalox", "hydrolox"}
	topKinds      = []string{"cone", "ogive", "needle", "blunt", "dome", "spike", "none"}
	boosterTops   = []string{"cone", "ogive", "blunt"}
	payloadKinds  = []string{"capsule", "fairing", "satellite", "cargo", "habitat", "none"}
	finShapes     = []string{"delta", "swept", "grid", "tiny", "shark"}
	destinations  = []string{"orbit", "moon", "mars", "sun", "nowhere"}
	decorKinds    = []string{"antenna", "ring", "solarPanels", "spikes", "lights", "wings", "flag", "googlyEyes", "duck", "windows", "tank", "propeller"}
	decorAttaches = []string{"top", "payload", "core", "bottom"}
	finishes      = []string{"matte", "satin", "metallic", "chrome", "glossy"}
	patterns      = []string{"solid", "stripes", "bands", "checker", "split"}
)

// Hard bounds that keep a configuration flyable and renderable.
const (
	maxBoosters   = 24
	maxStages     = 6
	maxEngines    = 19
	maxDecor      = 30
	maxDecorCount = 12
)

// Engine is one engine cluster under a stage or booster.
type Engine struct {
	Count  float64 `json:"count"`
	Size   float64 `json:"size"`
	Power  float64 `json:"power"`
	Style  string  `json:"style"`
	Gimbal *bool   `json:"gimbal,omitempty"`
}

// Stage is one core section. Stages are ordered bottom to top.
type Stage struct {
	ID         string  `json:"id"`
	Height     float64 `json:"height"`
	Radius     float64 `json:"radius"`
	Taper      float64 `json:"taper"`
	Propellant string  `json:"propellant"`
	Engine     Engine  `json:"engine"`
}

// Booster is one strap-on side booster.
type Booster struct {
	ID         string  `json:"id"`
	Height     float64 `json:"height"`
	Radius     float64 `json:"radius"`
	Top        string  `json:"top"`
	Propellant string  `json:"propellant"`
	Engine     Engine  `json:"engine"`
}

// Payload is what the rocket carries and the cap on top of it.
type Payload struct {
	ID         string  `json:"id"`
	Kind       string  `json:"kind"`
	Height     float64 `json:"height"`
	Crew       float64 `json:"crew"`
	Top        string  `json:"top"`
	HeatShield bool    `json:"heatShield"`
	Parachutes bool    `json:"parachutes"`
}

// Fins are a set of fins around the bottom stage.
type Fins struct {
	ID    string  `json:"id"`
	Count float64 `json:"count"`
	Size  float64 `json:"size"`
	Shape string  `json:"shape"`
}

// Legs are landing legs around the bottom stage.
type Legs struct {
	ID    string  `json:"id"`
	Count float64 `json:"count"`
	Size  float64 `json:"size"`
}

// Decor is one kind of add-on, repeated Count times.
type Decor struct {
	ID     string  `json:"id"`
	Kind   string  `json:"kind"`
	Attach string  `json:"attach"`
	Count  float64 `json:"count"`
	Size   float64 `json:"size"`
}

// Appearance holds the parts of the look that the physics reads.
type Appearance struct {
	Finish  string `json:"finish"`
	Pattern string `json:"pattern"`
}

// Rocket is the physical part of a configuration. Colours and other purely
// visual fields are ignored.
type Rocket struct {
	Name        string     `json:"name"`
	Seed        float64    `json:"seed"`
	Destination string     `json:"destination"`
	Tilt        float64    `json:"tilt"`
	Stages      []Stage    `json:"stages"`
	Boosters    []Booster  `json:"boosters"`
	Payload     Payload    `json:"payload"`
	Fins        *Fins      `json:"fins"`
	Legs        *Legs      `json:"legs"`
	Decor       []Decor    `json:"decorativeParts"`
	Appearance  Appearance `json:"appearance"`
}

// ErrInvalidRocket reports a configuration the engine cannot fly.
var ErrInvalidRocket = errors.New("invalid rocket")

// ParseRocket decodes a configuration, checks every enumerated field and
// clamps every number into the bounds the game allows.
func ParseRocket(data []byte) (*Rocket, error) {
	var r Rocket
	if err := json.Unmarshal(data, &r); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidRocket, err)
	}
	if err := r.normalize(); err != nil {
		return nil, err
	}
	return &r, nil
}

// ParseRocketMap is ParseRocket for a configuration already decoded to a map.
func ParseRocketMap(config map[string]any) (*Rocket, error) {
	data, err := json.Marshal(config)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidRocket, err)
	}
	return ParseRocket(data)
}

// oneOf reports an error unless value is one of allowed, filling in fallback
// when value is empty.
func oneOf(field string, value *string, allowed []string, fallback string) error {
	if *value == "" && fallback != "" {
		*value = fallback
	}
	if !slices.Contains(allowed, *value) {
		return fmt.Errorf("%w: %s %q", ErrInvalidRocket, field, *value)
	}
	return nil
}

// clamp bounds a number, mapping NaN to the minimum.
func clamp(v, lo, hi float64) float64 {
	if math.IsNaN(v) {
		return lo
	}
	return math.Min(hi, math.Max(lo, v))
}

// clampInt bounds and rounds a number.
func clampInt(v, lo, hi float64) float64 {
	return math.Round(clamp(v, lo, hi))
}

// normalizeEngine validates one engine cluster.
func normalizeEngine(e *Engine, field string, gimbalDefault bool) error {
	if err := oneOf(field+".style", &e.Style, nozzleStyles, "bell"); err != nil {
		return err
	}
	e.Count = clampInt(e.Count, 1, maxEngines)
	e.Size = clamp(e.Size, 0.3, 3.5)
	e.Power = clamp(e.Power, 1, 10)
	if e.Gimbal == nil {
		e.Gimbal = &gimbalDefault
	}
	return nil
}

// normalize validates and clamps the whole configuration in place.
func (r *Rocket) normalize() error {
	if len(r.Stages) == 0 {
		return fmt.Errorf("%w: no stages", ErrInvalidRocket)
	}
	if len(r.Stages) > maxStages {
		r.Stages = r.Stages[:maxStages]
	}
	if len(r.Boosters) > maxBoosters {
		r.Boosters = r.Boosters[:maxBoosters]
	}
	if len(r.Decor) > maxDecor {
		r.Decor = r.Decor[:maxDecor]
	}
	if err := oneOf("destination", &r.Destination, destinations, "orbit"); err != nil {
		return err
	}
	if err := oneOf("appearance.finish", &r.Appearance.Finish, finishes, "satin"); err != nil {
		return err
	}
	if err := oneOf("appearance.pattern", &r.Appearance.Pattern, patterns, "solid"); err != nil {
		return err
	}
	r.Tilt = clamp(r.Tilt, -180, 180)
	for i := range r.Stages {
		s := &r.Stages[i]
		if err := oneOf("stage.propellant", &s.Propellant, propellants, "kerolox"); err != nil {
			return err
		}
		s.Height = clamp(s.Height, 3, 90)
		s.Radius = clamp(s.Radius, 0.6, 12)
		s.Taper = clamp(s.Taper, 0, 0.6)
		if err := normalizeEngine(&s.Engine, "stage.engine", true); err != nil {
			return err
		}
	}
	for i := range r.Boosters {
		b := &r.Boosters[i]
		if err := oneOf("booster.propellant", &b.Propellant, propellants, "solid"); err != nil {
			return err
		}
		if err := oneOf("booster.top", &b.Top, boosterTops, "cone"); err != nil {
			return err
		}
		b.Height = clamp(b.Height, 4, 80)
		b.Radius = clamp(b.Radius, 0.4, 6)
		if err := normalizeEngine(&b.Engine, "booster.engine", false); err != nil {
			return err
		}
	}
	p := &r.Payload
	if err := oneOf("payload.kind", &p.Kind, payloadKinds, "capsule"); err != nil {
		return err
	}
	if err := oneOf("payload.top", &p.Top, topKinds, "cone"); err != nil {
		return err
	}
	p.Height = clamp(p.Height, 2, 30)
	p.Crew = clampInt(p.Crew, 0, 12)
	if r.Fins != nil {
		if err := oneOf("fins.shape", &r.Fins.Shape, finShapes, "swept"); err != nil {
			return err
		}
		r.Fins.Count = clampInt(r.Fins.Count, 2, 12)
		r.Fins.Size = clamp(r.Fins.Size, 0.3, 4)
	}
	if r.Legs != nil {
		r.Legs.Count = clampInt(r.Legs.Count, 3, 8)
		r.Legs.Size = clamp(r.Legs.Size, 0.5, 3)
	}
	for i := range r.Decor {
		d := &r.Decor[i]
		if err := oneOf("decor.kind", &d.Kind, decorKinds, ""); err != nil {
			return err
		}
		if err := oneOf("decor.attach", &d.Attach, decorAttaches, "core"); err != nil {
			return err
		}
		d.Count = clampInt(d.Count, 1, maxDecorCount)
		d.Size = clamp(d.Size, 0.2, 4)
	}
	return nil
}

// gimballed reports whether an engine cluster can steer.
func (e Engine) gimballed() bool {
	return e.Gimbal != nil && *e.Gimbal
}
