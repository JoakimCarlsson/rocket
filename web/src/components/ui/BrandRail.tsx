"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import type { Message } from "@/lib/store";
import { AccountRailButton } from "./AccountButton";
import { Icon, type IconName } from "./Icon";

/** A compact labelled control button. */
export function RailButton({
  icon,
  label,
  onClick,
  disabled,
  active,
  href,
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  href?: string;
}) {
  const className = `group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left font-mono text-[10.5px] tracking-[0.14em] transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
    active ? "text-text" : "text-muted hover:bg-white/[0.04] hover:text-text"
  }`;
  const content = (
    <>
      <Icon
        name={icon}
        size={14}
        className={
          active
            ? "text-accent"
            : "text-faint transition-colors group-hover:text-accent"
        }
      />
      {label}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <button onClick={onClick} disabled={disabled} className={className}>
      {content}
    </button>
  );
}

/** Wordmark used across pages. */
export function Wordmark({ small = false }: { small?: boolean }) {
  return (
    <Link href="/" className="group inline-flex items-center gap-2">
      <span
        className={`relative grid place-items-center rounded-md bg-accent text-black ${small ? "h-5 w-5" : "h-6 w-6"}`}
      >
        <Icon name="rocket" size={small ? 12 : 14} />
      </span>
      <span
        className={`font-display font-extrabold tracking-tight ${small ? "text-[13px]" : "text-[15px]"}`}
      >
        ROCKET<span className="text-accent">.</span>JDADDY
      </span>
    </Link>
  );
}

/** Props for the left rail. */
export interface BrandRailProps {
  name: string;
  messages: Message[];
  canUndo: boolean;
  canRedo: boolean;
  muted: boolean;
  labels: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  onRandomize: () => void;
  onShare: () => void;
  onToggleMute: () => void;
  onToggleLabels: () => void;
}

/** Left rail: branding, rocket name, secondary controls and prompt history. */
export function BrandRail(props: BrandRailProps) {
  const history = useRef<HTMLDivElement>(null);
  useEffect(() => {
    history.current?.scrollTo({
      top: history.current.scrollHeight,
      behavior: "smooth",
    });
  }, [props.messages.length]);
  return (
    <aside className="pointer-events-auto flex h-full w-[232px] flex-col gap-5">
      <div>
        <Wordmark />
        <div className="label-xs mt-2 text-faint">
          Construction bay 04 · experimental
        </div>
      </div>

      <div>
        <div className="label-xs">Vehicle</div>
        <AnimatePresence mode="wait">
          <motion.h1
            key={props.name}
            initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
            transition={{ duration: 0.4 }}
            className="mt-1 font-display text-[22px] leading-[1.05] font-bold tracking-tight"
          >
            {props.name}
          </motion.h1>
        </AnimatePresence>
      </div>

      <nav className="panel -mx-1 rounded-xl p-1">
        <RailButton
          icon="undo"
          label="UNDO"
          onClick={props.onUndo}
          disabled={!props.canUndo}
        />
        <RailButton
          icon="redo"
          label="REDO"
          onClick={props.onRedo}
          disabled={!props.canRedo}
        />
        <RailButton icon="dice" label="RANDOMIZE" onClick={props.onRandomize} />
        <RailButton icon="reset" label="RESET" onClick={props.onReset} />
        <div className="my-1 h-px bg-line" />
        <RailButton icon="share" label="SHARE" onClick={props.onShare} />
        <RailButton icon="explore" label="EXPLORE ROCKETS" href="/explore" />
        <div className="my-1 h-px bg-line" />
        <RailButton
          icon="tag"
          label={props.labels ? "LABELS ON" : "LABELS OFF"}
          onClick={props.onToggleLabels}
          active={props.labels}
        />
        <RailButton
          icon={props.muted ? "mute" : "sound"}
          label={props.muted ? "SOUND OFF" : "SOUND ON"}
          onClick={props.onToggleMute}
          active={!props.muted}
        />
        <div className="my-1 h-px bg-line" />
        <AccountRailButton />
      </nav>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="label-xs mb-2">Prompt log</div>
        <div
          ref={history}
          className="scrollbar-none min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 [mask-image:linear-gradient(to_bottom,transparent,black_24px)]"
        >
          {props.messages.length === 0 && (
            <p className="pt-6 font-mono text-[10.5px] leading-relaxed text-faint">
              No changes yet. The engineer is waiting, impatiently.
            </p>
          )}
          {props.messages.slice(-24).map((m) => (
            <div
              key={m.id}
              className={`text-[11.5px] leading-snug ${m.role === "user" ? "text-text" : "font-mono text-[10.5px] text-muted"}`}
            >
              <span
                className={`mr-1.5 font-mono text-[9px] tracking-[0.14em] ${m.role === "user" ? "text-accent" : "text-faint"}`}
              >
                {m.role === "user" ? "YOU" : "ENG"}
              </span>
              {m.text}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
