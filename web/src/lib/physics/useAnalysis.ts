"use client";

import { useEffect, useState } from "react";
import type { RocketConfig } from "@/lib/rocket/types";
import { type Analysis, analyzeRocket } from "./api";

/** Server analysis of a rocket, kept until the next one arrives so panels do not flicker. */
export function useAnalysis(rocket: RocketConfig): Analysis | null {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  useEffect(() => {
    let live = true;
    analyzeRocket(rocket)
      .then((result) => live && setAnalysis(result))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [rocket]);
  return analysis;
}
