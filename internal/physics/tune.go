package physics

import (
	"math"
	"math/rand/v2"
	"strings"
)

// EngineSetting is a tuned engine size and power for one stage or booster.
type EngineSetting struct {
	ID    string  `json:"id"    desc:"The stage or booster id."`
	Size  float64 `json:"size"  desc:"Engine size."`
	Power float64 `json:"power" desc:"Engine power, 1 to 10."`
}

// Tune picks engine sizes and powers that make a random rocket flyable:
// boosters lift 1.3 to 1.9 times their own weight, the liftoff burn lands at
// a thrust-to-weight of 1.25 to 2.2 and upper stages at 0.7 to 1.4. The
// choice is seeded by the rocket's own seed, so it never changes.
func Tune(r *Rocket) []EngineSetting {
	seed := uint64(r.Seed)
	rng := rand.New(rand.NewPCG(seed, seed^0x51f15e))
	between := func(lo, hi float64) float64 { return lo + (hi-lo)*rng.Float64() }

	v := buildVehicle(r)
	for i := range r.Boosters {
		b := &r.Boosters[i]
		g := v.boosters[i]
		mass := g.fuel
		for _, item := range v.items {
			if item.owner == g.key {
				mass += item.mass
			}
		}
		perEngine := mass * g0 * between(1.3, 1.9) / b.Engine.Count
		current := g.engine.thrust(seaLevelP)
		b.Engine.Size = clamp(b.Engine.Size*math.Sqrt(perEngine/math.Max(1, current)), 0.3, 3.5)
	}
	for i := range r.Stages {
		s := &r.Stages[i]
		target := between(0.7, 1.4)
		if i == 0 {
			target = between(1.25, 2.2)
		}
		for pass := 0; pass < 3; pass++ {
			var twr float64
			for _, b := range burns(buildVehicle(r)) {
				if strings.HasPrefix(b.Label, v.stages[i].label) {
					twr = b.TWR
					break
				}
			}
			if twr <= 0 {
				break
			}
			power := s.Engine.Power * target / twr
			s.Engine.Power = clamp(power, 1, 10)
			if power > 10 {
				s.Engine.Size = math.Min(3.5, s.Engine.Size*math.Sqrt(power/10))
			}
		}
	}
	var out []EngineSetting
	for _, s := range r.Stages {
		out = append(out, EngineSetting{s.ID, s.Engine.Size, s.Engine.Power})
	}
	for _, b := range r.Boosters {
		out = append(out, EngineSetting{b.ID, b.Engine.Size, b.Engine.Power})
	}
	return out
}
