"use client";

import { useEffect, useRef, useState } from "react";
import { useThumbnail } from "@/components/three/thumbnail-context";
import type { RocketConfig } from "@/lib/rocket/types";

/** Lazily rendered rocket thumbnail that only requests a render once it scrolls near view. */
export function RocketThumb({ id, rocket, aspect }: { id: string; rocket: RocketConfig; aspect: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "400px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const url = useThumbnail(id, rocket, visible);
  return (
    <div ref={box} className={`relative ${aspect} w-full overflow-hidden bg-[radial-gradient(ellipse_at_50%_80%,#1a1c22,#0b0c10_70%)]`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={rocket.name} className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.03]" />
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          <span className="label-xs animate-pulse text-faint">Rendering…</span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0d0e12] to-transparent" />
    </div>
  );
}
