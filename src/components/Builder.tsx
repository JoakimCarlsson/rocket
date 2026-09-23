"use client";

import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LaunchCue, Telemetry } from "@/components/three/LaunchScene";
import { BrandRail, Wordmark } from "@/components/ui/BrandRail";
import { Icon } from "@/components/ui/Icon";
import { AchievementToasts, LaunchHUD, MissionReportCard, TransitionOverlay } from "@/components/ui/LaunchOverlays";
import { PromptDock } from "@/components/ui/PromptDock";
import { ShareDialog } from "@/components/ui/ShareDialog";
import { CompactStats, StatsPanel } from "@/components/ui/StatsPanel";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { loadMuted, loadSession, saveMuted, takeHandOff } from "@/lib/persistence";
import { useBuilder } from "@/lib/store";
import { sound } from "@/lib/sound";

const Viewport = dynamic(() => import("@/components/three/Viewport").then((m) => m.Viewport), { ssr: false });

const CUE_SOUNDS: Partial<Record<LaunchCue, Parameters<typeof sound.play>[0]>> = {
  "count:3": "beep",
  "count:2": "beep",
  "count:1": "beep",
  ignition: "ignition",
  liftoff: "liftoff",
  booster_sep: "separation",
  stage_sep: "separation",
  booster_fail: "separation",
  payload_pop: "separation",
  explode: "explosion",
};

/** The main construction-bay experience. */
export function Builder() {
  const state = useBuilder();
  const isMobile = useIsMobile();
  const [labels, setLabels] = useState(true);
  const [muted, setMuted] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [cue, setCue] = useState<{ value: LaunchCue; id: number } | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const telemetry = useRef<Telemetry>({ altitude: 0, speed: 0, t: -3 });
  const cueId = useRef(0);

  useEffect(() => {
    const incoming = takeHandOff();
    const saved = loadSession();
    if (incoming) {
      useBuilder.getState().hydrate(saved?.rocket ?? incoming.rocket, saved?.messages ?? []);
      useBuilder.getState().loadRocket(incoming.rocket, `Loaded ${incoming.rocket.name}${incoming.source ? ` from ${incoming.source}` : ""}. Tell me how to make it worse.`, incoming.prompt);
    } else if (saved) {
      useBuilder.getState().hydrate(saved.rocket, saved.messages);
    } else {
      useBuilder.getState().hydrate(useBuilder.getState().rocket, []);
    }
    const mutedPref = loadMuted();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMuted(mutedPref);
    sound.setMuted(mutedPref);
    void useBuilder.getState().detectProvider();
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isMobile) setLabels(false);
  }, [isMobile]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) useBuilder.getState().redo();
        else useBuilder.getState().undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onCue = useCallback((value: LaunchCue) => {
    const s = CUE_SOUNDS[value];
    if (s) sound.play(s);
    if (value !== "done") setCue({ value, id: ++cueId.current });
  }, []);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    sound.setMuted(next);
    saveMuted(next);
  };

  const remix = () => {
    state.backToBuild();
    setFocusSignal((n) => n + 1);
  };

  const inBuild = state.mode === "build";
  const lastAi = [...state.messages].reverse().find((m) => m.role === "ai")?.text ?? null;
  const firstTime = !state.messages.some((m) => m.role === "user");
  const scene = state.mode === "launch" || state.mode === "report" ? "launch" : "bay";

  return (
    <main className="fixed inset-0 overflow-hidden bg-bg">
      <Viewport
        rocket={state.rocket}
        scene={scene}
        plan={state.plan}
        attempt={state.attempt}
        labels={labels && inBuild}
        quality={isMobile ? "low" : "high"}
        telemetry={telemetry}
        onCue={onCue}
        onLaunchComplete={state.finishLaunch}
      />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.55))]" />

      <AnimatePresence>
        {inBuild && (
          <motion.div key="build-ui" className="pointer-events-none fixed inset-0 z-20" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {isMobile ? (
              <div className="flex h-full flex-col p-3 pt-[max(12px,env(safe-area-inset-top))] pb-[max(12px,env(safe-area-inset-bottom))]">
                <div className="pointer-events-auto flex items-center justify-between">
                  <Wordmark small />
                  <button onClick={() => setMenuOpen(true)} className="panel grid h-9 w-9 place-items-center rounded-lg text-muted" aria-label="Menu">
                    <Icon name="menu" size={16} />
                  </button>
                </div>
                <div className="mt-2">
                  <div className="truncate font-display text-[15px] font-bold">{state.rocket.name}</div>
                </div>
                <div className="mt-2">
                  <CompactStats rocket={state.rocket} />
                </div>
                <div className="flex-1" />
                <PromptDock
                  busy={state.busy}
                  firstTime={firstTime}
                  engineerLine={lastAi}
                  canUndo={state.past.length > 0}
                  compact
                  focusSignal={focusSignal}
                  onSubmit={state.submitPrompt}
                  onUndo={state.undo}
                  onRandomize={state.randomize}
                  onLaunch={state.launch}
                />
              </div>
            ) : (
              <>
                <div className="absolute top-6 bottom-6 left-6">
                  <BrandRail
                    name={state.rocket.name}
                    messages={state.messages}
                    canUndo={state.past.length > 0}
                    canRedo={state.future.length > 0}
                    muted={muted}
                    labels={labels}
                    onUndo={state.undo}
                    onRedo={state.redo}
                    onReset={state.reset}
                    onRandomize={state.randomize}
                    onShare={() => setSharing(true)}
                    onToggleMute={toggleMute}
                    onToggleLabels={() => setLabels((l) => !l)}
                  />
                </div>
                <div className="absolute top-6 right-6">
                  <StatsPanel rocket={state.rocket} provider={state.providerLabel} />
                </div>
                <div className="absolute right-[296px] bottom-6 left-[296px]">
                  <PromptDock
                    busy={state.busy}
                    firstTime={firstTime}
                    engineerLine={lastAi}
                    canUndo={state.past.length > 0}
                    compact={false}
                    focusSignal={focusSignal}
                    onSubmit={state.submitPrompt}
                    onUndo={state.undo}
                    onRandomize={state.randomize}
                    onLaunch={state.launch}
                  />
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {state.mode === "transition" && <TransitionOverlay name={state.rocket.name} onDone={state.beginFlight} />}
      {state.mode === "launch" && state.plan && <LaunchHUD cue={cue} telemetry={telemetry} plan={state.plan} onSkip={state.finishLaunch} />}
      {state.mode === "report" && state.plan && (
        <MissionReportCard
          plan={state.plan}
          name={state.rocket.name}
          busy={state.busy}
          onRemix={remix}
          onRepair={state.repair}
          onAgain={state.launch}
          onNew={() => {
            state.backToBuild();
            state.randomize();
          }}
          onShare={() => setSharing(true)}
        />
      )}

      <AchievementToasts ids={state.toasts} onDismiss={state.dismissToast} />
      {sharing && <ShareDialog rocket={state.rocket} prompt={state.lastPrompt} attempt={state.mode === "report" ? state.attempt : null} onClose={() => setSharing(false)} />}

      <AnimatePresence>
        {menuOpen && isMobile && (
          <motion.div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMenuOpen(false)}>
            <motion.div initial={{ x: -40 }} animate={{ x: 0 }} exit={{ x: -40 }} onClick={(e) => e.stopPropagation()} className="panel absolute top-0 bottom-0 left-0 w-[280px] p-5 pt-[max(20px,env(safe-area-inset-top))]">
              <BrandRail
                name={state.rocket.name}
                messages={state.messages}
                canUndo={state.past.length > 0}
                canRedo={state.future.length > 0}
                muted={muted}
                labels={labels}
                onUndo={state.undo}
                onRedo={state.redo}
                onReset={state.reset}
                onRandomize={state.randomize}
                onShare={() => {
                  setMenuOpen(false);
                  setSharing(true);
                }}
                onToggleMute={toggleMute}
                onToggleLabels={() => setLabels((l) => !l)}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
