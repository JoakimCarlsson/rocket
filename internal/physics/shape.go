package physics

import "math"

// shapeFill is the fraction of its bounding box each shape fills, which
// scales its skin, frontal and side areas.
var shapeFill = map[string]float64{
	"sphere": 0.52, "hemisphere": 0.52, "capsule": 0.6, "cylinder": 0.79,
	"cone": 0.33, "box": 1, "torus": 0.35, "wedge": 0.5, "star": 0.45,
	"heart": 0.6, "smile": 0.2,
}

// shapeDrag is the drag coefficient of each shape facing the airflow.
var shapeDrag = map[string]float64{
	"sphere": 0.47, "hemisphere": 0.42, "capsule": 0.4, "cylinder": 0.8,
	"cone": 0.5, "box": 1.05, "torus": 0.9, "wedge": 0.7, "star": 1.1,
	"heart": 1.1, "smile": 0.9,
}

// shapeArealDensity is the skin mass per square metre of each material:
// shapes are hollow fibreglass sculptures, not solid lumps.
var shapeArealDensity = map[string]float64{
	"paint": 22, "chrome": 45, "glass": 34, "glow": 26,
}

// shapeExtents is the half extents of a shape's bounding box after its own
// pitch, yaw and roll: across the axis (x, z) and along it (y).
func shapeExtents(s Shape) (x, y, z float64) {
	rad := math.Pi / 180
	cx, sx := math.Cos(s.Pitch*rad), math.Sin(s.Pitch*rad)
	cy, sy := math.Cos(s.Yaw*rad), math.Sin(s.Yaw*rad)
	cz, sz := math.Cos(s.Roll*rad), math.Sin(s.Roll*rad)
	m := [3][3]float64{
		{cy * cz, -cy * sz, sy},
		{cx*sz + sx*sy*cz, cx*cz - sx*sy*sz, -sx * cy},
		{sx*sz - cx*sy*cz, sx*cz + cx*sy*sz, cx * cy},
	}
	h := [3]float64{s.Width / 2, s.Height / 2, s.Depth / 2}
	var e [3]float64
	for i := range 3 {
		for j := range 3 {
			e[i] += math.Abs(m[i][j]) * h[j]
		}
	}
	return e[0], e[1], e[2]
}

// shapeExposure is the fraction of a shape's frontal area that sticks out of
// the hull into the airflow, given its distance from the axis, its largest
// half extent across the axis and the hull radius at its height.
func shapeExposure(radial, reach, hull float64) float64 {
	const floor = 0.1
	if hull <= 0 {
		return 1
	}
	if radial < hull*0.5 {
		return clamp(1-hull*hull/(reach*reach), floor, 1)
	}
	return clamp((radial+reach-hull)/(2*reach), floor, 1)
}

// shapeOwner is the segment a shape rides on: the upper segment when it
// hangs off the payload or top, otherwise the stage at its height.
func (r *Rocket) shapeOwner(s Shape, y float64) string {
	if s.Attach == "top" || s.Attach == "payload" {
		return upperOwner
	}
	i := r.stageIndexAt(math.Max(0, y))
	if i < 0 {
		return upperOwner
	}
	return "stage:" + r.Stages[i].ID
}

// addShape adds a sculpted shape's mass, drag and normal force. Flat shapes
// behave like fins; bulky ones add body lift where they sit, so a big head on
// the nose moves the centre of pressure forward.
func (v *vehicle) addShape(r *Rocket, s Shape) {
	y := r.decorAnchor(s.Attach) + s.Up
	owner := r.shapeOwner(s, y)
	fill := shapeFill[s.Shape]
	n := s.instances()
	ex, ey, ez := shapeExtents(s)

	skin := 8 * (ex*ey + ey*ez + ex*ez) * fill
	v.items = append(v.items, massItem{
		owner, skin * shapeArealDensity[s.Material] * n, y, 2 * ey,
	})

	hull := r.hullRadiusAt(y)
	reach := math.Max(0.05, math.Max(ex, ez))
	exposure := shapeExposure(s.Out, reach, hull)
	frontal := 4 * ex * ez * fill
	v.drag = append(
		v.drag,
		dragItem{owner, shapeDrag[s.Shape] * frontal * exposure * n},
	)

	side := 2 * (ex + ez) * ey * fill
	thinnest := math.Min(s.Width, math.Min(s.Height, s.Depth))
	thickest := math.Max(s.Width, math.Max(s.Height, s.Depth))
	slope := 0.5
	if thinnest < thickest*0.25 {
		slope = 1.6
	}
	inPlane := n
	if n > 1 {
		inPlane = n * 0.5
	}
	cna := slope * side * exposure * inPlane / v.refArea
	if cna > 1e-4 {
		v.lift = append(v.lift, liftItem{owner, cna, y})
	}
}
