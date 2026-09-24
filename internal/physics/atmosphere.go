package physics

import "math"

// Physical constants for Earth and air.
const (
	g0            = 9.80665
	earthRadius   = 6_371_000.0
	earthMu       = 3.986004418e14
	earthSpin     = 7.2921159e-5
	launchLat     = 28.5 * math.Pi / 180
	gasConstant   = 287.053
	heatRatio     = 1.4
	seaLevelP     = 101_325.0
	karmanLine    = 100_000.0
	atmosphereTop = 140_000.0
)

// surfaceSpeed is the eastward speed of the launch site, which the vehicle
// starts with in the inertial frame.
var surfaceSpeed = earthSpin * earthRadius * math.Cos(launchLat)

// layer is one band of the US Standard Atmosphere 1976.
type layer struct {
	base, temp, lapse, pressure float64
}

// layers are the 1976 standard atmosphere bands up to 86 km.
var layers = []layer{
	{0, 288.15, -0.0065, 101_325},
	{11_000, 216.65, 0, 22_632.06},
	{20_000, 216.65, 0.001, 5_474.889},
	{32_000, 228.65, 0.0028, 868.0187},
	{47_000, 270.65, 0, 110.9063},
	{51_000, 270.65, -0.0028, 66.93887},
	{71_000, 214.65, -0.002, 3.956420},
	{86_000, 186.87, 0, 0.3734},
}

// air is the state of the atmosphere at one altitude.
type air struct {
	pressure     float64
	density      float64
	speedOfSound float64
}

// atmosphere returns pressure, density and speed of sound at an altitude,
// following the 1976 standard atmosphere and an exponential tail above 86 km.
func atmosphere(altitude float64) air {
	h := math.Max(0, altitude)
	if h > atmosphereTop*2 {
		return air{speedOfSound: 300}
	}
	l := layers[0]
	for _, candidate := range layers {
		if h >= candidate.base {
			l = candidate
		}
	}
	dh := h - l.base
	temp := l.temp + l.lapse*dh
	var p float64
	switch {
	case l.base >= 86_000:
		p = l.pressure * math.Exp(-dh/7_000)
	case l.lapse == 0:
		p = l.pressure * math.Exp(-g0*dh/(gasConstant*l.temp))
	default:
		p = l.pressure * math.Pow(temp/l.temp, -g0/(gasConstant*l.lapse))
	}
	return air{
		pressure:     p,
		density:      p / (gasConstant * temp),
		speedOfSound: math.Sqrt(heatRatio * gasConstant * temp),
	}
}

// dragRise scales the zero-lift drag coefficient with Mach number: flat
// subsonic, a transonic peak, then a slow supersonic decline, as measured on
// slender bodies of revolution.
func dragRise(mach float64) float64 {
	points := [][2]float64{
		{0, 1}, {0.8, 1.02}, {1.0, 1.55}, {1.2, 1.8}, {1.5, 1.6},
		{2, 1.4}, {3, 1.2}, {5, 1.05}, {10, 1},
	}
	for i := 1; i < len(points); i++ {
		a, b := points[i-1], points[i]
		if mach <= b[0] {
			f := (mach - a[0]) / (b[0] - a[0])
			return a[1] + (b[1]-a[1])*f
		}
	}
	return 1
}
