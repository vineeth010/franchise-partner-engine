import { CONFIG } from "./config";
import ref from "./data/reference.json";
import { keywordInsight, familyShopQuote } from "./text";
import type { CleanApp, Decision, EngineInput, EngineResult, Onboarding, RawApplication, Reason, ScoreBreakdown, Store, Territory, TextInsight } from "./types";

const COORDS = (ref as unknown as { coords: Record<string, [number, number]> }).coords;
const DOP = new Set((ref as unknown as { dopPins: string[] }).dopPins);
export const CITY_REF = (ref as unknown as { cities: { city: string; census_2011_ua_population: string; existing_store_count: string }[] }).cities;

export const EXAMPLE_ROW = { id: "APP-001", name: "Ravi Kumar", city: "Mysuru", state: "Karnataka", pin: "570001", investment: "25", experience: "4", business: "Runs a footwear store", space: "Rented", size: "450", floor: "Ground", target: "3", language: "Kannada", notes: "Wants to open before Diwali" };

const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export function parseNumber(s: string): { value: number | null; fixed: string | null } {
  const raw = (s ?? "").toString().trim();
  if (!raw) return { value: null, fixed: null };
  const plain = raw.replace(/,/g, "");
  if (/^-?\d+(\.\d+)?$/.test(plain)) return { value: parseFloat(plain), fixed: raw.includes(",") ? `"${raw}" read as ${parseFloat(plain)}` : null };
  const m = plain.match(/-?\d+(\.\d+)?/);
  if (!m) return { value: null, fixed: null };
  let v = parseFloat(m[0]);
  if (/crore|cr\b/i.test(plain)) v = v * 100;
  return { value: v, fixed: `"${raw}" read as ${v}` };
}
export function normPin(s: string): string {
  const t = (s ?? "").toString().trim().replace(/\.0+$/, "").replace(/\s+/g, "");
  return t;
}
export function normCity(s: string): { city: string; fixed: string | null } {
  const t = (s ?? "").toString().trim();
  if (!t) return { city: "", fixed: null };
  const k = t.toLowerCase().replace(/\s+/g, " ");
  const c = CONFIG.cityAliases[k] || CONFIG.cityAliases[k.replace(/[–—]/g, "-")] || Object.keys(CONFIG.allowedCities).find((x) => x.toLowerCase() === k);
  if (c) return { city: c, fixed: c !== t ? `City "${t}" standardised to ${c}` : null };
  return { city: t, fixed: null };
}
function normSpace(s: string) {
  const k = (s || "").toLowerCase().trim();
  if (!k) return "";
  if (/not|no |^no$|yet|nyi|search|looking/.test(k)) return "Not yet identified";
  if (/own/.test(k)) return "Owned";
  if (/rent|leas/.test(k)) return "Rented";
  return "?" + s;
}
function normFloor(s: string) {
  const k = (s || "").toLowerCase().trim();
  if (!k) return "";
  if (/mall/.test(k)) return "Mall unit";
  if (/ground|^gf$|^g$/.test(k)) return "Ground";
  if (/upper|first|1st|second|2nd|third|basement/.test(k)) return "Upper";
  return "Not known";
}
function normLang(s: string) {
  const k = (s || "").toLowerCase();
  if (/kann/.test(k)) return "Kannada";
  if (/hindi/.test(k)) return "Hindi";
  if (/eng/.test(k)) return "English";
  return "";
}

export function normTier(t: string): string {
  const m = (t || "").match(/[123]/);
  return m ? `Tier ${m[0]}` : "";
}
export function normPriority(p: string): string {
  const k = (p || "").toLowerCase();
  return k.startsWith("h") ? "High" : k.startsWith("l") ? "Low" : "Medium";
}
export function km(a: [number, number], b: [number, number]) {
  const R = 6371, rad = Math.PI / 180;
  const dl = (b[0] - a[0]) * rad, dn = (b[1] - a[1]) * rad;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function nearest(pin: string, others: { id: string; pin: string }[]) {
  const c = COORDS[pin];
  let best: { storeId: string; km: number | null } | null = null;
  for (const o of others) {
    if (o.pin === pin) return { storeId: o.id, km: 0 };
    const oc = COORDS[o.pin];
    if (!c || !oc) continue;
    const d = km(c, oc);
    if (!best || (best.km ?? 1e9) > d) best = { storeId: o.id, km: r1(d) };
  }
  return best;
}
function proximityPenalty(d: number | null) {
  if (d === null) return 0;
  if (d >= CONFIG.cannibalisationRadiusKm) return 0;
  return r1(CONFIG.maxProximityPenalty * (1 - d / CONFIG.cannibalisationRadiusKm));
}

// ---------- Onboarding plan (rule-based) ----------
export function buildOnboarding(a: CleanApp, floorLakh: number, insight: TextInsight | undefined, today: Date): Onboarding {
  const stages: Onboarding["stages"] = [];
  stages.push({ name: "1. Agreement & KYC", weeks: 1, tasks: ["Sign franchise agreement and pay franchise fee", "Submit ID proof, PAN and bank details", "Assign a launch manager from the brand"] });
  const needsFunding = (a.investment ?? 0) < floorLakh * (1 + CONFIG.fundingProofIfWithinPctOfFloor) || (insight?.funding.length ?? 0) > 0;
  if (needsFunding) stages.push({ name: "2. Funding proof", weeks: 2, tasks: [`Show proof of funds or a loan sanction letter for at least ₹${floorLakh} lakh (capacity is within 20% of the floor${insight?.funding[0] ? ` / applicant wrote "${insight.funding[0].quote}"` : ""})`] });
  const siteTasks = [a.space === "Owned" ? "Submit ownership documents" : "Submit signed lease (min. 5-year term recommended)", "Brand site audit: frontage, footfall, visibility", "Approve store layout"];
  if (a.floor === "Upper") siteTasks.push("Extra check: upper-floor signage and street visibility plan");
  if (a.sizeToConfirm || a.size === null) siteTasks.push("Confirm carpet area in sq ft during site audit");
  if (a.size !== null && a.size < CONFIG.idealSizeSqft[0]) siteTasks.push(`Space is ${a.size} sq ft, below the ${CONFIG.idealSizeSqft[0]}–${CONFIG.idealSizeSqft[1]} sq ft target: approve a compact layout`);
  stages.push({ name: `${stages.length + 1}. Site`, weeks: a.floor === "Upper" ? 3 : 2, tasks: siteTasks });
  stages.push({ name: `${stages.length + 1}. Licences (runs alongside fit-out)`, weeks: 0, tasks: [`Shops & Establishments registration – ${CONFIG.shopsEstablishmentFee}`, "Municipal trade licence (fee: city schedule not found – confirm locally)", "GST registration"] });
  stages.push({ name: `${stages.length + 1}. Fit-out & stock`, weeks: 5, tasks: ["Interiors, signage and fixtures by brand-approved vendor (4–6 weeks)", "POS hardware and inventory system install", "Opening stock delivered"] });
  const exp = a.experience ?? 0;
  const lang = a.language || "English";
  const trainTasks = [`Product training (in ${lang})`, `POS & inventory training (in ${lang})`, "Customer service standards", "Hiring 2–3 staff: profiles, wages at Karnataka minimum wage or above"];
  if (exp < 3) trainTasks.push("Extra module: running a shop day-to-day (cash, stock, staff rosters) – first-time retailer");
  else trainTasks.unshift("Lighter track: experienced retailer (3+ years)");
  stages.push({ name: `${stages.length + 1}. Training in ${lang}`, weeks: exp >= 3 ? 1 : 2, tasks: trainTasks });
  const totalWeeks = stages.reduce((s, x) => s + x.weeks, 0);
  const realisticMonths = Math.ceil(totalWeeks / 4.33);
  const d = new Date(today.getTime() + totalWeeks * 7 * 86400000);
  const realisticDate = d.toISOString().slice(0, 10);
  let gapFlag: string | null = null;
  if (a.target !== null && a.target < totalWeeks / 4.33) gapFlag = `Target is ${a.target} month(s) but the plan needs about ${totalWeeks} weeks (~${realisticMonths} months). Realistic opening: ${realisticDate}.`;
  if (insight?.timing[0] && /diwali|deepavali/i.test(insight.timing[0].text)) {
    const yr = today.getFullYear();
    const diwali = new Date(yr === 2026 ? "2026-11-08" : `${yr}-11-01`);
    if (d > diwali) gapFlag = (gapFlag ? gapFlag + " " : "") + `Applicant wrote "${insight.timing[0].quote}" – this Diwali (8 Nov 2026) is not achievable; plan for the next festive season or a soft launch.`;
  }
  return { stages, totalWeeks, realisticMonths, realisticDate, targetMonths: a.target, gapFlag, trainingLanguage: lang };
}

function payback(a: CleanApp, tier: string): Decision["payback"] {
  const rev = CONFIG.monthlyRevenueLakh[tier]; const rent = CONFIG.rentPerSqft[tier]; const wage = CONFIG.skilledMinWage[tier];
  if (!rev || !a.investment) return null;
  const size = a.size ?? CONFIG.defaultSizeForPayback;
  const rentLow = a.space === "Owned" ? 0 : size * rent[0], rentHigh = a.space === "Owned" ? 0 : size * rent[1];
  const profitLow = rev[0] * 1e5 * CONFIG.marginPct[0] - rentHigh - CONFIG.staffCount[1] * wage;
  const profitHigh = rev[1] * 1e5 * CONFIG.marginPct[1] - rentLow - CONFIG.staffCount[0] * wage;
  const inv = a.investment * 1e5;
  const hi = profitLow > 0 ? Math.round(inv / profitLow) : null;
  const lo = profitHigh > 0 ? Math.round(inv / profitHigh) : null;
  const text = lo === null ? "Payback not reached on these assumptions" : `Indicative payback ${lo}–${hi ?? "n/a"} months (low-confidence estimate, 2019 benchmarks: revenue ₹${rev[0]}–${rev[1]}L/month × 25–30% margin − rent${a.space === "Owned" ? " (owned: ₹0)" : ` ₹${rent[0]}–${rent[1]}/sq ft`} − ${CONFIG.staffCount[0]}–${CONFIG.staffCount[1]} staff at min. wage)`;
  return { lowMonths: lo, highMonths: hi, text };
}

// ---------- Fit score (deterministic) ----------
export function fitScore(a: CleanApp, floorLakh: number, insight: TextInsight, onb: Onboarding, nearKm: number | null): ScoreBreakdown {
  const W = CONFIG.weights; const notes: Record<string, string> = {};
  const ratio = (a.investment ?? 0) / floorLakh;
  const capital = r1(10 + 20 * clamp(ratio - 1, 0, 1));
  notes.capital = `₹${a.investment}L vs ₹${floorLakh}L floor (${Math.round(ratio * 100)}%): 10 pts at the floor rising linearly to 30 at 2× floor`;
  let st = a.space === "Owned" ? 10 : a.space === "Rented" ? 9 : 0;
  let sz = 4; const s = a.size;
  const [lo, hi] = CONFIG.idealSizeSqft;
  if (s !== null) sz = s >= lo && s <= hi ? 8 : s >= 300 && s < lo ? 4 + 4 * (s - 300) / (lo - 300) : s < 300 ? 2 : s <= 1500 ? 8 - 2 * (s - hi) / 500 : 5;
  const fl = a.floor === "Ground" || a.floor === "Mall unit" ? 7 : a.floor === "Upper" ? 2 : 4;
  const site = r1(st + sz + fl);
  notes.site = `${a.space || "?"} (${st}/10) + size ${s ?? "unknown"} sq ft (${r1(sz)}/8, target ${lo}–${hi}) + floor ${a.floor || "blank"} (${fl}/7)`;
  const exp = r1(W.experience * clamp((a.experience ?? 0) / CONFIG.experienceCapYears, 0, 1));
  notes.experience = `${a.experience ?? 0} years of retail experience, capped at ${CONFIG.experienceCapYears} years`;
  const bgMap = { direct_retail: 10, adjacent: 7, unknown: 5, unrelated: 3 } as const;
  const background = bgMap[insight.background];
  notes.background = `${insight.background.replace("_", " ")}${insight.backgroundQuote ? ` – "${insight.backgroundQuote}"` : " (blank = neutral)"}`;
  let timeline = 7;
  if (a.target !== null) { const need = onb.totalWeeks / 4.33; timeline = a.target >= need ? 10 : r1(Math.max(0, 10 - 2.5 * (need - a.target))); }
  notes.timeline = a.target === null ? "Target launch blank: neutral 7/10" : `Target ${a.target} months vs ~${r1(onb.totalWeeks / 4.33)} months the plan needs`;
  const pen = proximityPenalty(nearKm);
  notes.proximity = nearKm === null ? "Distance unknown (no coordinates for this pin): no penalty" : `Nearest brand store ~${nearKm} km away (approximate pin-centre distance)${pen ? `: −${pen} cannibalisation penalty` : ""}`;
  const total = r1(clamp(capital + site + exp + background + timeline - pen, 0, 100));
  return { capital, site, experience: exp, background, timeline, proximityPenalty: pen, total, notes };
}

// ---------- Main engine ----------
export function runEngine(input: EngineInput): EngineResult {
  const today = input.today ? new Date(input.today) : new Date();
  const warnings: string[] = [...(input.parseWarnings || [])];
  const patchMap = new Map<string, RawApplication>();
  const apps: RawApplication[] = input.apps.map((a) => ({ ...a }));
  for (const p of input.patches || []) {
    const t = apps.find((a) => a.id.trim().toUpperCase() === p.appId.toUpperCase());
    if (t) { (t as unknown as Record<string, string>)[p.field] = p.newValue; patchMap.set(t.id, t); }
  }
  const sizeConfirmIds = new Set((input.patches || []).filter((p) => p.field === "space" && /owned|rented/i.test(p.newValue)).map((p) => p.appId.toUpperCase()));

  // territories: pin -> territory (first listed wins)
  const pinTer = new Map<string, Territory>();
  for (const t of input.territories) for (const p of t.pins) {
    if (pinTer.has(p)) warnings.push(`Pin ${p} is listed in both ${pinTer.get(p)!.id} and ${t.id}; assigned to ${pinTer.get(p)!.id} (first listed).`);
    else pinTer.set(p, t);
  }
  const storePins = new Map(input.stores.map((s) => [s.pin, s] as [string, Store]));

  const idCount = new Map<string, number>();
  const decisions: Decision[] = [];
  const firstRow = apps[0];
  apps.forEach((raw, idx) => {
    if (idx === 0 && firstRow && Object.entries(EXAMPLE_ROW).every(([k, v]) => String((raw as unknown as Record<string, string>)[k]).trim().replace(/\.0$/, "") === v)) {
      warnings.push(`Row ${raw.row} exactly matches the template's example row (APP-001 Ravi Kumar) and was skipped.`);
      return;
    }
    const reasons: Reason[] = []; const fixes: string[] = [];
    const id = (raw.id || "").trim().toUpperCase().replace(/\s+/g, "");
    if (raw.id && raw.id !== id) fixes.push(`Application ID "${raw.id}" standardised to ${id}`);
    const base: Decision = { id: id || `ROW-${raw.row}`, row: raw.row, name: raw.name, city: raw.city, pin: raw.pin, territoryId: null, tier: null, priority: null, status: "On hold", headline: "", eligible: false, readiness: "", reasons, fixes, score: null, nearestStore: null, payback: null, onboarding: null, nextActions: [] };
    if (!id) {
      decisions.push({ ...base, status: "Invalid record", headline: `Row ${raw.row} has no Application ID, so it cannot be tracked. This is a data problem, not a verdict on the applicant.`, readiness: "Not assessed", nextActions: ["Data team: add an Application ID to this row and re-upload"] });
      return;
    }
    const seen = idCount.get(id) || 0; idCount.set(id, seen + 1);
    if (seen > 0) {
      const first = decisions.find((d) => d.id === id);
      decisions.push({ ...base, id: `${id} (row ${raw.row})`, status: "Invalid record", headline: `Duplicate Application ID ${id} (already used on row ${first?.row}). Only the first row was assessed. This is a data problem, not a verdict on the applicant.`, readiness: "Not assessed", nextActions: ["Data team: give this row a unique Application ID and re-upload"] });
      return;
    }
    // ---- clean ----
    const nm = (raw.name || "").trim().replace(/\s+/g, " ");
    const c = normCity(raw.city); if (c.fixed) fixes.push(c.fixed);
    const state = (raw.state || "").trim();
    const pin = normPin(raw.pin); if (pin !== (raw.pin || "").trim() && pin) fixes.push(`Pin "${raw.pin}" read as ${pin}`);
    const inv = parseNumber(raw.investment); if (inv.fixed) fixes.push(`Investment ${inv.fixed} lakh`);
    const ex = parseNumber(raw.experience); if (ex.fixed) fixes.push(`Experience ${ex.fixed} years`);
    const sz = parseNumber(raw.size); if (sz.fixed) fixes.push(`Space size ${sz.fixed} sq ft`);
    const tg = parseNumber(raw.target); if (tg.fixed) fixes.push(`Target launch ${tg.fixed} months`);
    const space = normSpace(raw.space); if (space && !space.startsWith("?") && space !== raw.space.trim()) fixes.push(`Space available "${raw.space}" read as ${space}`);
    const floor = normFloor(raw.floor); if (floor && floor !== raw.floor.trim()) fixes.push(`Floor "${raw.floor}" read as ${floor}`);
    let language = normLang(raw.language);
    if (!language) { language = "English"; reasons.push({ kind: "info", text: raw.language ? `Preferred language "${raw.language}" not recognised; training defaults to English.` : "Preferred language blank; training defaults to English." }); }
    const app: CleanApp = { row: raw.row, id, name: nm, city: c.city, state, pin, investment: inv.value, experience: ex.value, business: (raw.business || "").trim(), space: space.startsWith("?") ? raw.space : space, size: sz.value, floor, target: tg.value, language, notes: (raw.notes || "").trim(), sizeToConfirm: sizeConfirmIds.has(id) && sz.value === null };
    base.name = nm; base.city = c.city; base.pin = pin; base.app = app;
    let insight = input.insights[id] || keywordInsight(raw);
    // User decision: a vague family-shop mention (no personal years stated) with 0 years entered earns no experience and no
    // direct-retail credit – treated as "no relevant background" (unrelated), overriding Gemini/keywords. No hold, no question.
    const rawText = `${raw.business || ""}. ${raw.notes || ""}`;
    const famQ = familyShopQuote(rawText) || (insight.familyNotOwn ? insight.familyQuote : "");
    const yrsM = rawText.match(/(\d{1,2})\s*\+?\s*(years|yrs|year|varsha|saal|sal)\b/i);
    const vagueFamily = !!famQ && !yrsM && (parseNumber(raw.experience).value ?? 0) === 0;
    if (vagueFamily) insight = { ...insight, background: "unrelated", backgroundQuote: famQ, statedOwnYears: null, statedQuote: "", familyNotOwn: true, familyQuote: famQ };
    base.insight = insight;
    for (const f of fixes) reasons.push({ kind: "fix", text: f });

    const rejects: Reason[] = []; const holds: { text: string; q: string; evidence?: string }[] = [];
    const cityCfg = CONFIG.allowedCities[app.city];
    const ter = pinTer.get(pin) || null;
    // missing required
    if (!nm) holds.push({ text: "Applicant name is missing.", q: "What is the applicant's full name?" });
    if (!app.city) holds.push({ text: "City is missing.", q: "Which city does the applicant want to open in?" });
    if (!pin) holds.push({ text: "Pin code is missing.", q: "What is the pin code of the proposed store location?" });
    else if (!/^\d{6}$/.test(pin)) holds.push({ text: `Pin code "${raw.pin}" is not a 6-digit pin.`, q: "Please confirm the correct 6-digit pin code." });
    if (app.investment === null) holds.push({ text: "Investment capacity is missing.", q: "How much can the applicant invest, in ₹ lakh?" });
    if (app.experience === null) holds.push({ text: "Retail experience is missing.", q: "How many years has the applicant run or managed a shop (0 if none)?" });
    if (!app.space) holds.push({ text: "Space available is missing.", q: "Does the applicant own or rent a space, or not yet have one?" });
    else if (space.startsWith("?")) holds.push({ text: `Space available "${raw.space}" is not one of Owned / Rented / Not yet identified.`, q: "Is the space owned, rented, or not yet identified?" });
    // out of scope
    if (app.city && !cityCfg) rejects.push({ kind: "reject", text: `${app.city} is not one of the brand's expansion cities (out of scope).`, evidence: `City = "${raw.city}"` });
    if (state && state.toLowerCase() !== "karnataka") rejects.push({ kind: "reject", text: `State "${state}" is outside Karnataka (out of scope).` });
    // pin checks
    if (cityCfg && /^\d{6}$/.test(pin) && !pin.startsWith(cityCfg.prefix)) {
      const other = Object.entries(CONFIG.allowedCities).find(([, v]) => pin.startsWith(v.prefix));
      holds.push({ text: `Pin ${pin} does not match ${app.city} (its pins start with ${cityCfg.prefix})${other ? `; ${pin} looks like ${other[0]}` : ""}.`, q: `Is the store in ${app.city}${other ? ` or in ${other[0]}` : ""}? Please confirm city and pin.`, evidence: `City = ${app.city}, Pin = ${pin}` });
    } else if (/^\d{6}$/.test(pin) && cityCfg) {
      if (!DOP.has(pin)) reasons.push({ kind: "warning", text: `Pin ${pin} is not in the 2019 India Post directory snapshot – may be a newer pin or a typo. Warning only.` });
      const st = storePins.get(pin);
      if (st) rejects.push({ kind: "reject", text: `Pin ${pin} already has brand store ${st.id} (opened ${st.year}). The brand never opens two stores in one pin.`, evidence: `Existing stores sheet: ${st.id} ${st.city} ${st.pin}` });
      else if (!ter) rejects.push({ kind: "reject", text: `The brand is not expanding in pin ${pin}: it is not in any territory.`, evidence: `Pin ${pin} not found in Territories sheet` });
    }
    // investment
    const tier = normTier(ter?.tier || "") || cityCfg?.tier || null;
    const floorL = tier ? CONFIG.investmentFloorLakh[tier] ?? 35 : 35;
    if (app.investment !== null) {
      if (app.investment > CONFIG.probableRupeeErrorAboveLakh) holds.push({ text: `Investment of ${app.investment} lakh (₹${(app.investment / 100).toFixed(0)} crore) is implausibly high – probably rupees typed into the lakh column.`, q: `Did you mean ₹${app.investment >= 100000 ? (app.investment / 100000).toFixed(1) : app.investment} lakh? Please confirm the amount in lakh.`, evidence: `Investment = "${raw.investment}"` });
      else if (app.investment < floorL * CONFIG.fundingHoldBand) rejects.push({ kind: "reject", text: `Investment ₹${app.investment}L is below 70% of the ₹${floorL}L floor for a ${tier} store (${Math.round((app.investment / floorL) * 100)}%).`, evidence: `Investment = ${raw.investment}` });
      else if (app.investment < floorL) holds.push({ text: `Investment ₹${app.investment}L is ${Math.round((app.investment / floorL) * 100)}% of the ₹${floorL}L floor for ${tier}.`, q: `Can you arrange the remaining ₹${r1(floorL - app.investment)} lakh through a loan or co-investor?`, evidence: `Investment = ${raw.investment}` });
    }
    // space contradictions
    if (app.space === "Not yet identified") {
      if (app.size !== null) holds.push({ text: `Space is "Not yet identified" but a size of ${app.size} sq ft is filled in.`, q: "Have you found a space? If yes, is it owned or rented, and on which floor?", evidence: `Space = Not yet identified, Size = ${raw.size}` });
      else holds.push({ text: "No site identified yet – held until a site is found (held applicants never take a slot).", q: "Have you found a shop space yet? Tell us owned/rented, size and floor." });
    } else if ((app.space === "Owned" || app.space === "Rented") && app.size === null && !app.sizeToConfirm) {
      holds.push({ text: `Space is "${app.space}" but the size is blank.`, q: "What is the size of the space in sq ft?", evidence: `Space = ${app.space}, Size = blank` });
    }
    if ((app.space === "Owned" || app.space === "Rented") && insight.spaceContradiction && !patchMap.has(raw.id)) holds.push({ text: `Space field says "${app.space}" but the applicant wrote "${insight.spaceQuote}".`, q: "Have you actually secured this space, or are you still looking?", evidence: insight.spaceQuote });
    const spaceWarn = (app.space === "Owned" || app.space === "Rented") && insight.spaceDoubt && !insight.spaceContradiction && !patchMap.has(raw.id);
    // experience contradictions
    if (vagueFamily) reasons.push({ kind: "info", text: "Family-shop mention without personal years stated – no experience or retail-background credit (scored as no relevant background).", evidence: famQ });
    // clearly stated personal years (e.g. "my father's shop, I have been running it for 3 years") with 0 entered => contradiction hold, even if it is the family's shop
    if (app.experience === 0 && famQ && yrsM) { const n = parseInt(yrsM[1], 10); holds.push({ text: `Experience field says 0 years but the applicant wrote "${famQ.includes(yrsM[0]) ? famQ : yrsM[0]}".`, q: `Please confirm your own retail experience – is it ${n} years?`, evidence: yrsM[0] }); }
    else if (app.experience === 0 && !famQ && insight.statedOwnYears && insight.statedOwnYears > 0 && !insight.familyNotOwn) holds.push({ text: `Experience field says 0 years but the applicant wrote "${insight.statedQuote}".`, q: `Please confirm your own retail experience – is it ${insight.statedOwnYears} years?`, evidence: insight.statedQuote });
    else if (app.experience === 0 && !famQ && insight.statedQuote && !insight.familyNotOwn && insight.background === "direct_retail") holds.push({ text: `Experience field says 0 years but the applicant wrote "${insight.statedQuote}".`, q: "Please confirm how many years you have run or managed a shop yourself.", evidence: insight.statedQuote });
    if ((app.experience ?? 0) > 0 && insight.familyNotOwn) holds.push({ text: `Experience may be family experience rather than the applicant's own: "${insight.familyQuote}".`, q: `Are the ${app.experience} years your own experience running the shop, or a family member's?`, evidence: insight.familyQuote });
    for (const rf of insight.redFlags) holds.push({ text: `Red flag for human review: ${rf.text}.`, q: "Brand team to review this statement with the applicant.", evidence: rf.quote });

    base.territoryId = ter?.id || null; base.tier = tier; base.priority = ter ? normPriority(ter.priority) : null;
    if (spaceWarn) reasons.push({ kind: "warning", text: `Has a ${app.space.toLowerCase()} space but mentions looking for a better location – not a hold; confirm the final site before fit-out.`, evidence: insight.spaceDoubtQuote });
    if (insight.timing[0]) reasons.push({ kind: "info", text: `Timing signal: ${insight.timing[0].text}`, evidence: insight.timing[0].quote });
    if (insight.funding[0]) reasons.push({ kind: "info", text: `Funding signal: ${insight.funding[0].text}`, evidence: insight.funding[0].quote });

    const onb = buildOnboarding(app, floorL, insight, today);
    const nearExisting = /^\d{6}$/.test(pin) ? nearest(pin, input.stores.map((s) => ({ id: s.id, pin: s.pin }))) : null;
    base.nearestStore = nearExisting ? { storeId: nearExisting.storeId, km: nearExisting.km, label: `~${nearExisting.km} km from ${nearExisting.storeId} (approximate)` } : { storeId: "", km: null, label: "Distance unknown (no coordinates for this pin)" };
    if (rejects.length) {
      reasons.push(...rejects);
      base.status = "Rejected"; base.eligible = false; base.readiness = "Not eligible";
      base.headline = rejects[0].text;
      const cityOpen = input.territories.filter((t) => normCity(t.city).city === app.city).flatMap((t) => t.pins.filter((p) => !storePins.has(p)));
      if (/not expanding|already has brand store/.test(rejects[0].text) && cityOpen.length) base.headline += ` Open territory pins in ${app.city}: ${cityOpen.join(", ")} – the applicant could reapply for one of these.`;
      base.nextActions = [/not expanding|already has/.test(rejects[0].text) ? (cityOpen.length ? `Invite to reapply for an open pin in ${app.city}: ${cityOpen.join(", ")}` : `No open territory pins in ${app.city} right now – keep on file`) : /Investment/.test(rejects[0].text) ? `Could reapply with at least ₹${floorL} lakh (or ₹${r1(floorL * 0.7)} lakh plus a loan plan)` : "Send a polite decline explaining the reason"];
      decisions.push(base); return;
    }
    if (holds.length) {
      for (const h of holds) reasons.push({ kind: "hold", text: h.text + ` Question: ${h.q}`, evidence: h.evidence });
      base.status = "On hold"; base.eligible = false;
      base.readiness = holds.some((h) => /No site identified/.test(h.text)) && holds.length === 1 ? "Needs a site" : "Blocked by a question";
      base.headline = holds[0].text; base.question = holds[0].q;
      base.nextActions = holds.map((h) => h.q);
      base.score = /^\d{6}$/.test(pin) && app.investment !== null ? fitScore({ ...app, investment: app.investment }, floorL, insight, onb, nearExisting?.km ?? null) : null;
      decisions.push(base); return;
    }
    base.eligible = true; base.readiness = "Ready now";
    base.score = fitScore(app, floorL, insight, onb, nearExisting?.km ?? null);
    base.onboarding = onb;
    base.payback = payback(app, tier!);
    decisions.push(base);
  });

  // ---------- Allocation ----------
  const prio = (p: string) => ({ high: 0, medium: 1, low: 2 }[(p || "").toLowerCase()] ?? 1);
  const ters = input.territories.map((t) => ({ ...t, priority: normPriority(t.priority), tier: normTier(t.tier) || t.tier })).sort((a, b) => prio(a.priority) - prio(b.priority) || a.id.localeCompare(b.id));
  const approvedNew: { id: string; pin: string }[] = [];
  const locked = new Set((input.lockedApproved || []).map((x) => x.toUpperCase()));
  const terOut: EngineResult["territories"] = [];
  for (const t of ters) {
    const tw: string[] = [];
    const minFit = CONFIG.minFitByPriority[t.priority] ?? CONFIG.minFitByPriority.Medium;
    const pool = decisions.filter((d) => d.status !== "Rejected" && d.status !== "Invalid record" && d.eligible && d.territoryId === t.id);
    const eligible: Decision[] = [];
    for (const d of pool) {
      if ((d.score?.total ?? 0) < minFit && d.id !== input.forceApprove) {
        d.status = "On hold"; d.eligible = true; d.readiness = "Below quality bar";
        d.headline = `Fit score ${d.score?.total} is below the ${minFit} minimum for a ${t.priority}-priority territory (${t.id}).`;
        d.reasons.push({ kind: "hold", text: d.headline + " Held rather than approved just because a slot is free." });
        d.nextActions = ["Improve the weakest score areas (see breakdown) – e.g. a better site, more capital or a retail-experienced partner – then reapply"];
      } else eligible.push(d);
    }
    const approved: Decision[] = [];
    const launchDays = (d: Decision) => d.onboarding?.totalWeeks ?? 99;
    const adjScore = (d: Decision) => {
      const others = [...approvedNew].filter((x) => x.id !== d.id);
      const n = nearest(d.pin, others);
      const pen = n && n.km !== null && n.km > 0 ? proximityPenalty(n.km) : 0;
      return { s: (d.score?.total ?? 0) - pen, pen, n };
    };
    const remaining = [...eligible];
    const pinTaken = (pin: string) => approvedNew.some((x) => x.pin === pin) || storePins.has(pin);
    // locked (previously approved) and forced first
    const pickOrder = (list: Decision[]) => {
      const scored = list.map((d) => ({ d, ...adjScore(d) }));
      scored.sort((a, b) => b.s - a.s || launchDays(a.d) - launchDays(b.d) || a.d.id.localeCompare(b.d.id));
      if (scored.length > 1 && scored[0].s - scored[1].s <= CONFIG.tieWindowPoints && launchDays(scored[1].d) < launchDays(scored[0].d)) {
        const [x, y] = scored; scored[0] = y; scored[1] = x;
        y.d.reasons.push({ kind: "allocation", text: `Tie-break: scores within ${CONFIG.tieWindowPoints} points of ${x.d.id} (${r1(y.s)} vs ${r1(x.s)}); ${y.d.id} can launch sooner (${launchDays(y.d)} vs ${launchDays(x.d)} weeks), so it ranks first.` });
        x.d.reasons.push({ kind: "allocation", text: `Tie-break: within ${CONFIG.tieWindowPoints} points of ${y.d.id}, which can launch sooner (${launchDays(y.d)} vs ${launchDays(x.d)} weeks).` });
      }
      return scored;
    };
    const approve = (d: Decision, why: string, pen: number, n: { storeId: string; km: number | null } | null) => {
      d.status = "Approved"; approved.push(d); approvedNew.push({ id: d.id, pin: d.pin });
      if (pen && d.score) { d.score.proximityPenalty = r1(d.score.proximityPenalty + pen); d.score.total = r1(d.score.total - pen); d.score.notes.proximity += `; −${pen} for being ~${n?.km} km from newly approved ${n?.storeId}`; }
      d.reasons.push({ kind: "allocation", text: why });
    };
    // 1) honour locked approvals (never silently un-approve)
    const lockedHere = remaining.filter((d) => locked.has(d.id) || d.id === input.forceApprove);
    for (const d of lockedHere) {
      if (approved.length >= t.slots || pinTaken(d.pin)) continue;
      remaining.splice(remaining.indexOf(d), 1);
      const la = adjScore(d);
      approve(d, d.id === input.forceApprove ? `What-if: ${d.id} forced into a slot in ${t.id}.` : `Kept approved in ${t.id} (approved before this update; approvals are never silently removed).`, la.pen, la.n);
      d.headline = `Approved for ${t.id}: fit score ${d.score?.total}/100${d.id === input.forceApprove ? " (what-if: forced)" : ", kept from the previous run"}; pin ${d.pin}.`;
    }
    // 2) fill remaining slots by rank
    while (remaining.length) {
      const order = pickOrder(remaining);
      const top = order[0]; remaining.splice(remaining.indexOf(top.d), 1);
      const d = top.d;
      if (pinTaken(d.pin)) {
        const holder = approvedNew.find((x) => x.pin === d.pin);
        const free = t.pins.filter((p) => !pinTaken(p));
        d.status = "Waitlisted"; tw.push(d.id);
        d.headline = `Pin ${d.pin} is already allocated to ${holder?.id} (higher fit score); only one store per pin.${free.length ? ` Free pins in ${t.id}: ${free.join(", ")}.` : ""}`;
        d.reasons.push({ kind: "allocation", text: d.headline });
        continue;
      }
      if (approved.length < t.slots) {
        approve(d, `Ranked #${approved.length + 1} in ${t.id} with fit score ${r1(top.s)} (minimum ${minFit} for ${t.priority} priority); ${t.slots} slot(s) available.`, top.pen, top.n);
        d.headline = `Approved for ${t.id}: fit score ${d.score?.total}/100, rank ${approved.length} of ${t.slots} slot(s), pin ${d.pin} is free.`;
      } else {
        d.status = "Waitlisted"; tw.push(d.id);
        if (top.pen && d.score) { d.score.proximityPenalty = r1(d.score.proximityPenalty + top.pen); d.score.total = r1(d.score.total - top.pen); d.score.notes.proximity += `; −${top.pen} for being ~${top.n?.km} km from newly approved ${top.n?.storeId}`; }
        const lockedBumped = approved.filter((x) => locked.has(x.id) && (x.score?.total ?? 0) < r1(top.s));
        d.headline = `All ${t.slots} slot(s) in ${t.id} are filled by higher-ranked applicants; fit score ${r1(top.s)}.`;
        if (lockedBumped.length) {
          const lb = lockedBumped[lockedBumped.length - 1];
          lb.bumpFlag = `${d.id} now outranks this partner (${r1(top.s)} vs ${lb.score?.total}). Kept Approved – flagged for human review rather than silently un-approved.`;
          d.headline = `Would outrank already-approved ${lb.id} (${r1(top.s)} vs ${lb.score?.total}) but approvals are not silently removed – flagged for human review.`;
        }
        d.reasons.push({ kind: "allocation", text: d.headline });
      }
    }
    tw.forEach((id, i) => { const d = decisions.find((x) => x.id === id)!; d.waitlistRank = i + 1; d.readiness = "Ready – waiting for a slot"; d.nextActions = [`Waitlist #${i + 1} in ${t.id}: moves up automatically if an approved partner drops out or a slot opens`, "Keep the site and funds available; re-confirm in 30 days"]; if (d.headline.startsWith("Pin")) d.nextActions.unshift(`Consider switching to a free pin in ${t.id}`); });
    for (const d of approved) d.nextActions = (d.onboarding?.stages || []).map((s) => `${s.name}${s.weeks ? ` (${s.weeks} wk)` : ""}`);
    const tWarn: string[] = [];
    const nStorePins = t.pins.filter((p) => storePins.has(p));
    if (nStorePins.length) tWarn.push(`Pins with an existing store (cannot be used): ${nStorePins.join(", ")}`);
    if (!approved.length && t.slots > 0) tWarn.push("No applicant approved – slots stay open.");
    terOut.push({ ...t, approved: approved.map((d) => d.id), waitlisted: tw, filled: approved.length, warnings: tWarn });
  }
  for (const d of decisions) if (d.status === "On hold" && d.eligible && !d.headline) d.headline = "On hold";
  // eligible but territory missing (shouldn't happen) safety
  for (const d of decisions) if (d.eligible && d.status === "On hold" && d.readiness === "Ready now") { d.status = "On hold"; d.headline = "Eligible but no territory found for this pin."; }
  const counts: Record<string, number> = { Approved: 0, Waitlisted: 0, "On hold": 0, Rejected: 0, "Invalid record": 0 };
  for (const d of decisions) {
    counts[d.status]++;
    if ((d.status === "Approved" || d.status === "Waitlisted") && d.reasons.some((r) => r.kind === "warning" && /better location/.test(r.text))) d.nextActions.push("Confirm the final shop address before fit-out (applicant mentioned looking for a better location)");
  }
  return { decisions, territories: terOut, warnings, counts };
}

export function diffResults(before: EngineResult, after: EngineResult) {
  const changes: { id: string; from: string; to: string; why: string }[] = [];
  for (const a of after.decisions) {
    const b = before.decisions.find((x) => x.id === a.id);
    if (!b) { changes.push({ id: a.id, from: "—", to: a.status, why: a.headline }); continue; }
    if (b.status !== a.status || (b.score?.total ?? null) !== (a.score?.total ?? null) || b.bumpFlag !== a.bumpFlag) changes.push({ id: a.id, from: `${b.status}${b.score ? ` (${b.score.total})` : ""}`, to: `${a.status}${a.score ? ` (${a.score.total})` : ""}${a.bumpFlag ? " ⚑ bump flagged" : ""}`, why: a.bumpFlag || a.headline });
  }
  return changes;
}
