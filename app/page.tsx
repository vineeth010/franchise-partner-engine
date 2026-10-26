"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { parseWorkbook, type ParsedWorkbook } from "@/lib/parse";
import { runEngine, diffResults, CITY_REF } from "@/lib/engine";
import { keywordInsight } from "@/lib/text";
import { CONFIG } from "@/lib/config";
import ref from "@/lib/data/reference.json";
import type { Decision, EngineResult, Patch, RawApplication, TextInsight } from "@/lib/types";

type Msg = { role: "u" | "a"; text: string };
type Preview = { patches: Patch[]; before: EngineResult; after: EngineResult; kind: "update" | "whatif"; force?: string };
type LogEntry = { time: string; kind: string; text: string; changes: { id: string; from: string; to: string; why: string }[] };
const FIELDS: (keyof RawApplication)[] = ["name", "city", "state", "pin", "investment", "experience", "business", "space", "size", "floor", "target", "language", "notes"];
const STATUSES = ["Approved", "Waitlisted", "On hold", "Rejected", "Invalid record"];
const chipCls = (s: string) => "chip c-" + s.split(" ")[0];
// All Gemini calls go through here. If a passcode gate is enabled server-side (APP_PASSCODE), the code is sent as a header.
async function api(path: string, body: unknown) {
  const pc = typeof window !== "undefined" ? window.localStorage.getItem("appPasscode") || "" : "";
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...(pc ? { "x-app-passcode": pc } : {}) }, body: JSON.stringify(body) });
  if (res.status === 401 && typeof window !== "undefined") {
    const entered = window.prompt("This demo's AI features are protected. Enter the passcode:");
    if (entered) { window.localStorage.setItem("appPasscode", entered); return api(path, body); }
  }
  return res;
}
const now = () => new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST";

export default function Home() {
  const [wb, setWb] = useState<ParsedWorkbook | null>(null);
  const [fileName, setFileName] = useState("");
  const [insights, setInsights] = useState<Record<string, TextInsight>>({});
  const [textSource, setTextSource] = useState("");
  const [patches, setPatches] = useState<Patch[]>([]);
  const [locked, setLocked] = useState<string[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [tab, setTab] = useState("overview");
  const [filter, setFilter] = useState("All");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Decision | null>(null);
  const [busy, setBusy] = useState("");
  const [over, setOver] = useState(false);
  const [welcome, setWelcome] = useState<Record<string, string>>({});
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "a", text: "Ask about any applicant or territory (e.g. \"Why is APP-007 on hold?\", \"Who is approved in Mysuru?\"). Report an update (\"APP-012 found a rented ground-floor shop of 650 sq ft\") – I'll show a preview and apply it only when you confirm. Try what-ifs too (\"What if APP-005 had 45 lakh?\")." }]);
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = useCallback((p: Patch[], lk: string[], ins = insights, extra?: { forceApprove?: string }) => {
    if (!wb) return null;
    const patchedIds = new Set(p.filter((x) => x.field === "notes" || x.field === "business").map((x) => x.appId.toUpperCase()));
    const ins2 = Object.fromEntries(Object.entries(ins).filter(([k]) => !patchedIds.has(k)));
    return runEngine({ apps: wb.apps, territories: wb.territories, stores: wb.stores, insights: ins2, patches: p, lockedApproved: lk, forceApprove: extra?.forceApprove, parseWarnings: [...wb.warnings, `Existing stores: ${wb.storesSource}.`] });
  }, [wb, insights]);
  const result = useMemo(() => run(patches, locked), [run, patches, locked]);
  const slotsFilled = result ? result.territories.reduce((a, t) => a + t.filled, 0) : 0;
  const slotsTotal = result ? result.territories.reduce((a, t) => a + t.slots, 0) : 0;

  async function fetchWelcome(res: EngineResult) {
    const approved = res.decisions.filter((d) => d.status === "Approved");
    if (!approved.length) return;
    try {
      const r = await api("/api/welcome", { items: approved.map((d) => ({ id: d.id, name: d.name, city: d.city, territory: d.territoryId, language: d.onboarding?.trainingLanguage, launchDate: d.onboarding?.realisticDate, firstStep: "Sign the agreement and submit KYC documents" })) });
      const j = await r.json();
      setWelcome(Object.fromEntries((j.notes || []).map((n: { id: string; note: string }) => [n.id, n.note])));
    } catch { /* template fallback is used */ }
  }

  async function load(buf: ArrayBuffer, name: string) {
    setBusy("Reading workbook…");
    const parsed = parseWorkbook(new Uint8Array(buf));
    setWb(parsed); setFileName(name); setPatches([]); setLocked([]); setWelcome({}); setSel(null); setPreview(null);
    setLog([{ time: now(), kind: "Upload", text: `Loaded ${name}: ${parsed.apps.length} application rows, ${parsed.territories.length} territories, existing stores from ${parsed.storesSource}.`, changes: [] }]);
    setInsights({}); setTextSource("keywords (reading notes with Gemini…)");
    setBusy("Reading free-text notes with Gemini…");
    try {
      const r = await api("/api/extract", { items: parsed.apps.filter((a) => a.id).map((a) => ({ id: a.id.trim().toUpperCase().replace(/\s+/g, ""), business: a.business, notes: a.notes })) });
      const j = await r.json();
      setInsights(j.insights || {});
      const n = Object.values(j.insights || {}).filter((x) => (x as TextInsight).source === "gemini").length;
      setTextSource(n ? `Gemini (${j.model}) for ${n} rows, keyword rules for the rest` : "keyword rules (Gemini unavailable)");
      const res = runEngine({ apps: parsed.apps, territories: parsed.territories, stores: parsed.stores, insights: j.insights || {}, parseWarnings: parsed.warnings });
      fetchWelcome(res);
    } catch { setTextSource("keyword rules (Gemini unavailable)"); }
    setBusy("");
  }
  async function loadSample(f: string) { const r = await fetch(`/${f}`); load(await r.arrayBuffer(), f); }
  function onFile(f?: File | null) { if (f) f.arrayBuffer().then((b) => load(b, f.name)); }

  // ---------- chat ----------
  function context() {
    if (!result) return {};
    return {
      counts: result.counts,
      territories: result.territories.map((t) => ({ id: t.id, city: t.city, pins: t.pins, tier: t.tier, slots: t.slots, priority: t.priority, approved: t.approved, waitlisted: t.waitlisted })),
      applicants: result.decisions.map((d) => ({ id: d.id, name: d.name, city: d.city, pin: d.pin, territory: d.territoryId, status: d.status, waitlistRank: d.waitlistRank, headline: d.headline, question: d.question, score: d.score?.total, breakdown: d.score ? { capital: d.score.capital, site: d.score.site, experience: d.score.experience, background: d.score.background, timeline: d.score.timeline, proximityPenalty: d.score.proximityPenalty } : null, reasons: d.reasons.map((r) => r.text), nextActions: d.nextActions, launch: d.onboarding?.realisticDate, bumpFlag: d.bumpFlag, fields: d.app ? FIELDS.reduce((o, f) => ({ ...o, [f]: (d.app as unknown as Record<string, unknown>)[f] }), {}) : null })),
      warnings: result.warnings,
    };
  }
  function regexFallback(m: string): { intent: string; answer: string; patches: Patch[]; forceApprove?: string | null } {
    const id = (m.match(/app[-\s]?\d+/i)?.[0] || "").toUpperCase().replace(/\s/, "-");
    const d = result?.decisions.find((x) => x.id === id);
    const upd = m.match(/(?:set|change|update)\s+(app[-\s]?\d+)\s+(\w+)\s+(?:to|=)\s+(.+)/i);
    if (upd) { const f = upd[2].toLowerCase() as keyof RawApplication; if (FIELDS.includes(f)) return { intent: /what if/i.test(m) ? "whatif" : "update", answer: "(Offline mode) Parsed your update with simple rules.", patches: [{ appId: upd[1].toUpperCase().replace(/\s/, "-"), field: f, newValue: upd[3].trim() }] }; }
    if (d) return { intent: "question", answer: `(Offline mode) ${d.id} ${d.name}: ${d.status}${d.waitlistRank ? ` #${d.waitlistRank}` : ""}. ${d.headline}${d.score ? ` Fit score ${d.score.total}.` : ""}`, patches: [] };
    const st = STATUSES.find((s) => m.toLowerCase().includes(s.toLowerCase().split(" ")[0]));
    if (st && result) return { intent: "question", answer: `(Offline mode) ${st}: ${result.decisions.filter((x) => x.status === st).map((x) => x.id).join(", ") || "none"}`, patches: [] };
    return { intent: "question", answer: "(Offline mode) Gemini is unavailable. Try \"APP-007\" or \"set APP-012 space to Rented\".", patches: [] };
  }
  async function send(txt?: string) {
    const m = (txt ?? input).trim(); if (!m || !result) return;
    setInput(""); setMsgs((x) => [...x, { role: "u", text: m }]); setBusy("Thinking…");
    let r: { intent: string; answer: string; patches: Patch[]; forceApprove?: string | null };
    try { const res = await api("/api/chat", { message: m, context: context() }); if (!res.ok) throw 0; r = await res.json(); }
    catch { r = regexFallback(m); }
    setBusy("");
    const ps = (r.patches || []).filter((p) => FIELDS.includes(p.field) && result.decisions.some((d) => d.id === String(p.appId).toUpperCase())).map((p) => ({ ...p, appId: String(p.appId).toUpperCase(), newValue: String(p.newValue) }));
    if ((r.intent === "update" || r.intent === "whatif") && (ps.length || r.forceApprove)) {
      const currentApproved = result.decisions.filter((d) => d.status === "Approved").map((d) => d.id);
      const lk = Array.from(new Set([...locked, ...currentApproved]));
      const after = run([...patches, ...ps], lk, insights, { forceApprove: r.forceApprove || undefined })!;
      setPreview({ patches: ps, before: result, after, kind: r.intent === "whatif" ? "whatif" : "update", force: r.forceApprove || undefined });
      setMsgs((x) => [...x, { role: "a", text: (r.answer ? r.answer + "\n\n" : "") + (r.intent === "whatif" ? "Simulation below – nothing is saved." : "Preview below – press Confirm to apply, or Cancel.") }]);
    } else setMsgs((x) => [...x, { role: "a", text: r.answer || "I couldn't find that in the records." }]);
  }
  function confirm() {
    if (!preview || !result) return;
    const lk = Array.from(new Set([...locked, ...result.decisions.filter((d) => d.status === "Approved").map((d) => d.id)]));
    const np = [...patches, ...preview.patches];
    setLocked(lk); setPatches(np);
    const ch = diffResults(preview.before, preview.after);
    setLog((l) => [...l, { time: now(), kind: "Chat update (confirmed)", text: preview.patches.map((p) => `${p.appId}.${p.field}: "${oldVal(p)}" → "${p.newValue}"`).join("; "), changes: ch }]);
    setMsgs((x) => [...x, { role: "a", text: `Applied. ${ch.length} decision(s) changed:\n` + ch.map((c) => `• ${c.id}: ${c.from} → ${c.to}`).join("\n") }]);
    setPreview(null); fetchWelcome(preview.after);
  }
  function oldVal(p: Patch) { const raw = wb?.apps.find((a) => a.id.trim().toUpperCase().replace(/\s+/g, "") === p.appId); const prev = [...patches].reverse().find((x) => x.appId === p.appId && x.field === p.field); return prev ? prev.newValue : raw ? (raw as unknown as Record<string, string>)[p.field] : ""; }

  function exportCsv() {
    if (!result) return;
    const rows = [["Application ID", "Name", "City", "Pin", "Territory", "Status", "Waitlist rank", "Fit score", "Headline", "Question", "Next actions", "Realistic launch"], ...result.decisions.map((d) => [d.id, d.name, d.city, d.pin, d.territoryId || "", d.status, d.waitlistRank ?? "", d.score?.total ?? "", d.headline, d.question || "", d.nextActions.join(" | "), d.onboarding?.realisticDate || ""])];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" })); a.download = "franchise-decisions.csv"; a.click();
  }

  const shown = (result?.decisions || []).filter((d) => (filter === "All" || d.status === filter) && (!q || JSON.stringify([d.id, d.name, d.city, d.pin, d.territoryId]).toLowerCase().includes(q.toLowerCase())));
  const welcomeFor = (d: Decision) => welcome[d.id] || (d.onboarding?.trainingLanguage === "Kannada" ? `ನಮಸ್ಕಾರ ${d.name}! ${d.city} ನಲ್ಲಿ ನಮ್ಮ ಫ್ರಾಂಚೈಸಿ ಪಾಲುದಾರರಾಗಿ ಆಯ್ಕೆಯಾಗಿದ್ದಕ್ಕೆ ಅಭಿನಂದನೆಗಳು. ಮೊದಲ ಹೆಜ್ಜೆ: ಒಪ್ಪಂದ ಮತ್ತು KYC. ಅಂದಾಜು ಆರಂಭ ದಿನಾಂಕ: ${d.onboarding?.realisticDate}.` : d.onboarding?.trainingLanguage === "Hindi" ? `नमस्ते ${d.name}! ${d.city} में हमारे फ्रैंचाइज़ी पार्टनर के रूप में चुने जाने पर बधाई। पहला कदम: अनुबंध और KYC। अनुमानित शुरुआत: ${d.onboarding?.realisticDate}.` : `Welcome aboard, ${d.name}! You have been selected as our franchise partner in ${d.city}. First step: sign the agreement and complete KYC. Realistic opening date: ${d.onboarding?.realisticDate}.`) + (welcome[d.id] ? "" : " (template)");

  const statusOf = (k: string) => (k === "All" ? "All" : k.split(" ")[0]);
  const drawer = sel && result ? result.decisions.find((x) => x.id === sel.id) || sel : null;
  const initials = (n: string) => (n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const scoreCls = (s?: number) => (s == null ? "" : s >= 70 ? " hi" : s >= 50 ? " mid" : " lo");
  const reset = () => { setWb(null); setFileName(""); setSel(null); setPreview(null); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const approvedN = result?.counts["Approved"] || 0;
  return (
    <>
    <nav className={"topnav" + (wb ? " solid" : "")}><div className="topnav-in">
      <a className="brand" href="#" onClick={(e) => { e.preventDefault(); reset(); }}><span className="logo" aria-hidden="true">P</span><span><b>PartnerScope</b><small>Franchise partner engine</small></span></a>
      {!wb && <div className="navlinks"><a href="#how">How it works</a><a href="#features">Why partner</a><a href="#scoring">Scoring</a><a href="#cities">Territories</a><a href="#faq">FAQ</a></div>}
      <div className="navcta">{result ? <><button className="btn ghost hide-sm" onClick={exportCsv}><Icon n="download" />Export CSV</button><button className="btn primary" onClick={reset}><Icon n="upload" />New upload</button></> : <><button className="btn ghost hide-sm" onClick={() => loadSample("test_1_mixed_traps.xlsx")}>Try sample</button><button className="btn primary" onClick={() => fileRef.current?.click()}><Icon n="upload" />Upload Excel</button></>}</div>
    </div></nav>
    <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />

    {!wb && <main className="landing">
      <section className="hero">
        <div className="glow g1" /><div className="glow g2" /><div className="grid-bg" />
        <div className="hero-in">
          <div className="hero-l rise">
            <span className="pill"><span className="dot" />Franchise expansion, on autopilot</span>
            <div className="greet" lang="kn">Namaskara · ನಮಸ್ಕಾರ</div>
            <h1 className="hero-t g">The right partners.<br />The right pin codes.<br /><em>Open stores faster.</em></h1>
            <p className="hero-s">Upload your applications sheet and PartnerScope screens every applicant, fills each territory slot by slot, guards against cannibalisation, and hands every approved partner a week-by-week launch plan &mdash; in Kannada, Hindi or English.</p>
            <div className="hero-cta"><button className="btn aqua lg" onClick={() => loadSample("test_1_mixed_traps.xlsx")}>See it decide in 10 seconds <Icon n="arrow" /></button><button className="btn glass lg" onClick={() => fileRef.current?.click()}><Icon n="upload" />Upload your Excel</button></div>
            <div className="trust">{[["shield", "1 store per pin, guaranteed"], ["check", "Every decision explained"], ["globe", "ಕನ್ನಡ · हिंदी · English"]].map(([i, t]) => <span key={t}><Icon n={i} />{t}</span>)}</div>
          </div>
          <div className="hero-r rise d2">
            <div className="upcard">
              <div className="upcard-h"><span className="lights"><i /><i /><i /></span><span>New intake</span></div>
              <div className={"drop" + (over ? " over" : "")} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files[0]); }} onClick={() => fileRef.current?.click()}>
                <div className="drop-ic"><Icon n="file" /></div>
                <b>Drop the filled-in template</b>
                <div className="muted">.xlsx with <i>Applications</i> &amp; <i>Territories</i> sheets. The 10 existing stores are built in.</div>
              </div>
              <div className="or"><span>or explore a sample</span></div>
              <div className="samples">
                {[["test_1_mixed_traps.xlsx", "Mixed traps", "Contradictions, missing sites, example row"], ["test_2_dirty_data.xlsx", "Dirty data", "Typos, ₹ amounts, odd pins, no store sheet"], ["test_3_competition.xlsx", "Slot competition", "Many applicants chasing few slots"]].map(([f, t, d], i) => <button key={f} className="sample" onClick={() => loadSample(f)}><span className="sn">0{i + 1}</span><span><b>{t}</b><small>{d}</small></span><Icon n="arrow" /></button>)}
              </div>
              {busy && <div className="busy"><span className="spin" />{busy}</div>}
            </div>
            <div className="float f1"><span className="chip c-Approved">Approved</span><b>Fit score 82/100</b><small>Ranked #1 of 2 slots in a High-priority territory</small></div>
            <div className="float f2"><span className="chip c-On">On hold</span><b>“Still looking for a shop”</b><small>Ask: confirm a site before fit-out</small></div>
          </div>
        </div>
      </section>

      <section className="stats">{[["<10s", "from upload to a decision for every applicant"], ["100%", "of decisions carry reasons & evidence"], ["0", "pin codes ever double-booked"], ["3", "training languages, chosen by the partner"]].map(([n, t]) => <div key={t} className="stat"><b>{n}</b><span>{t}</span></div>)}</section>

      <section id="how" className="sec">
        <div className="sec-h"><span className="eyebrow">How it works</span><h2>From a messy spreadsheet to opened stores</h2><p>Three steps that take the partner journey off the expansion team&rsquo;s plate.</p></div>
        <div className="how">{[["upload", "Upload", "Drop the template as-is. Messy cities, pin codes, ₹ amounts, duplicates and example rows are cleaned automatically &mdash; and every fix is logged."], ["target", "Decide", "Deterministic rules approve, waitlist, hold (with the exact question to ask) or reject. Territories fill High → Medium → Low priority, best fit first."], ["chat", "Refine", "Ask why, report new information or run a what-if in plain language. Updates preview first and never silently un-approve a partner."], ["rocket", "Onboard", "Approved partners get a week-by-week plan, a realistic opening date, a payback range and a welcome note in their own language."]].map(([i, t, d], k) => <div key={t} className="howc"><div className="howi"><Icon n={i} /></div><span className="step-n">Step {k + 1}</span><h3>{t}</h3><p dangerouslySetInnerHTML={{ __html: d }} /></div>)}</div>
      </section>

      <section id="features" className="sec alt">
        <div className="sec-h"><span className="eyebrow">Built for expansion teams</span><h2>Everything a franchise desk does, in one screen</h2></div>
        <div className="feats">{[["map", "Geo-smart allocation", "Applicants are matched to territories by pin code. One store per pin, never on top of an existing store, never more approvals than slots."], ["radar", "Cannibalisation guard", "Distance to every existing and newly approved store is checked. Close neighbours lose points before they lose sales."], ["gauge", "Explainable fit score", "Capital, site, experience, background and timeline add up to 100 &mdash; with the note behind every point."], ["chat", "Ask, update, simulate", "“Why is APP-007 on hold?” “APP-012 found a ground-floor shop.” Updates preview before they apply; what-ifs never save."], ["sparkle", "AI reads the free text", "Gemini reads notes in English, Kannada and Hindi and must quote exact words. Rules &mdash; not the AI &mdash; make the decision."], ["calendar", "Onboarding & payback", "KYC, funding proof, site, licences, fit-out and training in the partner’s language, plus a realistic payback range."]].map(([i, t, d]) => <div key={t} className="feat"><div className="feat-i"><Icon n={i} /></div><h3>{t}</h3><p dangerouslySetInnerHTML={{ __html: d }} /></div>)}</div>
      </section>

      <section id="scoring" className="sec alt">
        <div className="sec-h"><span className="eyebrow">Transparent scoring</span><h2>A 100-point fit score you can read line by line</h2><p>Only eligible applicants are scored. Preferred language never affects eligibility or score.</p></div>
        <div className="scoring">{(Object.entries(CONFIG.weights) as [string, number][]).map(([k, w]) => <div key={k} className="wrow"><span className="wk">{k[0].toUpperCase() + k.slice(1)}</span><div className="wbar"><i className={"s-" + k} style={{ width: `${(w / 30) * 100}%` }} /></div><b>{w}</b></div>)}<div className="wrow pen"><span className="wk">Proximity penalty</span><div className="wbar"><i style={{ width: `${(CONFIG.maxProximityPenalty / 30) * 100}%` }} /></div><b>−{CONFIG.maxProximityPenalty}</b></div>
          <div className="minfit">{Object.entries(CONFIG.minFitByPriority).map(([p, v]) => <span key={p}><b>{v}+</b> to win a {p}-priority slot</span>)}</div></div>
      </section>

      <section id="cities" className="sec">
        <div className="sec-h"><span className="eyebrow">Coverage</span><h2>Seven Karnataka cities, three tiers</h2><p>Investment floors and benchmarks are tuned to each tier.</p></div>
        <div className="cities">{[["Bengaluru", "Tier 1", "560"], ["Mysuru", "Tier 2", "570"], ["Mangaluru", "Tier 2", "575"], ["Hubballi-Dharwad", "Tier 2", "580"], ["Belagavi", "Tier 2", "590"], ["Tumakuru", "Tier 3", "572"], ["Davanagere", "Tier 3", "577"]].map(([c, t, p]) => { const s = CITY_REF.find((x) => x.city === c); return <div key={c} className="city"><div className="city-top"><b>{c}</b><span className={"tier t" + t.slice(-1)}>{t}</span></div><small>Pins {p}xxx · {s?.existing_store_count ?? 0} store{s?.existing_store_count === "1" ? "" : "s"} today</small><div className="floor">Min. investment <b>₹{CONFIG.investmentFloorLakh[t]} lakh</b></div></div>; })}</div>
      </section>

      <section id="faq" className="sec alt">
        <div className="sec-h"><span className="eyebrow">Method</span><h2>Transparent by design</h2></div>
        <div className="faq">{[["Who makes the decision?", "Deterministic rules. The same file always gives the same result, and every outcome lists the rule and the evidence behind it."], ["What does the AI do?", "Only three things: read free-text notes (with exact quotes), draft welcome notes in the partner’s language, and interpret chat messages into previews."], ["What happens to contradictions?", "Text never overwrites a structured field. A contradiction creates an On hold with the precise question to ask the applicant."], ["Can approvals flip silently?", "Never. If new information means someone now outranks an approved partner, the approval stays and is flagged for review."]].map(([q, a]) => <details key={q} className="qa"><summary>{q}<Icon n="plus" /></summary><p>{a}</p></details>)}</div>
      </section>

      <section className="cta-band"><div className="cta-in"><div><h2>Ready to see every applicant decided?</h2><p>No login. Use a sample or your own file &mdash; nothing leaves your browser except free text sent to the AI reader.</p></div><div className="hero-cta"><button className="btn aqua lg" onClick={() => loadSample("test_1_mixed_traps.xlsx")}>Try sample data <Icon n="arrow" /></button><button className="btn glass lg" onClick={() => fileRef.current?.click()}>Upload Excel</button></div></div></section>
    </main>}

    {wb && result && <main className="dash">
      <div className="dash-head"><div className="dash-head-in">
        <div><span className="eyebrow light">Case 1 · Acquisition, geo-selection &amp; onboarding</span><h1>Partner decisions</h1>
          <div className="dmeta"><span><Icon n="file" />{fileName}</span><span><Icon n="sparkle" />{textSource}</span>{busy && <span className="live"><span className="spin sm" />{busy}</span>}</div></div>
        <div className="headkpi"><div><b>{approvedN}</b><span>approved</span></div><div><b>{slotsFilled}<small>/{slotsTotal}</small></b><span>slots filled</span></div><div><b>{result.territories.length}</b><span>territories</span></div></div>
      </div></div>
      <div className="wrap">
        <div className="tiles">
          {[["All", result.decisions.length], ...STATUSES.map((s) => [s, result.counts[s]])].map(([k, v]) => <button key={k} className={`tile t-${statusOf(String(k))}` + (filter === k ? " on" : "")} onClick={() => { setFilter(String(k)); setTab("decisions"); }}><span className="lbl"><i className="tdot" />{k === "All" ? "All applications" : k}</span><b>{v}</b><div className="tbar"><i style={{ width: `${k === "All" ? 100 : result.decisions.length ? (Number(v) / result.decisions.length) * 100 : 0}%` }} /></div><span className="pct">{k === "All" ? `${result.decisions.length} rows processed` : `${result.decisions.length ? Math.round((Number(v) / result.decisions.length) * 100) : 0}% of applicants`}</span></button>)}
        </div>
        <div className="layout">
          <div>
            <div className="tabs">{[["overview", "Overview", "gauge"], ["decisions", "Applicants", "list"], ["territories", "Territories", "map"], ["onboarding", "Onboarding", "rocket"], ["log", `Change log · ${log.length}`, "clock"], ["assumptions", "Method & sources", "book"]].map(([k, l, i]) => <button key={k} className={"tab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}><Icon n={i} />{l}</button>)}</div>
            {tab === "decisions" && <div className="card flush">
              <div className="toolbar"><div className="search"><Icon n="search" /><input placeholder="Search ID, name, city, pin or territory" value={q} onChange={(e) => setQ(e.target.value)} /></div><select value={filter} onChange={(e) => setFilter(e.target.value)}><option>All</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select><span className="count">{shown.length} shown</span></div>
              <div className="tablewrap"><table><thead><tr><th>Applicant</th><th>Location</th><th>Territory</th><th>Status</th><th>Fit</th><th>Why</th></tr></thead><tbody>
                {shown.map((d) => <tr key={d.id} className="click" onClick={() => setSel(d)}><td><div className="who"><span className={"av2 a-" + statusOf(d.status)}>{initials(d.name)}</span><div><b>{d.name || "—"}</b><div className="id">{d.id}</div></div></div></td><td>{d.city || "—"}<div className="muted">{d.pin}</div></td><td className="id">{d.territoryId || "—"}</td><td><span className={chipCls(d.status)}>{d.status}{d.waitlistRank ? ` #${d.waitlistRank}` : ""}</span>{d.bumpFlag && <div className="flag">⚑ Needs review</div>}</td><td>{d.score ? <span className={"sc" + scoreCls(d.score.total)}>{d.score.total}</span> : <span className="muted">—</span>}</td><td className="why">{d.headline}{d.question && <div className="ask"><Icon n="chat" />{d.question}</div>}</td></tr>)}
                {!shown.length && <tr><td colSpan={6}><div className="empty"><div className="empty-ic"><Icon n="search" /></div><b>No applicants match</b><div className="muted">Try another status or clear the search.</div><button className="btn ghost" style={{ marginTop: 12 }} onClick={() => { setFilter("All"); setQ(""); }}>Clear filters</button></div></td></tr>}
              </tbody></table></div></div>}
            {tab === "territories" && <div className="tercards">{result.territories.map((t) => <div key={t.id} className="tercard"><div className="tc-h"><span className="id">{t.id}</span><span className={"prio p-" + t.priority}>{t.priority}</span></div><b className="tc-city">{t.city}</b><span className="muted">{t.tier} · {t.pins.length} pin{t.pins.length === 1 ? "" : "s"}</span><div className="slotbar">{Array.from({ length: Math.max(t.slots, 1) }).map((_, i) => <i key={i} className={i < t.filled ? "f" : ""} />)}</div><div className="tc-f"><span><b>{t.filled}</b> / {t.slots} filled</span>{t.waitlisted.length > 0 && <span className="muted">{t.waitlisted.length} waitlisted</span>}</div>{t.approved.length > 0 && <div className="tc-ids">{t.approved.map((id) => <button key={id} className="mini" onClick={() => { const d = result.decisions.find((x) => x.id === id); if (d) setSel(d); }}>{id}</button>)}</div>}</div>)}</div>}
            {tab === "territories" && <div className="card flush"><div className="tablewrap"><table><thead><tr><th>Territory</th><th>City · tier</th><th>Priority</th><th>Pins</th><th>Slots</th><th>Approved</th><th>Waitlist</th><th>People per store*</th></tr></thead><tbody>
              {result.territories.map((t) => { const c = CITY_REF.find((x) => x.city.toLowerCase() === (t.city || "").toLowerCase()); const stores = (wb.stores.filter((s) => s.city === c?.city).length) + result.decisions.filter((d) => d.status === "Approved" && d.city === c?.city).length; return <tr key={t.id}><td className="id">{t.id}</td><td>{t.city}<div className="muted">{t.tier}</div></td><td><span className={"prio p-" + t.priority}>{t.priority}</span></td><td style={{ maxWidth: 240 }}>{t.pins.join(", ")}{t.warnings.map((w, i) => <div key={i} className="muted">⚠ {w}</div>)}</td><td className="score" style={{ minWidth: 90 }}>{t.filled} / {t.slots}<div className="bar"><i style={{ width: `${t.slots ? (t.filled / t.slots) * 100 : 0}%` }} /></div></td><td>{t.approved.join(", ") || "—"}</td><td>{t.waitlisted.join(", ") || "—"}</td><td className="score">{c && stores ? Math.round(Number(c.census_2011_ua_population) / stores).toLocaleString("en-IN") : "—"}<div className="muted">{stores ? `${stores} stores incl. new` : ""}</div></td></tr>; })}
            </tbody></table></div><p className="muted foot-note">* Census 2011 urban-agglomeration population ÷ stores in the city. Context only; never used in scoring.</p></div>}
            {tab === "log" && <div className="card"><div className="timeline">{log.map((l, i) => <div key={i} className="tl"><span className="tl-dot" /><div><b>{l.kind}</b> <span className="muted">· {l.time}</span><div>{l.text}</div>{l.changes.map((c, j) => <div key={j} className="muted">• {c.id}: {c.from} → {c.to} — {c.why}</div>)}</div></div>)}</div>
              {result.warnings.length > 0 && <><h3>Data warnings</h3><div className="warnlist">{result.warnings.map((w, i) => <div key={i}>{w}</div>)}</div></>}
              {result.decisions.some((d) => d.fixes.length) && <><h3>Automatic data fixes</h3><div className="warnlist">{result.decisions.flatMap((d) => d.fixes.map((f, i) => <div key={d.id + i}><span className="id">{d.id}</span> · {f}</div>))}</div></>}</div>}
            {tab === "assumptions" && <Assumptions />}
            {tab === "overview" && (() => { const segs = STATUSES.map((s) => [s, result.counts[s] || 0] as [string, number]); const tot = result.decisions.length || 1; let acc = 0; const grad = segs.map(([s, v]) => { const a = acc; acc += (v / tot) * 100; return `var(--st-${statusOf(s)}) ${a}% ${acc}%`; }).join(","); return <div className="ovw"><div className="card"><h3 style={{ marginTop: 0 }}>Status mix</h3><div className="donutwrap"><div className="donut" style={{ background: `conic-gradient(${grad})` }}><div><b>{result.decisions.length}</b><span>applicants</span></div></div><div className="dleg">{segs.map(([s, v]) => <button key={s} onClick={() => { setFilter(s); setTab("decisions"); }}><i style={{ background: `var(--st-${statusOf(s)})` }} />{s}<b>{v}</b></button>)}</div></div></div><div className="card"><h3 style={{ marginTop: 0 }}>Territory slots</h3>{result.territories.map((t) => <div key={t.id} className="sline"><div className="sline-h"><span><span className="id">{t.id}</span> · {t.city} <span className={"prio p-" + t.priority}>{t.priority}</span></span><span className="score">{t.filled} / {t.slots}</span></div><div className="bar"><i style={{ width: `${t.slots ? (t.filled / t.slots) * 100 : 0}%` }} /></div></div>)}</div></div>; })()}
            {tab === "onboarding" && <div className="onbl">{result.decisions.filter((d) => d.status === "Approved").map((d) => <div key={d.id} className="card onb"><div className="onb-h"><div className="who"><span className="av2 a-Approved">{initials(d.name)}</span><div><b>{d.name}</b><div className="id">{d.id} · {d.city} · {d.territoryId}</div></div></div><div className="onb-k"><b>{d.onboarding?.realisticDate}</b><span>~{d.onboarding?.totalWeeks} weeks · {d.onboarding?.trainingLanguage}</span></div></div>{d.onboarding?.gapFlag && <div className="note">{d.onboarding.gapFlag}</div>}<div className="onb-stages">{d.onboarding?.stages.map((s, i) => <span key={i} className="ost" title={s.tasks.join(" · ")}><i>{i + 1}</i>{s.name}<small>{s.weeks ? `${s.weeks} wk` : "parallel"}</small></span>)}</div><div className="welcome sm">{welcomeFor(d)}</div><button className="btn ghost sm" onClick={() => setSel(d)}>Open full plan <Icon n="arrow" /></button></div>)}{!result.decisions.some((d) => d.status === "Approved") && <div className="card empty"><b>No approved partners yet</b></div>}</div>}
            {result.warnings.length > 0 && tab === "decisions" && <details className="card warncard"><summary><Icon n="alert" />Data warnings · {result.warnings.length}</summary><div className="warnlist">{result.warnings.map((w, i) => <div key={i}>{w}</div>)}</div></details>}
          </div>
          <aside className="card chat"><div className="chat-h"><div className="av"><Icon n="sparkle" /></div><div><b>Ask, update or simulate</b><div className="muted">Answers come only from the records on screen</div></div><span className="online">Live</span></div><div className="msgs">{msgs.map((m, i) => <div key={i} className={"msg fade " + m.role}>{m.text}</div>)}
            {busy === "Thinking…" && <div className="msg a typing"><i /><i /><i /></div>}
            {msgs.length <= 1 && !preview && <div className="sugg">{["Why is APP-007 on hold?", "Who is approved in Mysuru?", "APP-012 found a rented ground-floor shop of 600 sq ft", "What if APP-005 had 40 lakh?"].map((t) => <button key={t} onClick={() => send(t)}>{t}<Icon n="arrow" /></button>)}</div>}
            {preview && <div className="preview"><b>{preview.kind === "whatif" ? "What-if simulation · not saved" : "Preview · nothing applied yet"}</b>
              {preview.patches.map((p, i) => <div key={i} style={{ marginTop: 4 }}><span className="id">{p.appId}</span> · {p.field}: <s className="muted">{oldVal(p) || "(blank)"}</s> → <b>{p.newValue}</b></div>)}{preview.force && <div>Force approve: {preview.force}</div>}
              <div style={{ marginTop: 8 }}><b>Decision changes</b>{diffResults(preview.before, preview.after).map((c, i) => <div key={i} className="muted" style={{ marginTop: 3 }}>• <span className="id">{c.id}</span>: {c.from} → {c.to}<br />{c.why}</div>)}{diffResults(preview.before, preview.after).length === 0 && <div className="muted">No decision changes.</div>}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>{preview.kind === "update" && <button className="btn primary sm" onClick={confirm}>Confirm &amp; apply</button>}<button className="btn ghost sm" onClick={() => setPreview(null)}>{preview.kind === "update" ? "Cancel" : "Close"}</button></div></div>}</div>
            <div className="chat-in"><input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Ask a question or report an update…" /><button className="send" onClick={() => send()} disabled={!!busy || !input.trim()} aria-label="Send"><Icon n="send" /></button></div></aside>
        </div>
      </div>
    </main>}

    {drawer && <><div className="drawer-bg" onClick={() => setSel(null)} /><div className="drawer">
      <div className={"dr-head a-" + statusOf(drawer.status)}>
        <button className="x" onClick={() => setSel(null)} aria-label="Close"><Icon n="x" /></button>
        <div className="who big-who"><span className="av2 lg">{initials(drawer.name)}</span><div><div className="id">{drawer.id}</div><h2>{drawer.name || "—"}</h2></div></div>
        <div className="dr-tags"><span className={chipCls(drawer.status)}>{drawer.status}{drawer.waitlistRank ? ` #${drawer.waitlistRank}` : ""}</span><span className="tag"><Icon n="pin" />{drawer.city} {drawer.pin}</span><span className="tag">{drawer.territoryId || "no territory"}{drawer.tier ? ` · ${drawer.tier}` : ""}</span><span className="tag">{drawer.readiness}</span></div>
      </div>
      <div className="dr-body">
        <p className="headline">{drawer.headline}</p>{drawer.question && <div className="note"><b>Ask the applicant:</b> {drawer.question}</div>}{drawer.bumpFlag && <div className="note">⚑ {drawer.bumpFlag}</div>}
        {drawer.score && <><h3>Fit score</h3><div className="scorehead"><div className={"ring" + scoreCls(drawer.score.total)} style={{ ["--p" as string]: drawer.score.total }}><b>{drawer.score.total}</b><span>/100</span></div><div style={{ flex: 1 }}><div className="stack">{(["capital", "site", "experience", "background", "timeline"] as const).map((k) => <i key={k} className={"s-" + k} style={{ width: `${drawer.score![k]}%` }} title={`${k} ${drawer.score![k]}`} />)}</div><div className="legend">{(["capital", "site", "experience", "background", "timeline"] as const).map((k) => <span key={k}><i className={"s-" + k} />{k}</span>)}</div></div></div>{(["capital", "site", "experience", "background", "timeline"] as const).map((k) => <div key={k} className="sline"><div className="sline-h"><span>{k[0].toUpperCase() + k.slice(1)}</span><span className="score">{drawer.score![k]} / {CONFIG.weights[k]}</span></div><div className="bar"><i className={"s-" + k} style={{ width: `${(drawer.score![k] / CONFIG.weights[k]) * 100}%` }} /></div><div className="muted">{drawer.score!.notes[k]}</div></div>)}<div className="sline"><div className="sline-h"><span>Proximity penalty</span><span className="score">−{drawer.score.proximityPenalty}</span></div><div className="muted">{drawer.score.notes.proximity}</div></div></>}
        <h3>Reasons &amp; evidence</h3>{drawer.reasons.map((r, i) => <div key={i} className={"reason k-" + r.kind}><span className="k">{r.kind}</span>{r.text}{r.evidence && <div className="muted" style={{ marginTop: 3 }}>Evidence: “{r.evidence}”</div>}</div>)}
        <h3>Next actions</h3><ol className="actions">{drawer.nextActions.map((a, i) => <li key={i}>{a.replace(/^\d+\.\s*/, "")}</li>)}</ol>
        <h3>Context</h3><div className="ctx"><div><Icon n="radar" /><span>Nearest store: {drawer.nearestStore?.label}</span></div>{drawer.payback && <div><Icon n="gauge" /><span>{drawer.payback.text}</span></div>}{drawer.insight && <div><Icon n="sparkle" /><span>Free text read by: {drawer.insight.source}</span></div>}</div>
        {drawer.onboarding && drawer.status === "Approved" && <><h3>Onboarding plan · ~{drawer.onboarding.totalWeeks} weeks · opens {drawer.onboarding.realisticDate}</h3>{drawer.onboarding.gapFlag && <div className="note">{drawer.onboarding.gapFlag}</div>}
          <div className="stages">{drawer.onboarding.stages.map((s, i) => <div key={i} className="stage"><span className="stage-n">{i + 1}</span><div><b>{s.name}</b> <span className="muted">· {s.weeks ? `${s.weeks} wk` : "in parallel"}</span><ul>{s.tasks.map((t, j) => <li key={j}>{t}</li>)}</ul></div></div>)}</div>
          <h3>Welcome note</h3><div className="welcome">{welcomeFor(drawer)}</div><div className="thanks" lang="kn">Dhanyavadagalu · ಧನ್ಯವಾದಗಳು <span>(thank you) for partnering with us.</span></div></>}
        {drawer.app && <details className="rec"><summary>Record after automatic fixes</summary><table className="kv"><tbody>{FIELDS.map((f) => <tr key={f}><td>{f}</td><td>{String((drawer.app as unknown as Record<string, unknown>)[f] ?? "")}</td></tr>)}</tbody></table></details>}
      </div>
    </div></>}
    <footer className="foot"><div className="foot-in"><div className="brand"><span className="logo" aria-hidden="true">P</span><span><b>PartnerScope</b><small>Rules decide. AI only reads text.</small></span></div><span lang="kn" className="foot-kn">Dhanyavadagalu · ಧನ್ಯವಾದಗಳು — thank you for growing the partner network with us.</span></div></footer>
    </>
  );
}

const ICONS: Record<string, string> = {
  spark: "M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z",
  sparkle: "M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z",
  upload: "M12 16V4m0 0l-4 4m4-4l4 4M4 20h16",
  download: "M12 4v12m0 0l-4-4m4 4l4-4M4 20h16",
  arrow: "M5 12h14m-5-5l5 5-5 5",
  shield: "M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z M9 12l2 2 4-4",
  check: "M20 6L9 17l-5-5",
  globe: "M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z",
  file: "M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9zM14 3v6h6M8 13h8M8 17h5",
  target: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 16a4 4 0 100-8 4 4 0 000 8zM12 12h.01",
  rocket: "M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M14 4c3-1 6-1 6-1s0 3-1 6l-7 7-5-5zM9 10H5l-2 3h5M14 15v4l-3 2v-5",
  map: "M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14",
  radar: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 17a5 5 0 100-10 5 5 0 000 10zM12 12l6-6",
  gauge: "M4 18a8 8 0 1116 0M12 18l4-6",
  chat: "M4 5h16v11H8l-4 4z",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  plus: "M12 5v14M5 12h14",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  book: "M4 4h6a2 2 0 012 2v14a2 2 0 00-2-2H4zM20 4h-6a2 2 0 00-2 2v14a2 2 0 012-2h6z",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4",
  alert: "M12 3l10 18H2zM12 10v4M12 17h.01",
  send: "M4 12l16-8-6 16-2-7z",
  x: "M6 6l12 12M18 6L6 18",
  pin: "M12 21s7-6.2 7-12a7 7 0 10-14 0c0 5.8 7 12 7 12zM12 11a2 2 0 100-4 2 2 0 000 4z",
};
function Icon({ n }: { n: string }) {
  return <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[n] || ""} /></svg>;
}


function Assumptions() {
  const sources = (ref as unknown as { sources: { source_id: string; title: string; organization: string; url: string; publication_date: string; evidence_quality: string; notes: string }[]; rejectedCount: number }).sources;
  const rows: [string, string][] = [
    ["Business format", `${CONFIG.assumedFormat}. The case gives no investment caps or store type, so we fixed one format.`],
    ["Investment floors", `Tier 1 ₹40L, Tier 2 ₹35L, Tier 3 ₹20L. 70–99% of floor → On hold with a funding-gap question; below 70% → Rejected. Above ₹500L treated as a probable rupee/lakh unit error → On hold.`],
    ["Fit score (0–100)", "Capital 30 (10 at floor → 30 at 2× floor) · Site 25 (owned 10 / rented 9 + size 8 + floor 7) · Experience 25 (own years, capped at 8) · Background 10 (direct 10, adjacent 7, unknown 5, unrelated 3) · Timeline 10 (target vs realistic plan) − proximity penalty up to 10 within 2 km of a store (approximate pin-centre distance)."],
    ["Language", "Preferred language never affects eligibility or score. It only sets training and welcome-note language (blank → English)."],
    ["Allocation", "Territories processed High → Medium → Low priority. Within a territory applicants are ranked by fit score; ties within 3 points go to whoever can launch sooner. Minimum fit: High 45, Medium 50, Low 60 – below the bar is held, not approved just to fill a slot. One store per pin, never on a pin with an existing store, never more approvals than open slots. Proximity penalties are recomputed after each approval (greedy)."],
    ["Why no optimiser (integer programming)", "Slots are per territory and each applicant applies for one pin, so a greedy ranked fill gives the same answer an optimiser would in almost every case – and it is explainable line by line (\"ranked #2 of 2 slots\"). Deterministic: same file → same result."],
    ["Free text", "Gemini (temperature 0, JSON schema, cached) reads business/notes in English, Kannada, Hindi and mixed scripts and must return exact quotes. If Gemini fails, keyword rules are used. Text never overwrites a structured field – contradictions create a hold with a question."],
    ["Chat updates", "Updates become a patch {appId, field, newValue} → preview with before/after → applied only on Confirm → engine reruns and logs the diff. Approved partners are never silently un-approved: if someone now outranks them they stay Approved with a review flag. What-ifs are simulated only."],
    ["Onboarding", "KYC 1 wk → funding proof 2 wk (only if within 20% of floor or funding signals) → site 2 wk (+1 for upper floor signage check) → licences in parallel with fit-out 4–6 wk → training 1–2 wk in preferred language. S&E registration fee ₹810 (1–9 employees). Trade licence fees not found – confirm locally."],
    ["Payback (low confidence)", "Monthly revenue ₹8–10L (Tier 1/2), ₹4–6L (Tier 3) from a 2019 interview; margin 25–30%; rent Bengaluru ₹70–150/sq ft (broker data, low confidence), Tier 2/3 rent is a team assumption; 2–3 staff at Karnataka skilled minimum wage. Shown as a range only, never used in scoring."],
    ["Geo data", "Pin validity: India Post directory (2019 snapshot) – unknown pin is a warning only. Distances: approximate pin-centre coordinates (OpenStreetMap Nominatim); pins without coordinates show \"distance unknown\" and get no penalty. Population per store: Census 2011 urban agglomeration – context only."],
  ];
  return <div className="card"><table><tbody>{rows.map(([k, v]) => <tr key={k}><td style={{ width: 210, fontWeight: 600 }}>{k}</td><td style={{ color: "var(--ink-2)" }}>{v}</td></tr>)}</tbody></table>
    <h3>Accepted sources ({sources.length}; {(ref as { rejectedCount: number }).rejectedCount} rejected by the team)</h3>
    <table><thead><tr><th>ID</th><th>Source</th><th>Date</th><th>Quality</th></tr></thead><tbody>{sources.map((s) => <tr key={s.source_id}><td>{s.source_id}</td><td><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a><div className="muted">{s.organization}</div></td><td>{s.publication_date}</td><td>{s.evidence_quality}</td></tr>)}</tbody></table></div>;
}
