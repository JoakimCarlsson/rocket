"use client";

import { useMemo, useState } from "react";
import type { FlightEvent, FlightSample } from "@/lib/physics/api";

const W = 412;
const H = 120;
const PAD = { left: 34, right: 8, top: 8, bottom: 18 };

const MILESTONE_LABELS: Partial<Record<FlightEvent["type"], string>> = {
  maxq: "Max-Q",
  booster_sep: "Booster sep",
  stage_sep: "Stage sep",
  fairing_sep: "Fairing sep",
  engine_out: "Engine out",
  booster_fail: "Booster failure",
  stall: "Stage did not light",
  spin: "Lost control",
  payload_pop: "Payload released",
  burnout: "Burnout",
  explode: "Explosion",
  impact: "Impact",
  orbit: "Orbit",
};

/** Rounds an axis maximum up to a readable step. */
function niceMax(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, value)));
  return (
    [1, 2, 5, 10].map((m) => m * magnitude).find((v) => v >= value) ?? value
  );
}

/** Altitude-over-time line for the mission report, with staging milestones and a hover readout. */
export function TrajectoryPlot({
  samples,
  milestones,
}: {
  samples: FlightSample[];
  milestones: FlightEvent[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const geometry = useMemo(() => {
    const tMax = Math.max(1, samples[samples.length - 1]?.t ?? 1);
    const altMax = niceMax(
      Math.max(1, ...samples.map((s) => s.altitude / 1000)),
    );
    const x = (t: number) => PAD.left + (t / tMax) * (W - PAD.left - PAD.right);
    const y = (km: number) =>
      H - PAD.bottom - (km / altMax) * (H - PAD.top - PAD.bottom);
    const path = samples
      .map(
        (s, i) =>
          `${i ? "L" : "M"}${x(s.t).toFixed(1)},${y(s.altitude / 1000).toFixed(1)}`,
      )
      .join("");
    const marks = milestones
      .filter((m) => MILESTONE_LABELS[m.type] && m.t <= tMax)
      .map((m) => ({ ...m, x: x(m.t) }));
    return { tMax, altMax, x, y, path, marks };
  }, [samples, milestones]);

  if (samples.length < 2) return null;
  const { tMax, altMax, x, y, path, marks } = geometry;
  const sample = hover === null ? null : samples[hover];
  const nearby = sample
    ? marks.find((m) => Math.abs(m.t - sample.t) <= tMax * 0.02)
    : undefined;

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    const t = ((px - PAD.left) / (W - PAD.left - PAD.right)) * tMax;
    let best = 0;
    samples.forEach((s, i) => {
      if (Math.abs(s.t - t) < Math.abs(samples[best].t - t)) best = i;
    });
    setHover(best);
  };

  return (
    <figure className="px-6 pt-3">
      <figcaption className="label-xs mb-1 flex justify-between">
        <span>Altitude</span>
        <span className="text-faint">
          {sample
            ? `T+${Math.round(sample.t)}s · ${(sample.altitude / 1000).toFixed(1)} km · ${(sample.speed / 1000).toFixed(2)} km/s${nearby ? ` · ${MILESTONE_LABELS[nearby.type]}` : ""}`
            : "hover for readout"}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full touch-none"
        role="img"
        aria-label={`Altitude over time, peaking at ${altMax} km scale over ${Math.round(tMax)} seconds`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(altMax * f)}
              y2={y(altMax * f)}
              stroke="currentColor"
              className="text-white/10"
            />
            <text
              x={PAD.left - 5}
              y={y(altMax * f) + 3}
              textAnchor="end"
              className="fill-[var(--muted)] font-mono text-[9px]"
            >
              {Math.round(altMax * f).toLocaleString("en-US")}
            </text>
          </g>
        ))}
        <text
          x={W - PAD.right}
          y={H - 4}
          textAnchor="end"
          className="fill-[var(--muted)] font-mono text-[9px]"
        >
          {Math.round(tMax)} s
        </text>
        <text
          x={PAD.left}
          y={H - 4}
          className="fill-[var(--muted)] font-mono text-[9px]"
        >
          0 s · km
        </text>
        {marks.map((m, i) => (
          <line
            key={`${m.type}:${i}`}
            x1={m.x}
            x2={m.x}
            y1={PAD.top}
            y2={H - PAD.bottom}
            stroke="currentColor"
            strokeDasharray="2 3"
            className="text-white/25"
          />
        ))}
        <path
          d={path}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {sample && (
          <g>
            <line
              x1={x(sample.t)}
              x2={x(sample.t)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="currentColor"
              className="text-white/40"
            />
            <circle
              cx={x(sample.t)}
              cy={y(sample.altitude / 1000)}
              r={4}
              fill="var(--accent)"
              stroke="var(--bg)"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>
    </figure>
  );
}
