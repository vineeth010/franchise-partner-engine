"use client";
import { useRef, type ReactNode } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

// The shutter plays once per page visit; "New upload" back to the landing skips it.
let shutterPlayed = false;

const SHELF: [string, string][] = [
  ["<10s", "from upload to a decision for every applicant"],
  ["100%", "of decisions carry reasons & evidence"],
  ["0", "pin codes ever double-booked"],
  ["3", "training languages, chosen by the partner"],
];

export default function StorefrontHero({ onUploadClick, onSampleClick, children }: { onUploadClick: () => void; onSampleClick: () => void; children?: ReactNode }) {
  const scope = useRef<HTMLElement>(null);

  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add({ full: "(prefers-reduced-motion: no-preference)", reduced: "(prefers-reduced-motion: reduce)" }, (ctx) => {
      const { reduced } = ctx.conditions as { reduced: boolean };
      if (reduced || shutterPlayed) {
        gsap.set(".store-shutter", { yPercent: -100, autoAlpha: 0 });
        gsap.set([".sf-neon", ".sf-grid", ".sf-reveal", ".sf-shelf-row"], { autoAlpha: 1, clearProps: "transform" });
        return;
      }
      shutterPlayed = true;
      gsap.set(".sf-grid", { scale: 1.08, autoAlpha: 0 });
      gsap.set(".sf-reveal", { y: 28, autoAlpha: 0 });
      gsap.set(".sf-shelf-row", { y: 36, autoAlpha: 0 });
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      // 1. neon bar initialising: uneven flicker, then holds on
      tl.set(".sf-neon", { autoAlpha: 0 })
        .to(".sf-neon", { autoAlpha: 1, duration: 0.04 })
        .to(".sf-neon", { autoAlpha: 0.15, duration: 0.05 })
        .to(".sf-neon", { autoAlpha: 0.9, duration: 0.03, delay: 0.08 })
        .to(".sf-neon", { autoAlpha: 0.2, duration: 0.06 })
        .to(".sf-neon", { autoAlpha: 1, duration: 0.04, delay: 0.14 })
        .to(".sf-neon", { autoAlpha: 0.55, duration: 0.03 })
        .to(".sf-neon", { autoAlpha: 1, duration: 0.05 })
      // 2. vault lift of the shutter
        .to(".store-shutter", { yPercent: -100, duration: 1.1, ease: "power4.inOut" }, "+=0.15")
      // 3. interior grid scales and fades in under the rising shutter
        .to(".sf-grid", { scale: 1, autoAlpha: 1, duration: 1.2, ease: "power2.out" }, "<0.25")
        .to(".sf-reveal", { y: 0, autoAlpha: 1, duration: 0.8, stagger: 0.08 }, "<0.2")
      // 4. metric shelf rows
        .to(".sf-shelf-row", { y: 0, autoAlpha: 1, duration: 0.7, stagger: 0.12, ease: "back.out(1.5)" }, "-=0.4")
        .set(".store-shutter", { autoAlpha: 0 });
    });
    return () => mm.revert();
  }, { scope });

  return (
    <section ref={scope} className="sf">
      <div className="store-interior">
        <div className="sf-grid" aria-hidden="true" />
        <div className="sf-light" aria-hidden="true" />
        <div className="sf-in">
          <div className="sf-copy">
            <div className="sf-neon" aria-hidden="true">PARTNERSCOPE</div>
            <span className="sf-kicker sf-reveal">Flagship · Karnataka expansion desk</span>
            <div className="sf-greet sf-reveal" lang="kn">Namaskara · ನಮಸ್ಕಾರ</div>
            <h1 className="sf-title sf-reveal">The right partners.<br />The right pin codes.<br /><em>Open stores faster.</em></h1>
            <p className="sf-sub sf-reveal">Upload your applications sheet and PartnerScope screens every applicant, fills each territory slot by slot, guards against cannibalisation, and hands every approved partner a week-by-week launch plan &mdash; in Kannada, Hindi or English.</p>
            <div className="sf-cta sf-reveal">
              <button className="sf-btn solid" onClick={onSampleClick}>See it decide in 10 seconds <span aria-hidden="true">→</span></button>
              <button className="sf-btn line" onClick={onUploadClick}>Upload your Excel</button>
            </div>
            <div className="sf-trust sf-reveal"><span>1 store per pin, guaranteed</span><span>Every decision explained</span><span>ಕನ್ನಡ · हिंदी · English</span></div>
          </div>
          <div className="sf-counter sf-reveal">{children}</div>
        </div>
        <div className="sf-shelf">
          {SHELF.map(([n, t]) => <div key={t} className="sf-shelf-row"><b>{n}</b><span>{t}</span></div>)}
        </div>
      </div>
      <div className="store-shutter" aria-hidden="true"><div className="sf-slats" /><span className="sf-shutter-tag">Opening the flagship</span></div>
    </section>
  );
}
