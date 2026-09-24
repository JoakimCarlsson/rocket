"use client";

import { useEffect, useState } from "react";
import type { RocketConfig } from "@/lib/rocket/types";
import { type Flight, launchRocket } from "./api";

/** One server-flown launch of a rocket, or null until it arrives. */
export function useFlight(
  rocket: RocketConfig,
  attempt: number,
): Flight | null {
  const [flight, setFlight] = useState<Flight | null>(null);
  useEffect(() => {
    let live = true;
    launchRocket(rocket, attempt)
      .then((result) => live && setFlight(result))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [rocket, attempt]);
  return flight;
}
