package physics

import (
	"math"
	"math/rand/v2"
	"sync"
)

// The autopilot's pitch-over kick decides the whole gravity turn: too small
// and the rocket climbs too steeply to ever build horizontal speed, too big
// and it lies down in thick air. Like trajectory optimisers in real ascent
// planners, bestKick flies calm rehearsals and keeps the kick that reaches
// orbit with the most propellant left, or the most orbital energy when orbit
// is out of reach, then backs off towards a steeper, safer climb as far as
// orbit is still reached.

// kickRange bounds the pitch-over kick in radians.
var kickRange = [2]float64{1.5 * math.Pi / 180, 30 * math.Pi / 180}

// kickCache remembers the chosen kick per vehicle, since every attempt of the
// same rocket flies the same gravity turn.
var kickCache = struct {
	sync.Mutex
	kicks map[uint64]float64
}{kicks: map[uint64]float64{}}

// maxCachedKicks bounds the cache.
const maxCachedKicks = 4096

// rehearsalScore rates one calm flight with a given kick: reaching orbit beats
// everything, then more propellant left; short of orbit, more orbital energy;
// a vehicle lost to the air ranks last.
func rehearsalScore(r *Rocket, v *vehicle, kick float64) float64 {
	f := fly(r, v, rand.New(rand.NewPCG(1, 2)), 0, flightPlan{kick: kick, rehearsal: true})
	switch {
	case f.orbited:
		return 1e12 + f.fuelLeft
	case f.end == endBreakup || f.end == endSpin || f.end == endExplode:
		return -1e12 + f.maxAltitude
	}
	return f.energy
}

// rehearseAll scores several kicks concurrently.
func rehearseAll(r *Rocket, v *vehicle, kicks []float64) []float64 {
	scores := make([]float64, len(kicks))
	var wg sync.WaitGroup
	for i, k := range kicks {
		wg.Go(func() { scores[i] = rehearsalScore(r, v, k) })
	}
	wg.Wait()
	return scores
}

// bestKick returns the pitch-over kick for a rocket, searching a coarse grid
// and then refining the best bracket by golden-section search.
func bestKick(r *Rocket, v *vehicle) float64 {
	if r.Destination == "nowhere" {
		return 0
	}
	key := seedOf(r, 0)
	kickCache.Lock()
	cached, ok := kickCache.kicks[key]
	kickCache.Unlock()
	if ok {
		return cached
	}

	grid := []float64{1.5, 2, 3, 4.5, 6, 8, 11, 15, 20, 30}
	for i := range grid {
		grid[i] *= math.Pi / 180
	}
	scores := rehearseAll(r, v, grid)
	best := 0
	for i := range grid {
		if scores[i] > scores[best] {
			best = i
		}
	}
	lo := grid[max(0, best-1)]
	hi := grid[min(len(grid)-1, best+1)]
	ratio := (math.Sqrt(5) - 1) / 2
	a, b := hi-ratio*(hi-lo), lo+ratio*(hi-lo)
	fa, fb := rehearsalScore(r, v, a), rehearsalScore(r, v, b)
	for range 6 {
		if fa > fb {
			hi, b, fb = b, a, fa
			a = hi - ratio*(hi-lo)
			fa = rehearsalScore(r, v, a)
		} else {
			lo, a, fa = a, b, fb
			b = lo + ratio*(hi-lo)
			fb = rehearsalScore(r, v, b)
		}
	}
	kick := (lo + hi) / 2
	if scores[best] > math.Max(fa, fb) {
		kick = grid[best]
	}
	kick = clamp(kick, kickRange[0], kickRange[1])
	margins := []float64{0.7, 0.8, 0.9, 1}
	candidates := make([]float64, len(margins))
	for i, m := range margins {
		candidates[i] = kick * m
	}
	for i, score := range rehearseAll(r, v, candidates) {
		if score >= 1e12 {
			kick = candidates[i]
			break
		}
	}

	kickCache.Lock()
	if len(kickCache.kicks) >= maxCachedKicks {
		kickCache.kicks = map[uint64]float64{}
	}
	kickCache.kicks[key] = kick
	kickCache.Unlock()
	return kick
}
