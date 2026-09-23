"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { encodeShare, shareUrl } from "@/lib/share";
import type { RocketConfig } from "@/lib/rocket/types";
import { Icon } from "./Icon";

/** Modal with a copyable deterministic share link. */
export function ShareDialog({ rocket, prompt, attempt, onClose }: { rocket: RocketConfig; prompt: string; attempt: number | null; onClose: () => void }) {
  const id = useMemo(() => encodeShare({ rocket, prompt, creator: "@you", attempt }), [rocket, prompt, attempt]);
  const url = shareUrl(id);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  const nativeShare = async () => {
    try {
      await navigator.share({ title: rocket.name, text: `I built ${rocket.name} on ROCKET.AI`, url });
    } catch {
      /* dismissed */
    }
  };
  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose}>
      <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} onClick={(e) => e.stopPropagation()} className="panel w-full max-w-[480px] rounded-3xl p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="label-xs">Share vehicle</div>
            <h3 className="mt-1 font-display text-xl font-bold">{rocket.name}</h3>
          </div>
          <button onClick={onClose} className="text-muted hover:text-text" aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
        <p className="mt-3 text-[13px] text-muted">The link contains the whole rocket, so anyone can open it, launch it and remix it. No account needed.</p>
        <div className="mt-4 flex gap-2">
          <input readOnly value={url} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 rounded-xl border border-line bg-black/40 px-3 py-2.5 font-mono text-[11px] text-muted outline-none" />
          <button onClick={copy} className="flex items-center gap-2 rounded-xl bg-text px-4 font-mono text-[11px] tracking-[0.14em] text-black">
            <Icon name="copy" size={14} />
            {copied ? "COPIED" : "COPY"}
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link href={`/r/${id}`} target="_blank" className="flex h-11 items-center justify-center gap-2 rounded-xl border border-line font-mono text-[10.5px] tracking-[0.14em] text-muted hover:text-text">
            OPEN SHARE PAGE
          </Link>
          <Link href={`/r/${id}?card=1`} target="_blank" className="flex h-11 items-center justify-center gap-2 rounded-xl border border-line font-mono text-[10.5px] tracking-[0.14em] text-muted hover:text-text">
            <Icon name="download" size={14} /> SHARE CARD
          </Link>
          {typeof navigator !== "undefined" && "share" in navigator && (
            <button onClick={nativeShare} className="col-span-2 flex h-11 items-center justify-center gap-2 rounded-xl border border-line font-mono text-[10.5px] tracking-[0.14em] text-muted hover:text-text">
              <Icon name="share" size={14} /> SHARE VIA…
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
