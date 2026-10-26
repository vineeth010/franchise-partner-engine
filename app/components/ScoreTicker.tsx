"use client";
import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

// Counts a fit score up from 0 when its ledger row mounts (text only, no layout properties).
export default function ScoreTicker({ value, className }: { value: number; className?: string }) {
  const el = useRef<HTMLSpanElement>(null);
  const decimals = Number.isInteger(value) ? 0 : 1;
  useGSAP(() => {
    if (!el.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { el.current.textContent = value.toFixed(decimals); return; }
    const n = { v: 0 };
    gsap.to(n, { v: value, duration: 0.5, ease: "power2.out", onUpdate: () => { if (el.current) el.current.textContent = n.v.toFixed(decimals); } });
  }, { dependencies: [value], scope: el });
  return <span ref={el} className={className} aria-label={`Fit score ${value}`}>{value.toFixed(decimals)}</span>;
}
