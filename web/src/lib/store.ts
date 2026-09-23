"use client";

import { create } from "zustand";
import { configAchievements, launchAchievements } from "./achievements";
import type { AIResult } from "./ai/actions";
import { getAIProvider, OFFLINE_LABEL } from "./ai/client";
import { generateName } from "./ai/names";
import type { HistoryEntry } from "./ai/provider";
import { ProviderUnavailableError } from "./ai/remote-provider";
import { loadAchievements, saveAchievements, saveSession } from "./persistence";
import { applyActions } from "./rocket/apply";
import {
  createRandomRocket,
  createStarterRocket,
  DEFAULT_NAME,
} from "./rocket/defaults";
import { createRng, newSeed } from "./rocket/random";
import type { RocketConfig } from "./rocket/types";
import {
  type LaunchPlan,
  simulateLaunch,
  summarizeMission,
} from "./sim/simulate";
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
  randomize: () => void;
  loadRocket: (rocket: RocketConfig, note: string, prompt?: string) => void;
  hydrate: (
    rocket: RocketConfig,
    messages: { role: "user" | "ai"; text: string }[],
  ) => void;
  launch: () => void;
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
    unlock(configAchievements(rocket));
    persist();
  };

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
    const reply = [
      response,
      ...notes.filter((n) => !response.includes(n)),
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
        const result = await getAIProvider().interpret({
          instruction: prompt,
          rocket: state.rocket,
          history: historyFrom(state.messages),
          mode: "modify",
        });
        applyResult(result, prompt);
      } catch (error) {
        fail(error);
      }
    },

    async repair() {
      const state = get();
      if (state.busy || !state.plan) return;
      const mission = summarizeMission(state.rocket, state.plan);
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

    randomize() {
      const seed = newSeed();
      const rocket = createRandomRocket(seed);
      rocket.name = generateName(rocket, createRng(seed));
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

    launch() {
      const state = get();
      if (state.busy || (state.mode !== "build" && state.mode !== "report"))
        return;
      const attempt = state.attempt + 1;
      set({
        mode: "transition",
        attempt,
        plan: simulateLaunch(state.rocket, attempt),
      });
      sound.play("whoosh");
    },

    beginFlight() {
      if (get().mode === "transition") set({ mode: "launch" });
    },

    finishLaunch() {
      const { plan } = get();
      if (!plan) return;
      set({ mode: "report" });
      sound.play(plan.report.grade === "failure" ? "fail" : "success");
      unlock(launchAchievements(plan));
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
