import { readFileSync } from "fs";
import { parseWorkbook } from "../lib/parse";
import { runEngine, diffResults } from "../lib/engine";
import type { EngineResult } from "../lib/types";

let fails = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };
function invariants(name: string, r: EngineResult, stores: { pin: string }[], appRows: number) {
  const appr = r.decisions.filter((d) => d.status === "Approved");
  const pins = appr.map((d) => d.pin);
  ok(new Set(pins).size === pins.length, `${name}: no two approvals share a pin`);
  ok(!appr.some((d) => stores.some((s) => s.pin === d.pin)), `${name}: no approval on a pin with an existing store`);
  ok(r.territories.every((t) => t.approved.length <= t.slots), `${name}: approvals <= open slots in every territory`);
  ok(r.decisions.every((d) => d.status && d.headline && d.headline.length > 5), `${name}: every applicant has a status and a reason`);
  ok(r.decisions.every((d) => d.nextActions.length > 0), `${name}: every applicant has next actions`);
  ok(r.decisions.length >= appRows - 1, `${name}: every row got a decision (${r.decisions.length} decisions / ${appRows} rows)`);
}
const files = ["test_1_mixed_traps.xlsx", "test_2_dirty_data.xlsx", "test_3_competition.xlsx"];
const results: Record<string, EngineResult> = {};
for (const f of files) {
  const wb = parseWorkbook(readFileSync(`${__dirname}/${f}`));
  const input = { apps: wb.apps, territories: wb.territories, stores: wb.stores, insights: {}, parseWarnings: wb.warnings, today: "2026-10-26" };
  const r = runEngine(input);
  results[f] = r;
  invariants(f, r, wb.stores, wb.apps.length);
  const r2 = runEngine(JSON.parse(JSON.stringify(input)));
  ok(JSON.stringify(r) === JSON.stringify(r2), `${f}: deterministic (same input → identical output)`);
  console.log(`   counts ${JSON.stringify(r.counts)} | stores: ${wb.storesSource}`);
  for (const d of r.decisions) console.log(`   ${d.id.padEnd(16)} ${d.status.padEnd(14)}${d.waitlistRank ? "#" + d.waitlistRank : "  "} ${String(d.score?.total ?? "-").padEnd(5)} ${d.headline.slice(0, 150)}`);
  for (const w of r.warnings) console.log(`   WARN ${w}`);
}
// specific trap expectations (test 1)
const t1 = results["test_1_mixed_traps.xlsx"];
const st = (id: string) => t1.decisions.find((d) => d.id === id)?.status;
ok(!t1.decisions.some((d) => d.name === "Ravi Kumar"), "T1: Applications example row skipped");
ok(t1.territories.some((t) => t.id === "TER-01" && t.city === "Mysuru"), "T1: Territories example row TER-01 kept as a normal territory (user decision)");
ok(st("APP-006") === "Rejected", "T1: pin with existing store rejected");
ok(st("APP-010") === "Rejected", "T1: pin outside all territories rejected");
ok(st("APP-011") === "Rejected", "T1: out-of-scope city/state rejected");
ok(st("APP-015") === "Rejected", "T1: investment <70% of floor rejected");
ok(st("APP-005") === "On hold", "T1: funding gap 70–99% held");
ok(st("APP-009") === "On hold", "T1: pin/city mismatch held");
ok(st("APP-012") === "On hold", "T1: no site yet held");
ok(st("APP-013") === "On hold", "T1: rupee/lakh unit error held");
ok(st("APP-016") === "On hold", "T1: Rented with blank size held");
ok(st("APP-017") === "On hold", "T1: red flag held");
ok(st("APP-019") === "On hold", "T1: 'not yet identified' with size held");
ok(st("APP-008") === "On hold", "T1: experience 0 but text says own shop held");
ok(t1.decisions.filter((d) => d.status === "Invalid record").length === 2, "T1: duplicate ID and missing ID are Invalid records");
const t3 = results["test_3_competition.xlsx"];
const h = t3.decisions.find((d) => d.id === "APP-108");
console.log("   APP-108 proximity:", h?.score?.proximityPenalty, h?.score?.notes.proximity);
ok((h?.score?.proximityPenalty ?? 0) > 0, "T3: 2 km cannibalisation penalty fires for APP-108 (pin 570023 near ST-06 570009)");
const nb = t3.decisions.filter((d) => (d.score?.notes.proximity || "").includes("newly approved"));
console.log("   penalties vs newly approved:", nb.map((d) => `${d.id} ${d.score?.notes.proximity}`));
ok(t3.decisions.some((d) => (d.score?.notes.proximity || "").includes("Distance unknown")), "T3: pin without coordinates shows 'distance unknown', no penalty");
// user decision Q2: "Rented" + "still searching for a better location" is a warning, not a hold
const wb2 = parseWorkbook(readFileSync(`${__dirname}/test_2_dirty_data.xlsx`));
const t2 = runEngine({ apps: wb2.apps, territories: wb2.territories, stores: wb2.stores, insights: {}, today: "2026-10-26" });
const a39 = t2.decisions.find((d) => d.id === "APP-039")!;
console.log("   APP-039:", a39.status, a39.score?.total, "|", a39.headline);
ok(!a39.reasons.some((r) => r.kind === "hold" && /searching|better location/i.test(r.text)), "T2: APP-039 'better location' is not a hold reason");
ok(a39.reasons.some((r) => r.kind === "warning" && /better location/.test(r.text)), "T2: APP-039 carries a 'better location' warning");
// user decision: vague family-shop mention ("I help at my father's shop on weekends") with 0 years => NO hold, no question,
// no experience credit, background scored as "unrelated" – in keyword AND Gemini paths. Stated personal years still => contradiction hold.
{
  const w1 = parseWorkbook(readFileSync(`${__dirname}/test_1_mixed_traps.xlsx`));
  const gem = { background: "direct_retail", backgroundQuote: "saree shop", statedOwnYears: null, statedQuote: "", familyNotOwn: false, familyQuote: "", spaceContradiction: false, spaceQuote: "", timing: [], funding: [], redFlags: [], source: "gemini" } as any;
  const totals: number[] = [];
  for (const [mode, ins] of [["keyword", {}], ["gemini (favourable reading)", { "APP-007": gem }]] as const) {
    const d = runEngine({ apps: w1.apps, territories: w1.territories, stores: w1.stores, insights: ins as any, today: "2026-10-26" }).decisions.find((x) => x.id === "APP-007")!;
    console.log(`   APP-007 [${mode}]:`, d.status, d.score?.total, "|", d.headline);
    ok(!d.reasons.some((r) => r.kind === "hold" && /family|experience/i.test(r.text)) && !/family business|confirm your role/i.test(d.question || ""), `Family rule: APP-007 not held/asked about family experience (${mode})`);
    ok(d.score?.experience === 0 && d.score?.background === 3, `Family rule: APP-007 gets 0 experience and 'unrelated' background credit (${mode})`);
    totals.push(d.score!.total);
  }
  ok(totals[0] === totals[1], "Family rule: APP-007 score identical in keyword and Gemini paths");
  const w2 = parseWorkbook(readFileSync(`${__dirname}/test_2_dirty_data.xlsx`));
  const g33 = { ...gem, backgroundQuote: "my father's shop", statedOwnYears: 3, statedQuote: "running it for 3 years" };
  for (const [mode, ins] of [["keyword", {}], ["gemini", { "APP-033": g33 }]] as const) {
    const d33 = runEngine({ apps: w2.apps, territories: w2.territories, stores: w2.stores, insights: ins as any, today: "2026-10-26" }).decisions.find((x) => x.id === "APP-033")!;
    console.log(`   APP-033 [${mode}]:`, d33.status, "|", d33.headline);
    ok(d33.status === "On hold" && /0 years/.test(d33.headline) && /3 years/.test(d33.question || ""), `Stated years: APP-033 'my father's shop, running it for 3 years' (0 entered) contradiction hold (${mode})`);
  }
}
// update flow: APP-012 finds a site
const wb1 = parseWorkbook(readFileSync(`${__dirname}/test_1_mixed_traps.xlsx`));
const base = { apps: wb1.apps, territories: wb1.territories, stores: wb1.stores, insights: {}, today: "2026-10-26" };
const before = runEngine(base);
const locked = before.decisions.filter((d) => d.status === "Approved").map((d) => d.id);
const after = runEngine({ ...base, lockedApproved: locked, patches: [{ appId: "APP-012", field: "space", newValue: "Rented" }, { appId: "APP-012", field: "size", newValue: "600" }, { appId: "APP-012", field: "floor", newValue: "Ground" }, { appId: "APP-012", field: "notes", newValue: "Found a rented shop near the bus stand" }] });
const ch = diffResults(before, after);
console.log("   UPDATE APP-012 diff:", JSON.stringify(ch));
ok(after.decisions.find((d) => d.id === "APP-012")?.status === "Approved", "Update: APP-012 approved after finding a site");
ok(locked.every((id) => after.decisions.find((d) => d.id === id)?.status === "Approved"), "Update: no previously approved partner silently un-approved");
invariants("after update", after, wb1.stores, wb1.apps.length);
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
