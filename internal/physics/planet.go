package physics

import "math"

// The launch world is a Kerbin-sized planet: a tenth of Earth's radius with
// Earth's surface gravity and a 70 km atmosphere. Orbit takes about
// 3.4 km/s instead of 9.3, so a launch lasts minutes rather than a quarter
// of an hour, while every force in it is still real.
const (
	g0             = 9.80665
	planetRadius   = 600_000.0
	surfaceGravity = 9.81
	planetMu       = surfaceGravity * planetRadius * planetRadius
	siderealDay    = 21_549.425
	gasConstant    = 287.053
	heatRatio      = 1.4
	seaLevelP      = 101_325.0
	scaleHeight    = 5_600.0
	atmosphereTop  = 70_000.0
)

// planetSpin is the planet's rotation rate in radians per second.
const planetSpin = 2 * math.Pi / siderealDay

// surfaceSpeed is the eastward speed of the equatorial launch site, which the
// vehicle starts with in the inertial frame.
const surfaceSpeed = planetSpin * planetRadius

// topPressureFraction is exp(-atmosphereTop/scaleHeight), subtracted so that
// pressure reaches exactly zero at the edge of space.
var topPressureFraction = math.Exp(-atmosphereTop / scaleHeight)

// temperatureProfile is air temperature in kelvin against altitude: a
// troposphere, a cold tropopause, a warm stratopause and a cold edge.
var temperatureProfile = [][2]float64{
	{0, 288}, {12_000, 220}, {24_000, 220}, {45_000, 265},
	{60_000, 230}, {atmosphereTop, 200},
}

// air is the state of the atmosphere at one altitude.
type air struct {
	pressure     float64
	density      float64
	speedOfSound float64
}

// temperature interpolates the temperature profile.
func temperature(altitude float64) float64 {
	return interpolate(temperatureProfile, altitude)
}

// interpolate reads a piecewise-linear table of ascending x, holding the end
// values beyond it.
func interpolate(points [][2]float64, x float64) float64 {
	if x <= points[0][0] {
		return points[0][1]
	}
	for i := 1; i < len(points); i++ {
		a, b := points[i-1], points[i]
		if x <= b[0] {
			return a[1] + (b[1]-a[1])*(x-a[0])/(b[0]-a[0])
		}
	}
	return points[len(points)-1][1]
}

// atmosphere returns pressure, density and speed of sound at an altitude.
// Pressure falls exponentially and is pinned to zero at the top of the
// atmosphere, as on Kerbin.
func atmosphere(altitude float64) air {
	h := math.Max(0, altitude)
	temp := temperature(h)
	sound := math.Sqrt(heatRatio * gasConstant * temp)
	if h >= atmosphereTop {
		return air{speedOfSound: sound}
	}
	fraction := (math.Exp(-h/scaleHeight) - topPressureFraction) /
		(1 - topPressureFraction)
	p := seaLevelP * fraction
	return air{
		pressure:     p,
		density:      p / (gasConstant * temp),
		speedOfSound: sound,
	}
}

// dragRise scales the zero-lift drag coefficient with Mach number: flat
// subsonic, a transonic peak, then a slow supersonic decline.
func dragRise(mach float64) float64 {
	return interpolate([][2]float64{
		{0, 1}, {0.8, 1.02}, {1.0, 1.55}, {1.2, 1.8}, {1.5, 1.6},
		{2, 1.4}, {3, 1.2}, {5, 1.05}, {10, 1},
	}, mach)
}

// gravityAt is the gravitational acceleration at a distance from the centre.
func gravityAt(radius float64) float64 {
	return planetMu / (radius * radius)
}

// circularSpeed is the orbital speed of a circular orbit at a radius.
func circularSpeed(radius float64) float64 {
	return math.Sqrt(planetMu / radius)
}
