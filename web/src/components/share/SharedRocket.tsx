"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { OutcomeBadge } from "@/components/explore/OutcomeBadge";
import { Wordmark } from "@/components/ui/BrandRail";
import { Icon } from "@/components/ui/Icon";
import { get2DContext } from "@/lib/canvas";
import { NO_RESTORE } from "@/lib/dom";
import { STAT_META } from "@/lib/format";
import { handOff } from "@/lib/persistence";
import { computeStats } from "@/lib/rocket/stats";
import { type SharePayload, sharePath, shareUrl } from "@/lib/share";
import { simulateLaunch } from "@/lib/sim/simulate";

const ShowcaseViewport = dynamic(
  () =>
    import("@/components/three/ShowcaseViewport").then(
      (m) => m.ShowcaseViewport,
    ),
  { ssr: false },
);

/** Public page for one shared rocket, with an optional share-card rendering mode. */
export function SharedRocket({
  id,
  payload,
  card,
}: {
  id: string;
  payload: SharePayload;
  card: boolean;
}) {
  const router = useRouter();
  const { rocket } = payload;
  const stats = useMemo(() => computeStats(rocket), [rocket]);
  const plan = useMemo(
    () => simulateLaunch(rocket, payload.attempt ?? 1),
    [rocket, payload.attempt],
  );
  const [copied, setCopied] = useState(false);

  const remix = () => {
    handOff({ rocket, prompt: payload.prompt, source: payload.creator });
    router.push("/");
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl(id));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  if (card)
    return (
      <ShareCard
        payload={payload}
        stats={stats}
        headline={plan.report.headline}
      />
    );

  return (
    <main className="min-h-screen bg-bg lg:grid lg:h-screen lg:grid-cols-[1fr_420px] lg:overflow-hidden">
      <div className="relative h-[62vh] lg:h-full">
        <ShowcaseViewport rocket={rocket} className="!absolute inset-0" />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-4 sm:p-6">
          <div className="pointer-events-auto">
            <Wordmark />
          </div>
          <Link
            href="/explore"
            className="pointer-events-auto label-xs hover:text-text"
          >
            Explore →
          </Link>
        </div>
      </div>
      <aside className="flex flex-col gap-6 border-l border-line bg-panel-solid p-6 lg:overflow-y-auto">
        <div>
          <div className="label-xs">Shared vehicle · {payload.creator}</div>
          <h1 className="mt-2 font-display text-[32px] leading-[1.02] font-extrabold tracking-tight">
            {rocket.name}
          </h1>
          {payload.prompt && (
            <p className="mt-3 font-mono text-[12px] leading-relaxed text-text/70">
              “{payload.prompt}”
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-line p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="label-xs">Launch outcome</span>
            <OutcomeBadge plan={plan} />
          </div>
          <dl className="space-y-1.5">
            {plan.report.rows.map((row) => (
              <div
                key={row.label}
                className="flex justify-between gap-4 text-[13px]"
              >
                <dt className="label-xs">{row.label}</dt>
                <dd className="text-right">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {STAT_META.map((meta) => (
            <div key={meta.key}>
              <div className="label-xs">{meta.label}</div>
              <div className="font-mono text-[15px]">
                {meta.format(stats[meta.key])}
                <span className="ml-1 text-[10px] text-faint">{meta.unit}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="label-xs text-faint">
          Simplified flight physics. Game values, not engineering.
        </p>

        <div className="mt-auto grid gap-2">
          <button
            onClick={remix}
            className="flex h-12 items-center justify-center gap-2 rounded-xl bg-accent font-display text-[14px] font-extrabold tracking-[0.1em] text-black"
          >
            <Icon name="remix" size={16} /> REMIX THIS ROCKET
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={copy}
              className="flex h-11 items-center justify-center gap-2 rounded-xl border border-line font-mono text-[10.5px] tracking-[0.14em] text-muted hover:text-text"
            >
              <Icon name="copy" size={14} /> {copied ? "COPIED" : "COPY LINK"}
            </button>
            <Link
              href={sharePath(id, true)}
              className="flex h-11 items-center justify-center gap-2 rounded-xl border border-line font-mono text-[10.5px] tracking-[0.14em] text-muted hover:text-text"
            >
              <Icon name="download" size={14} /> SHARE CARD
            </Link>
          </div>
        </div>
      </aside>
    </main>
  );
}

const CARD_W = 1200;
const CARD_H = 630;

/** 1200×630 share card: live render on the left, typography on the right, exportable as PNG. */
function ShareCard({
  payload,
  stats,
  headline,
}: {
  payload: SharePayload;
  stats: ReturnType<typeof computeStats>;
  headline: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    const source = frame.current?.querySelector("canvas");
    if (!source) return;
    const out = document.createElement("canvas");
    out.width = CARD_W * 2;
    out.height = CARD_H * 2;
    const g = get2DContext(out);
    setBusy(true);
    await document.fonts.ready;
    g.scale(2, 2);
    g.fillStyle = "#06070a";
    g.fillRect(0, 0, CARD_W, CARD_H);
    g.drawImage(source, 0, 0, 600, CARD_H);
    const display =
      getComputedStyle(document.body).getPropertyValue("--font-display") ||
      "sans-serif";
    const mono =
      getComputedStyle(document.body).getPropertyValue("--font-mono") ||
      "monospace";
    g.fillStyle = "#ff5b1f";
    g.font = `800 20px ${display}`;
    g.fillText("ROCKET.JDADDY", 648, 70);
    g.fillStyle = "#858a94";
    g.font = `500 13px ${mono}`;
    g.fillText(
      `${payload.creator.toUpperCase()} · FICTIONAL VEHICLE`,
      648,
      100,
    );
    g.fillStyle = "#ecebe7";
    g.font = `800 50px ${display}`;
    wrap(g, payload.rocket.name, 648, 175, 510, 56);
    g.fillStyle = "#ffb070";
    g.font = `700 20px ${display}`;
    g.fillText(headline, 648, 330);
    g.font = `500 14px ${mono}`;
    STAT_META.slice(0, 8).forEach((meta, i) => {
      const x = 648 + (i % 2) * 260;
      const y = 390 + Math.floor(i / 2) * 50;
      g.fillStyle = "#858a94";
      g.fillText(meta.label, x, y);
      g.fillStyle = "#ecebe7";
      g.fillText(`${meta.format(stats[meta.key])} ${meta.unit}`, x, y + 20);
    });
    const link = document.createElement("a");
    link.download = `${payload.rocket.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
    link.href = out.toDataURL("image/png");
    link.click();
    setBusy(false);
  };

  return (
    <main className="grid min-h-screen place-items-center gap-6 bg-black p-6">
      <div
        className="origin-top scale-[0.3] sm:scale-[0.6] lg:scale-100"
        style={{ width: CARD_W, height: CARD_H }}
      >
        <div className="flex h-full w-full overflow-hidden rounded-3xl border border-line bg-bg">
          <div ref={frame} className="relative h-full w-[600px]">
            <ShowcaseViewport
              rocket={payload.rocket}
              capture
              className="!absolute inset-0"
            />
          </div>
          <div className="flex flex-1 flex-col p-12">
            <div className="font-display text-[20px] font-extrabold text-accent">
              ROCKET.JDADDY
            </div>
            <div className="label-xs mt-2">
              {payload.creator} · fictional vehicle
            </div>
            <h1 className="mt-8 font-display text-[50px] leading-[1.05] font-extrabold tracking-tight">
              {payload.rocket.name}
            </h1>
            <div className="mt-6 font-display text-[20px] font-bold text-accent-soft">
              {headline}
            </div>
            <div className="mt-auto grid grid-cols-2 gap-x-8 gap-y-4">
              {STAT_META.map((meta) => (
                <div key={meta.key}>
                  <div className="label-xs">{meta.label}</div>
                  <div className="font-mono text-[15px]">
                    {meta.format(stats[meta.key])}{" "}
                    <span className="text-faint">{meta.unit}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <button
        onClick={download}
        disabled={busy}
        {...NO_RESTORE}
        className="flex h-12 items-center gap-2 rounded-xl bg-accent px-6 font-display text-[13px] font-bold tracking-[0.1em] text-black disabled:opacity-50"
      >
        <Icon name="download" size={16} /> DOWNLOAD PNG
      </button>
    </main>
  );
}

/** Draws text wrapped to a width on a 2D canvas. */
function wrap(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  lineHeight: number,
): void {
  const words = text.split(" ");
  let line = "";
  let row = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (g.measureText(test).width > width && line) {
      g.fillText(line, x, y + row * lineHeight);
      line = word;
      row++;
    } else {
      line = test;
    }
  }
  g.fillText(line, x, y + row * lineHeight);
}
