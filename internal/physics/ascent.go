package physics

import (
	"math"
	"math/rand/v2"
	"sync"
)

// The ascent profile decides the whole gravity turn: turn too late and the
// rocket climbs too steeply to ever build horizontal speed, too early and it
// lies down in thick air. Like a player tuning MechJeb, bestProfile flies
// calm rehearsals over a grid of turn altitudes and shapes. Of the profiles
// that reach orbit within a few percent of the best propellant margin it
// keeps the steepest, since the most frugal turn usually skims the air and
// fails once real wind blows; when orbit is out of reach it keeps the one
// with the most orbital energy.

// turnEnds are the altitudes, in metres, where rehearsed turns end.
var turnEnds = []float64{25_000, 35_000, 45_000, 55_000, 65_000}

// turnShapes are the rehearsed turn exponents: small turns early and hard,
// large turns late and gently.
var turnShapes = []float64{0.3, 0.45, 0.6, 0.8}

// profileCache remembers the chosen profile per vehicle, since every attempt
// of the same rocket flies the same gravity turn.
var profileCache = struct {
	sync.Mutex
	profiles map[uint64]ascentProfile
}{profiles: map[uint64]ascentProfile{}}

// maxCachedProfiles bounds the cache.
const maxCachedProfiles = 4096

// frugalEnough is the share of the best propellant margin a steeper profile
// may give up.
const frugalEnough = 0.97

// rehearsalWeather is the weather every candidate profile is rehearsed in:
// calm, and a strong jet stream each way. A profile must reach orbit in all
// of them to count, since the real launch meets whatever wind the day has.
var rehearsalWeather = []wind{{}, {surface: 8, jet: 50}, {surface: -8, jet: -50}}

// rehearsal is one candidate profile flown in every rehearsal weather.
// Its flight is the worst of them.
type rehearsal struct {
	profile ascentProfile
	flight  flight
}

// steepness is the profile's mean elevation over the atmosphere, as a share
// of vertical: higher climbs out of the air sooner.
func (p ascentProfile) steepness() float64 {
	return math.Min(1, p.turnEnd/atmosphereTop) * p.shape / (p.shape + 1)
}

// rank orders rehearsal flights from worst to best: reaching orbit beats
// everything, then more propellant left; short of orbit, reaching space
// beats falling short of it, then more orbital energy; a vehicle lost to the
// air ranks last.
func rank(f flight) float64 {
	switch {
	case f.orbited:
		return 1e12 + f.fuelLeft
	case f.end == endBreakup || f.end == endSpin || f.end == endExplode:
		return -1e12 + f.maxAltitude
	case f.maxAltitude >= atmosphereTop:
		return 1e9 + f.energy
	}
	return f.energy
}

// choose picks the profile to fly from a set of rehearsals.
func choose(rehearsals []rehearsal) ascentProfile {
	bestFuel := -1.0
	for _, h := range rehearsals {
		if h.flight.orbited {
			bestFuel = math.Max(bestFuel, h.flight.fuelLeft)
		}
	}
	if bestFuel >= 0 {
		var pick *rehearsal
		for i, h := range rehearsals {
			if h.flight.orbited && h.flight.fuelLeft >= frugalEnough*bestFuel &&
				(pick == nil || h.profile.steepness() > pick.profile.steepness()) {
				pick = &rehearsals[i]
			}
		}
		return pick.profile
	}
	best := rehearsals[0]
	for _, h := range rehearsals[1:] {
		if rank(h.flight) > rank(best.flight) {
			best = h
		}
	}
	return best.profile
}

// worstFlight flies a profile in every rehearsal weather and returns its
// worst flight.
func worstFlight(r *Rocket, v *vehicle, p ascentProfile) flight {
	var worst flight
	for i, w := range rehearsalWeather {
		plan := flightPlan{profile: p, rehearsal: true, weather: w}
		f := fly(r, v, rand.New(rand.NewPCG(1, 2)), 0, plan)
		if i == 0 || rank(f) < rank(worst) {
			worst = f
		}
	}
	return worst
}

// bestProfile returns the ascent profile for a rocket.
func bestProfile(r *Rocket, v *vehicle) ascentProfile {
	key := seedOf(r, 0)
	profileCache.Lock()
	cached, ok := profileCache.profiles[key]
	profileCache.Unlock()
	if ok {
		return cached
	}

	var rehearsals []rehearsal
	for _, end := range turnEnds {
		for _, shape := range turnShapes {
			rehearsals = append(rehearsals, rehearsal{profile: ascentProfile{turnEnd: end, shape: shape}})
		}
	}
	var wg sync.WaitGroup
	for i := range rehearsals {
		wg.Go(func() { rehearsals[i].flight = worstFlight(r, v, rehearsals[i].profile) })
	}
	wg.Wait()
	profile := choose(rehearsals)

	profileCache.Lock()
	if len(profileCache.profiles) >= maxCachedProfiles {
		profileCache.profiles = map[uint64]ascentProfile{}
	}
	profileCache.profiles[key] = profile
	profileCache.Unlock()
	return profile
}
