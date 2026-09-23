"use client";

import { animate } from "motion/react";
import { useEffect, useRef, useState } from "react";

/** A number that counts toward its new value and flashes when it changes. */
export function AnimatedNumber({ value, format }: { value: number; format: (v: number) => string }) {
  const [shown, setShown] = useState(value);
  const [delta, setDelta] = useState(0);
  const previous = useRef(value);
  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (from === value) return;
    setDelta(Math.sign(value - from));
    const controls = animate(from, value, { duration: 0.9, ease: [0.16, 1, 0.3, 1], onUpdate: setShown });
    const timer = setTimeout(() => setDelta(0), 1100);
    return () => {
      controls.stop();
      clearTimeout(timer);
    };
  }, [value]);
  const tone = delta > 0 ? "text-accent-soft" : delta < 0 ? "text-sky-300" : "";
  return <span className={`tabular-nums transition-colors duration-500 ${tone}`}>{format(shown)}</span>;
}
