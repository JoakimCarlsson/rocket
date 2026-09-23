"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { Wordmark } from "@/components/ui/BrandRail";
import { getPost } from "@/lib/feed/community";
import { decodeShare, type SharePayload } from "@/lib/share";
import { SharedRocket } from "./SharedRocket";

/** Resolves a share id: community posts by slug, anything else as an encoded rocket. */
function resolve(id: string): SharePayload | null {
  const post = getPost(id);
  if (post)
    return {
      rocket: post.rocket,
      prompt: post.prompt,
      creator: post.creator,
      attempt: 1,
    };
  return decodeShare(id);
}

/** Reads the share id from the query string and renders the rocket it names. */
export function SharedRocketRoute() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const card = params.get("card") === "1";
  const payload = useMemo(() => (id ? resolve(id) : null), [id]);

  useEffect(() => {
    document.title = payload
      ? `${payload.rocket.name} — ROCKET.JDADDY`
      : "Rocket not found — ROCKET.JDADDY";
  }, [payload]);

  if (!payload) return <RocketNotFound />;
  return <SharedRocket id={id} payload={payload} card={card} />;
}

/** Shown when the share id is missing or does not decode to a rocket. */
function RocketNotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-bg p-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <Wordmark />
        <h1 className="font-display text-xl font-bold">Rocket not found</h1>
        <Link href="/explore" className="label-xs hover:text-text">
          Explore rockets
        </Link>
      </div>
    </main>
  );
}
