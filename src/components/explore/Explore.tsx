"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Wordmark } from "@/components/ui/BrandRail";
import { Icon } from "@/components/ui/Icon";
import { feedPage, type FeedPost } from "@/lib/feed/community";
import { compactNumber } from "@/lib/format";
import { handOff, loadLikes, saveLikes } from "@/lib/persistence";
import { computeStats } from "@/lib/rocket/stats";
import { OutcomeBadge } from "./OutcomeBadge";
import { RocketThumb } from "./RocketThumb";

const ThumbnailProvider = dynamic(() => import("@/components/three/Thumbnails").then((m) => m.ThumbnailProvider), { ssr: false });

/** Infinite feed of community rockets. */
export function Explore() {
  const [pages, setPages] = useState(1);
  const [likes, setLikes] = useState<string[]>([]);
  const sentinel = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const posts = useMemo(() => Array.from({ length: pages }, (_, i) => feedPage(i)).flat(), [pages]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLikes(loadLikes());
  }, []);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setPages((p) => Math.min(p + 1, 400));
    }, { rootMargin: "800px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const toggleLike = (id: string) => {
    const next = likes.includes(id) ? likes.filter((l) => l !== id) : [...likes, id];
    setLikes(next);
    saveLikes(next);
  };

  const remix = (post: FeedPost) => {
    handOff({ rocket: post.rocket, prompt: post.prompt, source: post.creator });
    router.push("/");
  };

  return (
    <ThumbnailProvider>
      <main className="min-h-screen bg-bg">
        <header className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-3 sm:px-6">
            <div className="flex items-center gap-5">
              <Wordmark />
              <span className="label-xs hidden sm:inline">Explore · community launches</span>
            </div>
            <Link href="/" className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 font-display text-[12px] font-bold tracking-[0.1em] text-black">
              <Icon name="rocket" size={14} /> BUILD YOUR OWN
            </Link>
          </div>
        </header>

        <section className="mx-auto max-w-[1400px] px-4 pt-10 pb-6 sm:px-6">
          <h1 className="max-w-3xl font-display text-[34px] leading-[1.02] font-extrabold tracking-tight sm:text-[56px]">
            An infinite stream of <span className="text-accent">questionable</span> engineering.
          </h1>
          <p className="mt-3 max-w-xl text-[15px] text-muted">Every rocket here was talked into existence. Remix any of them and tell the engineer to make it worse.</p>
        </section>

        <div className="mx-auto max-w-[1400px] columns-1 gap-4 px-4 pb-24 sm:columns-2 sm:px-6 lg:columns-3 xl:columns-4">
          {posts.map((post, i) => (
            <Card key={post.id} post={post} index={i} liked={likes.includes(post.id)} onLike={() => toggleLike(post.id)} onRemix={() => remix(post)} />
          ))}
        </div>
        <div ref={sentinel} className="h-10" />
      </main>
    </ThumbnailProvider>
  );
}

/** One community rocket card. */
function Card({ post, index, liked, onLike, onRemix }: { post: FeedPost; index: number; liked: boolean; onLike: () => void; onRemix: () => void }) {
  const stats = useMemo(() => computeStats(post.rocket), [post.rocket]);
  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, delay: (index % 4) * 0.05 }}
      className="panel group mb-4 break-inside-avoid overflow-hidden rounded-2xl"
    >
      <Link href={`/r/${post.id}`} className="relative block">
        <RocketThumb id={post.id} rocket={post.rocket} aspect={index % 3 === 0 ? "aspect-[3/4]" : "aspect-[4/5]"} />
        <div className="absolute top-3 left-3">
          <OutcomeBadge plan={post.plan} />
        </div>
      </Link>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-[16px] leading-tight font-bold">{post.name}</h2>
            <div className="mt-0.5 font-mono text-[10.5px] text-muted">{post.creator}</div>
          </div>
          <button onClick={onLike} className={`flex shrink-0 items-center gap-1 font-mono text-[11px] transition ${liked ? "text-accent" : "text-muted hover:text-text"}`} aria-pressed={liked}>
            <Icon name="heart" size={14} className={liked ? "fill-accent" : ""} />
            {compactNumber(post.likes + (liked ? 1 : 0))}
          </button>
        </div>
        <p className="mt-3 line-clamp-2 font-mono text-[11px] leading-relaxed text-text/70">“{post.prompt}”</p>
        <div className="mt-3 grid grid-cols-4 gap-1 border-t border-line pt-3 font-mono">
          {[
            ["HGT", `${Math.round(stats.height)}m`],
            ["BST", String(post.rocket.boosters.length)],
            ["REL", `${stats.reliability}%`],
            ["CHS", String(stats.chaos)],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="text-[8.5px] tracking-[0.14em] text-faint">{k}</div>
              <div className="text-[12px]">{v}</div>
            </div>
          ))}
        </div>
        <button onClick={onRemix} className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-line font-mono text-[10.5px] tracking-[0.16em] text-muted transition hover:border-accent hover:text-text">
          <Icon name="remix" size={14} /> REMIX
        </button>
      </div>
    </motion.article>
  );
}
