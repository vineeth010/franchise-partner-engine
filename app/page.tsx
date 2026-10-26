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
  const [tab, setTab] = useState("decisions");
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
  return (
    <>
    <nav className="topnav"><div className="topnav-in">
      <div className="brand"><span className="logo" aria-hidden="true">P</span><span><b>PartnerScope</b><small>Franchise partner engine</small></span></div>
      <div className="navlinks"><span>How it works</span><span>Territories</span><span>Onboarding</span></div>
      <div className="navcta">{result ? <><button className="btn sec pillbtn" onClick={exportCsv}>Export CSV</button><button className="btn pillbtn" onClick={() => { setWb(null); setFileName(""); }}>New upload</button></> : <button className="btn pillbtn" onClick={() => fileRef.current?.click()}>Upload applications</button>}</div>
    </div></nav>
    <div className="wrap">
      {wb && <div className="header">
        <div><div className="eyebrow">Case 1 · Partner acquisition, geo-selection &amp; onboarding</div><h1>Partner decisions</h1>
          <div className="sub">Assumed format: {CONFIG.assumedFormat}. Deterministic rules make every decision; AI only reads free text, drafts welcome notes and interprets chat.</div></div>
      </div>}

      {!wb && <div className="hero fade">
        <div className="hero-l">
          <div className="banner">
            <div className="pill">Partner with us · Deterministic rules, AI only reads text</div>
            <div className="greet" lang="kn">Namaskara · ನಮಸ್ಕಾರ</div>
            <h2 className="hero-t">Grow the store network with the <em>right partners</em>, in the right pin codes.</h2>
            <p className="hero-s">Upload the filled-in application template. Every applicant gets a clear decision with evidence, territories are filled slot by slot, and every approved partner gets an onboarding plan and a welcome note in their language.</p>
            <div className="banner-cta"><button className="btn pillbtn big" onClick={() => loadSample("test_1_mixed_traps.xlsx")}>Try the sample data →</button><span className="banner-note">{CONFIG.assumedFormat}</span></div>
          </div>
          <div className="steps">
            {[["1", "Upload", "Drop the Excel template. Messy cities, pins, ₹ amounts and duplicates are cleaned automatically and logged."], ["2", "Decide", "Rules approve, waitlist, hold (with a question to ask) or reject – one store per pin, slots by priority and fit."], ["3", "Onboard", "Week-by-week launch plan, realistic opening date and a welcome note in Kannada, Hindi or English."]].map(([n, t, d]) => <div key={n} className="step"><span className="num">{n}</span><div><b>{t}</b><div className="muted">{d}</div></div></div>)}
          </div>
        </div>
        <div className="card hero-r">
          <div className={"drop" + (over ? " over" : "")} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files[0]); }} onClick={() => fileRef.current?.click()}>
            <div className="drop-ic">⇪</div>
            <b>Drop the filled-in template (.xlsx)</b><div className="muted" style={{ marginTop: 6 }}>or click to choose a file<br />Sheets: Applications, Territories, optional Existing stores (the 10 current stores are built in if missing)</div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0])} />
          </div>
          <div className="or"><span>or try a sample</span></div>
          <div className="samples">
            <button className="btn" onClick={() => loadSample("test_1_mixed_traps.xlsx")}>Load sample data</button>
            <button className="btn sec" onClick={() => loadSample("test_2_dirty_data.xlsx")}>Sample 2 · dirty data</button>
            <button className="btn sec" onClick={() => loadSample("test_3_competition.xlsx")}>Sample 3 · slot competition</button>
          </div>
          {busy && <div className="busy"><span className="spin" />{busy}</div>}
        </div>
      </div>}

      {wb && result && <>
        <p className="meta">{fileName} · Free text read by: {textSource}{busy && <b> · {busy}</b>}</p>
        <div className="tiles">
          {[["All", result.decisions.length], ...STATUSES.map((s) => [s, result.counts[s]])].map(([k, v]) => <div key={k} className={`tile t-${statusOf(String(k))}` + (filter === k ? " on" : "")} onClick={() => { setFilter(String(k)); setTab("decisions"); }}><span className="lbl">{k === "All" ? "Applications" : k}</span><b>{v}</b><div className="tbar"><i style={{ width: `${k === "All" ? (slotsTotal ? (slotsFilled / slotsTotal) * 100 : 0) : result.decisions.length ? (Number(v) / result.decisions.length) * 100 : 0}%` }} /></div><span className="pct">{k === "All" ? `${slotsFilled} of ${slotsTotal} slots filled` : `${result.decisions.length ? Math.round((Number(v) / result.decisions.length) * 100) : 0}% of applicants`}</span></div>)}
        </div>
        <div className="layout">
          <div>
            <div className="tabs">{[["decisions", "Decisions"], ["territories", "Territories"], ["log", `Change log · ${log.length}`], ["assumptions", "Assumptions & sources"]].map(([k, l]) => <div key={k} className={"tab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{l}</div>)}</div>
            {tab === "decisions" && <div className="card" style={{ padding: 0 }}>
              <div className="toolbar"><select value={filter} onChange={(e) => setFilter(e.target.value)}><option>All</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select><input placeholder="Search ID, name, city, pin or territory" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} /></div>
              <div className="tablewrap"><table><thead><tr><th>ID</th><th>Applicant</th><th>Location</th><th>Territory</th><th>Status</th><th>Fit</th><th>Why</th></tr></thead><tbody>
                {shown.map((d) => <tr key={d.id} className="click" onClick={() => setSel(d)}><td className="id">{d.id}</td><td><b style={{ fontWeight: 600 }}>{d.name || "—"}</b></td><td>{d.city}<div className="muted">{d.pin}</div></td><td className="id">{d.territoryId || "—"}</td><td><span className={chipCls(d.status)}>{d.status}{d.waitlistRank ? ` #${d.waitlistRank}` : ""}</span>{d.bumpFlag && <div className="flag">⚑ Needs review</div>}</td><td className="score">{d.score?.total ?? "—"}</td><td style={{ maxWidth: 420 }}>{d.headline}{d.question && <div className="muted" style={{ marginTop: 3 }}>Ask: {d.question}</div>}</td></tr>)}
                {!shown.length && <tr><td colSpan={7}><div className="empty"><div className="empty-ic">∅</div><b>No applicants match</b><div className="muted">Try another status or clear the search.</div><button className="btn sec" style={{ marginTop: 10 }} onClick={() => { setFilter("All"); setQ(""); }}>Clear filters</button></div></td></tr>}
              </tbody></table></div></div>}
            {tab === "territories" && <div className="tercards">{result.territories.map((t) => <div key={t.id} className="tercard fade"><div className="tc-h"><span className="id">{t.id}</span><span className={"prio p-" + t.priority}>{t.priority}</span></div><b>{t.city}</b> <span className="muted">· {t.tier}</span><div className="slotbar">{Array.from({ length: Math.max(t.slots, 1) }).map((_, i) => <i key={i} className={i < t.filled ? "f" : ""} />)}</div><div className="muted">{t.filled} of {t.slots} slot{t.slots === 1 ? "" : "s"} filled{t.waitlisted.length ? ` · ${t.waitlisted.length} waitlisted` : ""}</div></div>)}</div>}
            {tab === "territories" && <div className="card" style={{ padding: 0 }}><div className="tablewrap"><table><thead><tr><th>Territory</th><th>City · tier</th><th>Priority</th><th>Pins</th><th>Slots</th><th>Approved</th><th>Waitlist</th><th>People per store*</th></tr></thead><tbody>
              {result.territories.map((t) => { const c = CITY_REF.find((x) => x.city.toLowerCase() === (t.city || "").toLowerCase()); const stores = (wb.stores.filter((s) => s.city === c?.city).length) + result.decisions.filter((d) => d.status === "Approved" && d.city === c?.city).length; return <tr key={t.id}><td className="id">{t.id}</td><td>{t.city}<div className="muted">{t.tier}</div></td><td>{t.priority}</td><td style={{ maxWidth: 240 }}>{t.pins.join(", ")}{t.warnings.map((w, i) => <div key={i} className="muted">⚠ {w}</div>)}</td><td className="score" style={{ minWidth: 90 }}>{t.filled} / {t.slots}<div className="bar"><i style={{ width: `${t.slots ? (t.filled / t.slots) * 100 : 0}%` }} /></div></td><td>{t.approved.join(", ") || "—"}</td><td>{t.waitlisted.join(", ") || "—"}</td><td className="score">{c && stores ? Math.round(Number(c.census_2011_ua_population) / stores).toLocaleString("en-IN") : "—"}<div className="muted">{stores ? `${stores} stores incl. new` : ""}</div></td></tr>; })}
            </tbody></table></div><p className="muted" style={{ padding: "0 14px 12px" }}>* Census 2011 urban-agglomeration population ÷ stores in the city. Context only; never used in scoring.</p></div>}
            {tab === "log" && <div className="card">{log.map((l, i) => <div key={i} style={{ borderBottom: "1px solid var(--line-2)", padding: "10px 0" }}><b>{l.kind}</b> <span className="muted">· {l.time}</span><div>{l.text}</div>{l.changes.map((c, j) => <div key={j} className="muted">• {c.id}: {c.from} → {c.to} — {c.why}</div>)}</div>)}
              {result.warnings.length > 0 && <><h3>Data warnings</h3><div className="warnlist">{result.warnings.map((w, i) => <div key={i}>{w}</div>)}</div></>}
              {result.decisions.some((d) => d.fixes.length) && <><h3>Automatic data fixes</h3><div className="warnlist">{result.decisions.flatMap((d) => d.fixes.map((f, i) => <div key={d.id + i}><span className="id">{d.id}</span> · {f}</div>))}</div></>}</div>}
            {tab === "assumptions" && <Assumptions />}
            {result.warnings.length > 0 && tab === "decisions" && <div className="card"><h3 style={{ marginTop: 0 }}>Data warnings</h3><div className="warnlist">{result.warnings.map((w, i) => <div key={i}>{w}</div>)}</div></div>}
          </div>
          <div className="card chat"><div className="chat-h"><div className="av">AI</div><div><b>Ask, update or simulate</b><div className="muted">Answers come only from the records on screen</div></div></div><div className="msgs">{msgs.map((m, i) => <div key={i} className={"msg fade " + m.role}>{m.text}</div>)}
            {busy === "Thinking…" && <div className="msg a typing"><i /><i /><i /></div>}
            {msgs.length <= 1 && !preview && <div className="sugg">{["Why is APP-007 on hold?", "Who is approved in Mysuru?", "APP-012 found a rented ground-floor shop of 600 sq ft", "What if APP-005 had 40 lakh?"].map((t) => <button key={t} onClick={() => send(t)}>{t}</button>)}</div>}
            {preview && <div className="preview"><b>{preview.kind === "whatif" ? "What-if simulation · not saved" : "Preview · nothing applied yet"}</b>
              {preview.patches.map((p, i) => <div key={i} style={{ marginTop: 4 }}><span className="id">{p.appId}</span> · {p.field}: <s className="muted">{oldVal(p) || "(blank)"}</s> → <b>{p.newValue}</b></div>)}{preview.force && <div>Force approve: {preview.force}</div>}
              <div style={{ marginTop: 8 }}><b>Decision changes</b>{diffResults(preview.before, preview.after).map((c, i) => <div key={i} className="muted" style={{ marginTop: 3 }}>• <span className="id">{c.id}</span>: {c.from} → {c.to}<br />{c.why}</div>)}{diffResults(preview.before, preview.after).length === 0 && <div className="muted">No decision changes.</div>}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>{preview.kind === "update" && <button className="btn" onClick={confirm}>Confirm &amp; apply</button>}<button className="btn sec" onClick={() => setPreview(null)}>{preview.kind === "update" ? "Cancel" : "Close"}</button></div></div>}</div>
            <div className="chat-in"><input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Ask a question or report an update…" style={{ flex: 1 }} /><button className="btn" onClick={() => send()} disabled={!!busy || !input.trim()}>Send</button></div></div>
        </div>
      </>}

      {drawer && <><div className="drawer-bg" onClick={() => setSel(null)} /><div className="drawer">
        <button className="btn sec x" onClick={() => setSel(null)} aria-label="Close">✕</button>
        <div className="id">{drawer.id}</div><h2 style={{ marginTop: 2 }}>{drawer.name || "—"}</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><span className={chipCls(drawer.status)}>{drawer.status}{drawer.waitlistRank ? ` #${drawer.waitlistRank}` : ""}</span><span className="muted">{drawer.city} {drawer.pin} · {drawer.territoryId || "no territory"} {drawer.tier ? `· ${drawer.tier}` : ""} · {drawer.readiness}</span></div>
        <p style={{ fontSize: 15, marginTop: 14 }}>{drawer.headline}</p>{drawer.question && <div className="note">Question for the applicant: {drawer.question}</div>}{drawer.bumpFlag && <div className="note">⚑ {drawer.bumpFlag}</div>}
        {drawer.score && <><h3>Fit score</h3><div className="scorehead"><div className="big">{drawer.score.total}<span>/100</span></div><div style={{ flex: 1 }}><div className="stack">{(["capital", "site", "experience", "background", "timeline"] as const).map((k) => <i key={k} className={"s-" + k} style={{ width: `${drawer.score![k]}%` }} title={`${k} ${drawer.score![k]}`} />)}</div><div className="legend">{(["capital", "site", "experience", "background", "timeline"] as const).map((k) => <span key={k}><i className={"s-" + k} />{k}</span>)}</div></div></div>{(["capital", "site", "experience", "background", "timeline"] as const).map((k) => <div key={k} style={{ marginBottom: 10 }}><div style={{ display: "flex", justifyContent: "space-between" }}><span>{k[0].toUpperCase() + k.slice(1)}</span><span className="score">{drawer.score![k]} / {CONFIG.weights[k]}</span></div><div className="bar"><i className={"s-" + k} style={{ width: `${(drawer.score![k] / CONFIG.weights[k]) * 100}%` }} /></div><div className="muted">{drawer.score!.notes[k]}</div></div>)}<div><span>Proximity penalty</span> <span className="score">−{drawer.score.proximityPenalty}</span><div className="muted">{drawer.score.notes.proximity}</div></div></>}
        <h3>Reasons &amp; evidence</h3>{drawer.reasons.map((r, i) => <div key={i} className={"reason k-" + r.kind}><span className="k">{r.kind}</span>{r.text}{r.evidence && <div className="muted" style={{ marginTop: 3 }}>Evidence: “{r.evidence}”</div>}</div>)}
        <h3>Next actions</h3><ol style={{ paddingLeft: 18, margin: 0 }}>{drawer.nextActions.map((a, i) => <li key={i} style={{ marginBottom: 4 }}>{a.replace(/^\d+\.\s*/, "")}</li>)}</ol>
        <h3>Context</h3><div className="muted">Nearest store: {drawer.nearestStore?.label}</div>
        {drawer.payback && <div className="muted" style={{ marginTop: 4 }}>{drawer.payback.text}</div>}
        {drawer.insight && <div className="muted" style={{ marginTop: 4 }}>Free text read by: {drawer.insight.source}</div>}
        {drawer.onboarding && drawer.status === "Approved" && <><h3>Onboarding plan · ~{drawer.onboarding.totalWeeks} weeks · opens {drawer.onboarding.realisticDate}</h3>{drawer.onboarding.gapFlag && <div className="note">{drawer.onboarding.gapFlag}</div>}
          {drawer.onboarding.stages.map((s, i) => <div key={i} className="stage"><b>{s.name}</b> <span className="muted">· {s.weeks ? `${s.weeks} wk` : "in parallel"}</span><ul>{s.tasks.map((t, j) => <li key={j}>{t}</li>)}</ul></div>)}
          <h3>Welcome note</h3><div className="reason">{welcomeFor(drawer)}</div><div className="thanks" lang="kn">Dhanyavadagalu · ಧನ್ಯವಾದಗಳು <span>(thank you) for partnering with us.</span></div></>}
        {drawer.app && <details style={{ marginTop: 18 }}><summary>Record after automatic fixes</summary><table className="kv"><tbody>{FIELDS.map((f) => <tr key={f}><td>{f}</td><td>{String((drawer.app as unknown as Record<string, unknown>)[f] ?? "")}</td></tr>)}</tbody></table></details>}
      </div></>}
      <footer className="foot"><span lang="kn">Dhanyavadagalu · ಧನ್ಯವಾದಗಳು</span> — thank you for growing the partner network with us. <span className="muted">PartnerScope · rules decide, AI only reads text.</span></footer>
    </div>
    </>
  );
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
