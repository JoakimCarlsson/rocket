package physics

import "math"

// topHeightFactor is how tall each nose shape is per metre of radius.
var topHeightFactor = map[string]float64{
	"cone": 1.7, "ogive": 2.1, "needle": 3.6, "blunt": 0.7,
	"dome": 1, "spike": 3, "none": 0,
}

// section is one core stage body placed on the stack, measured from the
// bottom of the first stage.
type section struct {
	stage   *Stage
	index   int
	base    float64
	top     float64
	rBottom float64
	rTop    float64
}

// topHeight is the height of the nose cap for a given radius.
func topHeight(top string, radius float64) float64 {
	return topHeightFactor[top] * radius
}

// interstageHeight is the adapter joining two stacked stages.
func interstageHeight(lower, upper *Stage) float64 {
	return 1.2 +
		math.Abs(lower.Radius*(1-lower.Taper)-upper.Radius)*0.9 +
		upper.Engine.Size*0.6
}

// upperRadius is the radius of the top of the stack, where the payload sits.
func (r *Rocket) upperRadius() float64 {
	top := r.Stages[len(r.Stages)-1]
	return top.Radius * (1 - top.Taper)
}

// payloadHeight is the rendered height of the payload section.
func (r *Rocket) payloadHeight() float64 {
	if r.Payload.Kind == "none" {
		return 0
	}
	return r.Payload.Height
}

// payloadTopRadius is the radius at the top of the payload, under the nose.
func (r *Rocket) payloadTopRadius() float64 {
	u := r.upperRadius()
	switch r.Payload.Kind {
	case "capsule":
		return u * 0.58
	case "fairing":
		return u * 1.12
	case "satellite":
		return u * 0.75
	}
	return u
}

// sections stacks every stage body.
func (r *Rocket) sections() []section {
	out := make([]section, len(r.Stages))
	y := 0.0
	for i := range r.Stages {
		s := &r.Stages[i]
		if i > 0 {
			y += interstageHeight(&r.Stages[i-1], s)
		}
		out[i] = section{
			stage: s, index: i, base: y, top: y + s.Height,
			rBottom: s.Radius, rTop: s.Radius * (1 - s.Taper),
		}
		y += s.Height
	}
	return out
}

// coreTop is the height of the top of the core stack.
func (r *Rocket) coreTop() float64 {
	s := r.sections()
	return s[len(s)-1].top
}

// totalHeight is the full stack height in metres.
func (r *Rocket) totalHeight() float64 {
	return r.coreTop() + r.payloadHeight() +
		topHeight(r.Payload.Top, r.upperRadius())
}

// totalWidth is the widest extent, boosters included.
func (r *Rocket) totalWidth() float64 {
	core, booster := 1.0, 0.0
	for _, s := range r.Stages {
		core = math.Max(core, s.Radius)
	}
	for _, b := range r.Boosters {
		booster = math.Max(booster, b.Radius)
	}
	return (core + booster*2) * 2
}

// finGeometry is how far each fin reaches out and how long its root is.
func (r *Rocket) finGeometry() (span, rootChord float64) {
	if r.Fins == nil {
		return 0, 0
	}
	b := r.Stages[0]
	return r.Fins.Size * b.Radius * 0.9,
		math.Min(b.Height*0.5, r.Fins.Size*b.Radius*2.2)
}

// decorAnchor is the height a decoration attaches at.
func (r *Rocket) decorAnchor(attach string) float64 {
	core := r.coreTop()
	switch attach {
	case "top":
		return r.totalHeight()
	case "payload":
		return core + r.payloadHeight()*0.5
	case "core":
		return core * 0.55
	}
	return math.Min(core*0.18, 6)
}

// stageIndexAt is the stage whose body covers a height, or -1 above the core.
func (r *Rocket) stageIndexAt(height float64) int {
	for _, s := range r.sections() {
		if height <= s.top {
			return s.index
		}
	}
	return -1
}
