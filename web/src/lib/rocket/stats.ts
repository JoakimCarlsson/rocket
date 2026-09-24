import type { SimulatedStats } from "./types";

/** Tongue-in-cheek readouts shown under the stats. These are jokes, not assessments. */
export function jokeMeters(
  stats: SimulatedStats,
): { label: string; value: string }[] {
  const confidence =
    stats.reliability > 85
      ? "SMUG"
      : stats.reliability > 70
        ? "CAUTIOUS"
        : stats.reliability > 50
          ? "DECLINING"
          : stats.reliability > 30
            ? "IN FREEFALL"
            : "ON VACATION";
  const regulatory =
    stats.chaos < 15
      ? "GRUDGINGLY YES"
      : stats.chaos < 35
        ? "UNDER REVIEW"
        : stats.chaos < 60
          ? "PENDING"
          : stats.chaos < 85
            ? "PENDING FOREVER"
            : "THEY STOPPED ANSWERING";
  const commonSense = Math.max(
    0,
    Math.min(
      100,
      Math.round(100 - stats.chaos * 0.95 - (100 - stats.reliability) * 0.2),
    ),
  );
  return [
    { label: "ENGINEER CONFIDENCE", value: confidence },
    { label: "REGULATORY APPROVAL", value: regulatory },
    { label: "COMMON SENSE", value: `${commonSense}%` },
  ];
}
