"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Wordmark } from "@/components/ui/BrandRail";
import { fetchPost, isPublishedId } from "@/lib/feed/api";
import { decodeShare, type SharePayload } from "@/lib/share";
import { SharedRocket } from "./SharedRocket";

/** Resolves a share id: a published rocket from the API, anything else as an encoded rocket. */
async function resolve(id: string): Promise<SharePayload | null> {
  if (!isPublishedId(id)) return decodeShare(id);
  const post = await fetchPost(id);
  if (!post) return null;
  return {
    rocket: post.rocket,
    prompt: post.prompt,
    creator: post.creator,
    attempt: 1,
  };
}

/** Reads the share id from the query string and renders the rocket it names. */
export function SharedRocketRoute() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const card = params.get("card") === "1";
  const [resolved, setResolved] = useState<{
    id: string;
    payload: SharePayload | null;
  }>();

  useEffect(() => {
    let live = true;
    void (id ? resolve(id) : Promise.resolve(null)).then((payload) => {
      if (live) setResolved({ id, payload });
    });
    return () => {
      live = false;
    };
  }, [id]);

  const payload = resolved?.id === id ? resolved.payload : undefined;

  useEffect(() => {
    if (payload === undefined) return;
    document.title = payload
      ? `${payload.rocket.name} — ROCKET.JDADDY`
      : "Rocket not found — ROCKET.JDADDY";
  }, [payload]);

  if (payload === undefined) return <main className="min-h-screen bg-bg" />;
  if (!payload) return <RocketNotFound />;
  return <SharedRocket id={id} payload={payload} card={card} />;
}

/** Shown when the share id is missing, unknown or does not decode to a rocket. */
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
