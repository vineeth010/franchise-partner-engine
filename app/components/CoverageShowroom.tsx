import { CONFIG } from "@/lib/config";
import { CITY_REF } from "@/lib/engine";

const NOTE: Record<string, string> = {
  "Tier 1": "Anchor metro. Highest floor, densest store network, strongest cannibalisation checks.",
  "Tier 2": "Regional hub",
  "Tier 3": "Emerging market",
};

// 7-city coverage as a bento showroom. Lit nodes = brand stores open today (Sheet 3).
export default function CoverageShowroom() {
  const cities = Object.entries(CONFIG.allowedCities);
  return (
    <section id="cities" className="cov">
      <div className="sec-h"><span className="eyebrow light">Coverage</span><h2>Seven Karnataka cities, three tiers</h2><p>Investment floors and benchmarks are tuned to each tier. Lit nodes are stores open today.</p></div>
      <div className="bento">
        {cities.map(([city, { prefix, tier }]) => {
          const ref = CITY_REF.find((x) => x.city === city);
          const live = Number(ref?.existing_store_count || 0);
          const nodes = Math.max(6, live);
          const anchor = tier === "Tier 1";
          return (
            <article key={city} className={"bento-cell" + (anchor ? " anchor" : "")}>
              <div className="bc-top">
                <div><span className="bc-tier">{tier}</span><h3>{city}</h3></div>
                <div className="ledger" role="img" aria-label={`${live} brand store${live === 1 ? "" : "s"} open today`}>
                  {Array.from({ length: nodes }).map((_, i) => <i key={i} className={i < live ? "on" : ""} />)}
                  <small>{live} live</small>
                </div>
              </div>
              <p className="bc-note">{NOTE[tier]}{anchor && ref?.census_2011_ua_population ? ` · ${Number(ref.census_2011_ua_population).toLocaleString("en-IN")} people (Census 2011 UA).` : ""}</p>
              <div className="bc-foot">
                <span className="bc-pins">Pins {prefix}xxx</span>
                <span className="floor-tag"><small>Min. investment</small><b>₹{CONFIG.investmentFloorLakh[tier]} L</b></span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
