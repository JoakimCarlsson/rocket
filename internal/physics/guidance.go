package physics

import "math"

// This file is Unified Powered Flight Guidance (UPFG), the Space Shuttle's
// closed-loop ascent guidance, ported from the PEGAS kOS implementation
// (github.com/Noiredd/PEGAS, pegas_upfg.ks). The conic state extrapolator
// PEGAS uses for the gravity integrals is replaced by numerically
// integrating the coast arc, which is exact for a point-mass Earth.

// vec3 is a 3D vector. Flight happens in the z = 0 plane; the orbit normal is
// +z, so r × normal points prograde.
type vec3 struct{ x, y, z float64 }

// add returns a + b.
func (a vec3) add(b vec3) vec3 { return vec3{a.x + b.x, a.y + b.y, a.z + b.z} }

// sub returns a - b.
func (a vec3) sub(b vec3) vec3 { return vec3{a.x - b.x, a.y - b.y, a.z - b.z} }

// scale returns a times k.
func (a vec3) scale(k float64) vec3 { return vec3{a.x * k, a.y * k, a.z * k} }

// dot returns a · b.
func (a vec3) dot(b vec3) float64 { return a.x*b.x + a.y*b.y + a.z*b.z }

// cross returns a × b.
func (a vec3) cross(b vec3) vec3 {
	return vec3{a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x}
}

// length returns |a|.
func (a vec3) length() float64 { return math.Sqrt(a.dot(a)) }

// unit returns a scaled to length 1.
func (a vec3) unit() vec3 { return a.scale(1 / math.Max(1e-12, a.length())) }

// angle returns the angle between a and b in radians.
func (a vec3) angle(b vec3) float64 {
	return math.Acos(clamp(a.unit().dot(b.unit()), -1, 1))
}

// lift3 embeds a plane vector in 3D.
func lift3(v vec) vec3 { return vec3{v.x, v.y, 0} }

// orbitNormal is the normal of the prograde (eastward) orbit plane.
var orbitNormal = vec3{0, 0, 1}

// upfgStage is one burn UPFG plans with. A constant-thrust burn runs its
// engines flat out; a constant-acceleration burn (limit > 0) throttles to
// hold the vehicle at a g-limit, as UPFG's mode 2.
type upfgStage struct {
	thrust   float64
	flow     float64
	exhaust  float64
	burnTime float64
	mass     float64
	limit    float64
}

// upfgTarget is the insertion state: radius, speed and flight-path angle.
type upfgTarget struct {
	radius   float64
	velocity float64
	gamma    float64
}

// upfgMemory is what UPFG carries from one guidance cycle to the next.
type upfgMemory struct {
	rbias vec3
	rd    vec3
	rgrav vec3
	tgo   float64
	v     vec3
	vgo   vec3
}

// newUPFG seeds the guidance memory, as PEGAS's setupUPFG does: the target
// point starts 20 degrees downrange of the vehicle.
func newUPFG(r, v vec3, target upfgTarget) upfgMemory {
	ahead := 20 * math.Pi / 180
	up := r.unit()
	prograde := r.cross(orbitNormal).unit()
	rd := up.scale(math.Cos(ahead)).add(prograde.scale(math.Sin(ahead))).scale(target.radius)
	return upfgMemory{
		rd:    rd,
		rgrav: r.scale(-earthMu / 2 / math.Pow(r.length(), 3)),
		v:     v,
		vgo:   rd.cross(orbitNormal).unit().scale(target.velocity).sub(v),
	}
}

// coast propagates a free-fall arc under point-mass gravity.
func coast(r, v vec3, duration float64) (vec3, vec3) {
	steps := int(math.Max(20, math.Min(400, duration/2)))
	h := duration / float64(steps)
	accel := func(p vec3) vec3 {
		d := p.length()
		return p.scale(-earthMu / (d * d * d))
	}
	for i := 0; i < steps; i++ {
		k1v, k1r := accel(r), v
		k2v, k2r := accel(r.add(k1r.scale(h/2))), v.add(k1v.scale(h/2))
		k3v, k3r := accel(r.add(k2r.scale(h/2))), v.add(k2v.scale(h/2))
		k4v, k4r := accel(r.add(k3r.scale(h))), v.add(k3v.scale(h))
		r = r.add(k1r.add(k2r.scale(2)).add(k3r.scale(2)).add(k4r).scale(h / 6))
		v = v.add(k1v.add(k2v.scale(2)).add(k3v.scale(2)).add(k4v).scale(h / 6))
	}
	return r, v
}

// upfg runs one guidance cycle. It returns the thrust direction, time to go
// and the memory for the next cycle. stages[0] is the burning stage with its
// remaining burn time; mass is the vehicle's current mass.
func upfg(stages []upfgStage, target upfgTarget, r, v vec3, mass float64, prev upfgMemory) (vec3, float64, upfgMemory) {
	n := len(stages)
	tu := make([]float64, n)
	tb := make([]float64, n)
	for i, s := range stages {
		accel := s.thrust / s.mass
		if i == 0 {
			accel = s.thrust / mass
		}
		if s.limit > 0 {
			accel = s.limit
		}
		tu[i] = s.exhaust / accel
		tb[i] = s.burnTime
	}

	vgo := prev.vgo.sub(v.sub(prev.v))
	li := make([]float64, n)
	total := 0.0
	for i := 0; i < n-1; i++ {
		if stages[i].limit > 0 {
			li[i] = stages[i].limit * tb[i]
		} else {
			li[i] = stages[i].exhaust * math.Log(tu[i]/math.Max(1e-6, tu[i]-tb[i]))
		}
		total += li[i]
		if total > vgo.length() {
			return upfg(stages[:n-1], target, r, v, mass, prev)
		}
	}
	li[n-1] = vgo.length() - total

	tgoi := make([]float64, n)
	for i := range stages {
		if stages[i].limit > 0 {
			tb[i] = li[i] / stages[i].limit
		} else {
			tb[i] = tu[i] * (1 - math.Exp(-li[i]/stages[i].exhaust))
		}
		tgoi[i] = tb[i]
		if i > 0 {
			tgoi[i] += tgoi[i-1]
		}
	}
	tgo := tgoi[n-1]

	var bigL, bigJ, bigS, bigQ, bigH, bigP float64
	for i, s := range stages {
		before := 0.0
		if i > 0 {
			before = tgoi[i-1]
		}
		ve := s.exhaust
		var ji, si, qi, pi float64
		if s.limit > 0 {
			ji = 0.5 * li[i] * tb[i]
			si = ji
			qi = si * (tb[i]/3 + before)
			pi = si * (tgoi[i]*tgoi[i] + 2*tgoi[i]*before + 3*before*before) / 6
		} else {
			ji = tu[i]*li[i] - ve*tb[i]
			si = -ji + tb[i]*li[i]
			qi = si*(tu[i]+before) - 0.5*ve*tb[i]*tb[i]
			pi = qi*(tu[i]+before) - 0.5*ve*tb[i]*tb[i]*(tb[i]/3+before)
		}
		ji += li[i] * before
		si += bigL * tb[i]
		qi += bigJ * tb[i]
		pi += bigH * tb[i]
		bigL += li[i]
		bigJ += ji
		bigS += si
		bigQ += qi
		bigP += pi
		bigH = bigJ*tgoi[i] - bigQ
	}

	lambda := vgo.unit()
	rgrav := prev.rgrav
	if prev.tgo > 0 {
		ratio := tgo / prev.tgo
		rgrav = rgrav.scale(ratio * ratio)
	}
	rgo := prev.rd.sub(r.add(v.scale(tgo)).add(rgrav))
	iz := prev.rd.cross(orbitNormal).unit()
	rgoxy := rgo.sub(iz.scale(iz.dot(rgo)))
	rgoz := (bigS - lambda.dot(rgoxy)) / lambda.dot(iz)
	rgo = rgoxy.add(iz.scale(rgoz)).add(prev.rbias)
	lambdade := bigQ - bigS*bigJ/bigL
	lambdadot := rgo.sub(lambda.scale(bigS)).scale(1 / lambdade)
	thrustDir := lambda.sub(lambdadot.scale(bigJ / bigL)).unit()
	phi := thrustDir.angle(lambda)
	phidot := -phi * bigL / bigJ
	vthrust := lambda.scale(bigL - 0.5*bigL*phi*phi - bigJ*phi*phidot - 0.5*bigH*phidot*phidot)
	rthrust := lambda.scale(bigS - 0.5*bigS*phi*phi - bigQ*phi*phidot - 0.5*bigP*phidot*phidot).
		sub(lambdadot.unit().scale(bigS*phi + bigQ*phidot))
	vbias := vgo.sub(vthrust)
	rbias := rgo.sub(rthrust)

	rc1 := r.sub(rthrust.scale(0.1)).sub(vthrust.scale(tgo / 30))
	vc1 := v.add(rthrust.scale(1.2 / tgo)).sub(vthrust.scale(0.1))
	rc2, vc2 := coast(rc1, vc1, tgo)
	rgrav = rc2.sub(rc1).sub(vc1.scale(tgo))
	vgrav := vc2.sub(vc1)

	rp := r.add(v.scale(tgo)).add(rgrav).add(rthrust)
	rp = rp.sub(orbitNormal.scale(rp.dot(orbitNormal)))
	rd := rp.unit().scale(target.radius)
	ix := rd.unit()
	iz = ix.cross(orbitNormal)
	vd := ix.scale(math.Sin(target.gamma)).add(iz.scale(math.Cos(target.gamma))).scale(target.velocity)
	vgo = vd.sub(v).sub(vgrav).add(vbias)

	return thrustDir, tgo, upfgMemory{
		rbias: rbias, rd: rd, rgrav: rgrav, tgo: tgo, v: v, vgo: vgo,
	}
}
