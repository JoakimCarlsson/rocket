import type { Metadata } from "next";
import { Explore } from "@/components/explore/Explore";

export const metadata: Metadata = { title: "Explore — ROCKET.JDADDY" };

/** Infinite community rocket feed. */
export default function ExplorePage() {
  return <Explore />;
}
