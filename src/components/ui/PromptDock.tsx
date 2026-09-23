"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

const FIRST_SUGGESTIONS = ["Build a Mars rocket", "Add way too many boosters", "Make the cheapest rocket possible", "Make it enormous", "Surprise me"];
const FOLLOW_UPS = [
  "Make it twice as stupid",
  "Put a glass observation dome on top",
  "Give it stupidly powerful engines",
  "Paint it black and gold",
  "Add googly eyes",
  "Make it sideways",
  "Add six boosters",
  "Make the bottom wider",
  "Add a rubber duck",
  "Checkered racing stripes",
  "Make it look completely ridiculous",
];

/** Types out the engineer's latest line. */
function Typewriter({ text }: { text: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCount(0);
    const timer = setInterval(() => setCount((c) => (c >= text.length ? c : c + 2)), 16);
    return () => clearInterval(timer);
  }, [text]);
  return (
    <>
      {text.slice(0, count)}
      {count < text.length && <span className="caret">▍</span>}
    </>
  );
}

/** Props for the prompt dock. */
export interface PromptDockProps {
  busy: boolean;
  firstTime: boolean;
  engineerLine: string | null;
  canUndo: boolean;
  compact: boolean;
  focusSignal: number;
  onSubmit: (text: string) => void;
  onUndo: () => void;
  onRandomize: () => void;
  onLaunch: () => void;
}

/** Bottom-centre prompt: the main way to build. */
export function PromptDock({ busy, firstTime, engineerLine, canUndo, compact, focusSignal, onSubmit, onUndo, onRandomize, onLaunch }: PromptDockProps) {
  const [value, setValue] = useState("");
  const [followUps, setFollowUps] = useState<string[]>(() => FOLLOW_UPS.slice(0, 4));
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusSignal) input.current?.focus();
  }, [focusSignal]);

  useEffect(() => {
    if (!busy) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFollowUps([...FOLLOW_UPS].sort(() => Math.random() - 0.5).slice(0, compact ? 3 : 4));
    }
  }, [busy, compact, engineerLine]);

  const submit = (text = value) => {
    if (!text.trim() || busy) return;
    onSubmit(text);
    setValue("");
  };
  const suggestions = firstTime ? FIRST_SUGGESTIONS : followUps;

  return (
    <div className="pointer-events-auto mx-auto w-full max-w-[760px]">
      <AnimatePresence mode="wait">
        {(busy || engineerLine) && (
          <motion.div
            key={busy ? "busy" : engineerLine}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="mb-3 flex items-start gap-2.5 px-1"
          >
            <span className="mt-[3px] grid h-5 w-5 shrink-0 place-items-center rounded-full border border-accent/50 bg-accent/10">
              <span className={`h-1.5 w-1.5 rounded-full bg-accent ${busy ? "animate-ping" : ""}`} />
            </span>
            <p className="font-mono text-[12.5px] leading-relaxed text-text/90 [text-shadow:0_1px_12px_rgba(0,0,0,0.9)]">
              {busy ? <span className="text-muted">Engineer is thinking<span className="caret">…</span></span> : <Typewriter text={engineerLine!} />}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {firstTime && !busy && (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} className="mb-2 px-1 font-display text-[15px] font-medium tracking-tight text-text/90">
          Describe your rocket.
        </motion.p>
      )}

      <div className="scrollbar-none mb-2.5 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
        {suggestions.map((s, i) => (
          <motion.button
            key={s}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i + (firstTime ? 0.8 : 0) }}
            onClick={() => submit(s)}
            disabled={busy}
            className="shrink-0 rounded-full border border-line-strong bg-black/40 px-3 py-1 text-[12px] whitespace-nowrap text-text/80 backdrop-blur transition-colors hover:border-accent/70 hover:text-text disabled:opacity-40"
          >
            {s}
          </motion.button>
        ))}
      </div>

      <div className="panel flex items-end gap-2 rounded-2xl p-2 shadow-[0_20px_80px_-20px_rgba(0,0,0,0.9)] focus-within:border-line-strong">
        <textarea
          ref={input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          maxLength={500}
          placeholder="Tell the AI what to change…"
          className="max-h-32 min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-[15px] leading-snug text-text outline-none placeholder:text-faint"
        />
        <button
          onClick={() => submit()}
          disabled={busy || !value.trim()}
          className="flex h-11 items-center gap-2 rounded-xl bg-text px-4 font-mono text-[11px] font-medium tracking-[0.16em] text-black transition hover:bg-white disabled:bg-white/10 disabled:text-faint"
        >
          {firstTime ? "GENERATE" : "MODIFY"}
          <Icon name="send" size={14} />
        </button>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <button onClick={onUndo} disabled={!canUndo || busy} className="flex h-12 items-center gap-2 rounded-xl border border-line px-3.5 font-mono text-[10.5px] tracking-[0.16em] text-muted transition hover:border-line-strong hover:text-text disabled:opacity-30">
          <Icon name="undo" size={14} />
          {!compact && "UNDO"}
        </button>
        <button onClick={onRandomize} disabled={busy} className="flex h-12 items-center gap-2 rounded-xl border border-line px-3.5 font-mono text-[10.5px] tracking-[0.16em] text-muted transition hover:border-line-strong hover:text-text disabled:opacity-30">
          <Icon name="dice" size={14} />
          {!compact && "RANDOMIZE"}
        </button>
        <motion.button
          whileHover={{ scale: 1.015 }}
          whileTap={{ scale: 0.97 }}
          onClick={onLaunch}
          disabled={busy}
          className="relative ml-auto flex h-12 flex-1 items-center justify-center gap-3 overflow-hidden rounded-xl bg-accent font-display text-[15px] font-extrabold tracking-[0.12em] text-black shadow-[0_0_40px_-6px_rgba(255,91,31,0.7)] transition disabled:opacity-50 sm:max-w-[260px]"
        >
          <span className="absolute inset-0 bg-[linear-gradient(110deg,transparent_30%,rgba(255,255,255,0.45)_50%,transparent_70%)] bg-[length:250%_100%] [animation:shine_3.2s_ease-in-out_infinite]" />
          <Icon name="rocket" size={18} />
          LAUNCH
        </motion.button>
      </div>
    </div>
  );
}
