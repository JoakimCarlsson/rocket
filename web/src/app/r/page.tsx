import type { Metadata } from "next";
import { Suspense } from "react";
import { SharedRocketRoute } from "@/components/share/SharedRocketRoute";

export const metadata: Metadata = { title: "Shared rocket — ROCKET.JDADDY" };

/** A shared rocket from `?id=`, or its share card when `?card=1`. */
export default function SharedRocketPage() {
  return (
    <Suspense>
      <SharedRocketRoute />
    </Suspense>
  );
}
