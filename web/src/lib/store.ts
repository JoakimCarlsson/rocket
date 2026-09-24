"use client";

import { create } from "zustand";
import { configAchievements, launchAchievements } from "./achievements";
import type { AIResult } from "./ai/actions";
import { getAIProvider, OFFLINE_LABEL } from "./ai/client";
import { generateName } from "./ai/names";
import type { HistoryEntry } from "./ai/provider";
import { ProviderUnavailableError } from "./ai/remote-provider";
import { loadAchievements, saveAchievements, saveSession } from "./persistence";
import {
  analyzeRocket,
  type DesignProblem,
  launchRocket,
  tuneRocket,
} from "./physics/api";
import { applyActions } from "./rocket/apply";
import {
  createRandomRocket,
  createStarterRocket,
  DEFAULT_NAME,
} from "./rocket/defaults";
import { createRng, newSeed } from "./rocket/random";
import type { RocketConfig } from "./rocket/types";
import { type LaunchPlan, toLaunchPlan } from "./sim/playback";
import { sound } from "./sound";

/** Which screen the builder is showing. */
export type Mode = "build" | "transition" | "launch" | "report";

/** One line in the prompt history. */
export interface Message {
  id: number;
  role: "user" | "ai";
  text: string;
}

interface Snapshot {
  rocket: RocketConfig;
  label: string;
}

/** Builder state and every user-facing action. */
export interface BuilderState {
  rocket: RocketConfig;
  past: Snapshot[];
  future: Snapshot[];
  messages: Message[];
  busy: boolean;
  mode: Mode;
  attempt: number;
  plan: LaunchPlan | null;
  flightReady: boolean;
  lastPrompt: string;
  providerLabel: string;
  unlocked: string[];
  toasts: string[];
  changeTick: number;

  submitPrompt: (text: string) => Promise<void>;
  repair: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  reset: () => void;
  randomize: () => Promise<void>;
  loadRocket: (rocket: RocketConfig, note: string, prompt?: string) => void;
  hydrate: (
    rocket: RocketConfig,
    messages: { role: "user" | "ai"; text: string }[],
  ) => void;
  launch: () => Promise<void>;
  beginFlight: () => void;
  finishLaunch: () => void;
  backToBuild: () => void;
  dismissToast: (id: string) => void;
  detectProvider: () => Promise<void>;
}

let messageId = 0;
const HISTORY_LIMIT = 60;

/** Builds a message with a unique id. */
function message(role: Message["role"], text: string): Message {
  return { id: ++messageId, role, text };
}

/** Turns chat messages into AI context pairs. */
function historyFrom(messages: Message[]): HistoryEntry[] {
  const pairs: HistoryEntry[] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    if (messages[i].role === "user" && messages[i + 1].role === "ai")
      pairs.push({ prompt: messages[i].text, response: messages[i + 1].text });
  }
  return pairs.slice(-6);
}

/** Global builder store. */
export const useBuilder = create<BuilderState>((set, get) => {
  /** Records a new rocket version with undo history and achievement checks. */
  const commit = (
    rocket: RocketConfig,
    label: string,
    extra: Partial<BuilderState> = {},
  ) => {
    const state = get();
    const past = [...state.past, { rocket: state.rocket, label }].slice(
      -HISTORY_LIMIT,
    );
    set({
      rocket,
      past,
      future: [],
      changeTick: state.changeTick + 1,
      ...extra,
    });
    analyzeRocket(rocket)
      .then((analysis) => unlock(configAchievements(rocket, analysis.stats)))
      .catch(() => {});
    persist();
  };

  /** The rocket's current design problems, or none when the server is unreachable. */
  const problemsOf = async (rocket: RocketConfig): Promise<DesignProblem[]> =>
    (await analyzeRocket(rocket).catch(() => null))?.problems ?? [];

  /** Unlocks achievements and queues toasts for new ones. */
  const unlock = (ids: string[]) => {
    const state = get();
    const fresh = ids.filter((id) => !state.unlocked.includes(id));
    if (!fresh.length) return;
    const unlocked = [...state.unlocked, ...fresh];
    saveAchievements(unlocked);
    set({ unlocked, toasts: [...state.toasts, ...fresh] });
    sound.play("achievement");
  };

  /** Saves the session so a refresh keeps the rocket. */
  const persist = () => {
    const { rocket, messages } = get();
    saveSession({
      rocket,
      messages: messages.map(({ role, text }) => ({ role, text })),
    });
  };

  /** Applies an AI result to the current rocket. */
  const applyResult = (result: AIResult, prompt: string) => {
    const state = get();
    const { config, notes } = applyActions(state.rocket, result.actions);
    if (result.suggestedName && config.name === DEFAULT_NAME)
      config.name = result.suggestedName;
    const response =
      result.response ||
      (result.actions.length
        ? "Done."
        : "I couldn't turn that into a change. Try another description.");
    const skipped = result.rejected
      ? [
          `(${result.rejected} requested change${result.rejected > 1 ? "s were" : " was"} invalid and not applied.)`,
        ]
      : [];
    const reply = [
      response,
      ...notes.filter((n) => !response.includes(n)),
      ...skipped,
    ].join(" ");
    const messages = [...state.messages, message("ai", reply)];
    if (result.actions.length || config.name !== state.rocket.name) {
      commit(config, prompt, {
        messages,
        busy: false,
        lastPrompt: prompt,
        providerLabel: result.provider,
      });
      sound.play("whoosh");
    } else {
      set({ messages, busy: false, providerLabel: result.provider });
      persist();
    }
  };

  /**
   * Gives the engineer one follow-up turn when its change left the rocket with new
   * physical problems, such as too little thrust or delta-v for the destination.
   */
  const selfCheck = async (before: DesignProblem[], prompt: string) => {
    const problems = (await problemsOf(get().rocket)).filter(
      (p) => !before.some((b) => b.key === p.key),
    );
    if (!problems.length) return;
    const state = get();
    set({ busy: true });
    try {
      const result = await getAIProvider().interpret({
        instruction: `Self-check after the player's request "${prompt}": the rocket now has these problems: ${problems.map((p) => p.text).join("; ")}. Fix them while keeping what the player asked for. If the player clearly asked for exactly this, return no actions and say so.`,
        rocket: state.rocket,
        history: historyFrom(state.messages),
        mode: "repair",
      });
      if (result.actions.length) applyResult(result, "Engineer self-check");
      else set({ busy: false });
    } catch {
      set({ busy: false });
    }
  };

  /** Ends a failed engineer turn with a message saying why. */
  const fail = (error: unknown) => {
    const offline = error instanceof ProviderUnavailableError;
    set({
      busy: false,
      providerLabel: offline ? getAIProvider().label : get().providerLabel,
      messages: [
        ...get().messages,
        message(
          "ai",
          offline
            ? "No AI engineer is connected. The control room is empty."
            : "Something shorted out in the control room. Try again.",
        ),
      ],
    });
  };

  return {
    rocket: createStarterRocket(),
    past: [],
    future: [],
    messages: [],
    busy: false,
    mode: "build",
    attempt: 0,
    plan: null,
    flightReady: false,
    lastPrompt: "",
    providerLabel: OFFLINE_LABEL,
    unlocked: [],
    toasts: [],
    changeTick: 0,

    async submitPrompt(text) {
      const prompt = text.trim().slice(0, 500);
      if (!prompt || get().busy) return;
      const state = get();
      set({
        busy: true,
        messages: [...state.messages, message("user", prompt)],
      });
      sound.play("click");
      try {
        const [result, before] = await Promise.all([
          getAIProvider().interpret({
            instruction: prompt,
            rocket: state.rocket,
            history: historyFrom(state.messages),
            mode: "modify",
          }),
          problemsOf(state.rocket),
        ]);
        applyResult(result, prompt);
        await selfCheck(before, prompt);
      } catch (error) {
        fail(error);
      }
    },

    async repair() {
      const state = get();
      if (state.busy || !state.plan) return;
      const { mission } = state.plan;
      const prompt = "Ask AI to fix it.";
      set({
        busy: true,
        mode: "build",
        messages: [...state.messages, message("user", prompt)],
      });
      try {
        const result = await getAIProvider().interpret({
          instruction: `Repair the rocket after this fictional mission: ${mission.headline}. Problems: ${mission.problems.join(", ") || "none obvious"}.`,
          rocket: state.rocket,
          history: historyFrom(state.messages),
          mode: "repair",
          mission,
        });
        applyResult(result, prompt);
        await selfCheck([], mission.headline);
      } catch (error) {
        fail(error);
      }
    },

    undo() {
      const { past, future, rocket, changeTick } = get();
      const previous = past[past.length - 1];
      if (!previous) return;
      set({
        rocket: previous.rocket,
        past: past.slice(0, -1),
        future: [{ rocket, label: previous.label }, ...future],
        changeTick: changeTick + 1,
      });
      sound.play("click");
      persist();
    },

    redo() {
      const { past, future, rocket, changeTick } = get();
      const next = future[0];
      if (!next) return;
      set({
        rocket: next.rocket,
        future: future.slice(1),
        past: [...past, { rocket, label: next.label }],
        changeTick: changeTick + 1,
      });
      sound.play("click");
      persist();
    },

    reset() {
      commit(createStarterRocket(), "reset", {
        messages: [
          ...get().messages,
          message(
            "ai",
            "Back to the starter rocket. Clean slate, clean conscience.",
          ),
        ],
        lastPrompt: "",
      });
      sound.play("whoosh");
    },

    async randomize() {
      const seed = newSeed();
      const random = createRandomRocket(seed);
      random.name = generateName(random, createRng(seed));
      const rocket = await tuneRocket(random).catch(() => random);
      commit(rocket, "randomize", {
        messages: [
          ...get().messages,
          message("ai", "Randomised. I take no responsibility for this one."),
        ],
        lastPrompt: "Randomize",
      });
      sound.play("whoosh");
    },

    loadRocket(rocket, note, prompt = "") {
      commit(rocket, "load", {
        messages: [...get().messages, message("ai", note)],
        lastPrompt: prompt,
        mode: "build",
        plan: null,
      });
    },

    hydrate(rocket, messages) {
      set({
        rocket,
        messages: messages.map((m) => message(m.role, m.text)),
        unlocked: loadAchievements(),
      });
    },

    async launch() {
      const state = get();
      if (state.busy || (state.mode !== "build" && state.mode !== "report"))
        return;
      const attempt = state.attempt + 1;
      set({ mode: "transition", attempt, plan: null, flightReady: false });
      sound.play("whoosh");
      try {
        const plan = toLaunchPlan(await launchRocket(state.rocket, attempt));
        if (get().mode !== "transition") return;
        set({ plan });
        if (get().flightReady) set({ mode: "launch" });
      } catch {
        set({
          mode: "build",
          messages: [
            ...get().messages,
            message(
              "ai",
              "Launch control lost contact with the pad. Try again.",
            ),
          ],
        });
      }
    },

    beginFlight() {
      const { mode, plan } = get();
      if (mode !== "transition") return;
      if (plan) set({ mode: "launch" });
      else set({ flightReady: true });
    },

    finishLaunch() {
      const { plan, rocket } = get();
      if (!plan) return;
      set({ mode: "report" });
      sound.play(plan.report.grade === "failure" ? "fail" : "success");
      unlock(launchAchievements(plan, rocket));
    },

    backToBuild() {
      set({ mode: "build" });
      sound.stopRumble();
    },

    dismissToast(id) {
      set({ toasts: get().toasts.filter((t) => t !== id) });
    },

    async detectProvider() {
      const provider = getAIProvider();
      await provider.detect();
      set({ providerLabel: provider.label });
    },
  };
});
