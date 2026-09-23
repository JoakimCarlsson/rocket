import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedRocket } from "@/components/share/SharedRocket";
import { getPost } from "@/lib/feed/community";
import { decodeShare, type SharePayload } from "@/lib/share";

/** Resolves a share id: community posts by slug, anything else as an encoded rocket. */
function resolve(id: string): SharePayload | null {
  const post = getPost(id);
  if (post) return { rocket: post.rocket, prompt: post.prompt, creator: post.creator, attempt: 1 };
  return decodeShare(id);
}

/** Uses the rocket name as the page title. */
export async function generateMetadata({ params }: PageProps<"/r/[id]">): Promise<Metadata> {
  const { id } = await params;
  const payload = resolve(id);
  return { title: payload ? `${payload.rocket.name} — ROCKET.AI` : "Rocket not found — ROCKET.AI" };
}

/** A shared rocket, or its share card when `?card=1`. */
export default async function SharedRocketPage({ params, searchParams }: PageProps<"/r/[id]">) {
  const { id } = await params;
  const { card } = await searchParams;
  const payload = resolve(id);
  if (!payload) notFound();
  return <SharedRocket id={id} payload={payload} card={card === "1"} />;
}
