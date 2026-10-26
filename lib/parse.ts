import * as XLSX from "xlsx";
import type { RawApplication, Territory, Store } from "./types";

export const BUILTIN_STORES: Store[] = [
  ["ST-01", "Bengaluru", "560001", "2019"], ["ST-02", "Bengaluru", "560034", "2020"], ["ST-03", "Bengaluru", "560038", "2021"],
  ["ST-04", "Bengaluru", "560066", "2022"], ["ST-05", "Bengaluru", "560076", "2023"], ["ST-06", "Mysuru", "570009", "2021"],
  ["ST-07", "Mysuru", "570017", "2024"], ["ST-08", "Mangaluru", "575001", "2022"], ["ST-09", "Hubballi-Dharwad", "580020", "2023"],
  ["ST-10", "Belagavi", "590001", "2024"],
].map(([id, city, pin, year]) => ({ id, city, pin, year }));

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/₹|rs\.?/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const cell = (v: unknown) => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());

const APP_COLS: [keyof RawApplication, string[]][] = [
  ["id", ["application id", "app id"]], ["name", ["applicant name", "name"]], ["city", ["city"]], ["state", ["state"]],
  ["pin", ["pin code", "pincode", "pin"]], ["investment", ["investment capacity", "investment"]],
  ["experience", ["retail experience", "experience"]], ["business", ["current past business", "business"]],
  ["space", ["space available"]], ["size", ["space size", "size"]], ["floor", ["floor"]],
  ["target", ["target launch", "launch"]], ["language", ["preferred language", "language"]], ["notes", ["notes from applicant", "notes"]],
];
const TER_COLS: [string, string[]][] = [
  ["id", ["territory id"]], ["city", ["city"]], ["state", ["state"]], ["pins", ["pin codes covered", "pin codes", "pins"]],
  ["tier", ["city tier", "tier"]], ["slots", ["open slots", "slots"]], ["priority", ["priority"]],
];
const STORE_COLS: [string, string[]][] = [["id", ["store id"]], ["city", ["city"]], ["pin", ["pin code", "pincode", "pin"]], ["year", ["opened", "year"]]];

function findSheet(wb: XLSX.WorkBook, names: string[]) {
  const n = wb.SheetNames.find((s) => names.some((x) => norm(s).includes(x)));
  return n ? wb.Sheets[n] : undefined;
}
function mapHeader(rows: unknown[][], cols: [string, string[]][], key: string) {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const hdr = (rows[r] || []).map(norm);
    if (!hdr.some((h) => h.startsWith(key))) continue;
    const map: Record<string, number> = {};
    for (const [field, aliases] of cols) {
      let idx = -1;
      for (const a of aliases) { idx = hdr.findIndex((h, i) => h.startsWith(a) && !Object.values(map).includes(i)); if (idx >= 0) break; }
      if (idx < 0) for (const a of aliases) { idx = hdr.findIndex((h, i) => h.includes(a) && !Object.values(map).includes(i)); if (idx >= 0) break; }
      if (idx >= 0) map[field] = idx;
    }
    return { headerRow: r, map };
  }
  return null;
}

export interface ParsedWorkbook { apps: RawApplication[]; territories: Territory[]; stores: Store[]; warnings: string[]; storesSource: string }

export function parseWorkbook(data: ArrayBuffer | Uint8Array): ParsedWorkbook {
  const wb = XLSX.read(data, { type: "array" });
  const warnings: string[] = [];
  const toRows = (ws?: XLSX.WorkSheet) => (ws ? (XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }) as unknown[][]) : []);

  const appRows = toRows(findSheet(wb, ["application"]) || wb.Sheets[wb.SheetNames[0]]);
  const ah = mapHeader(appRows, APP_COLS as [string, string[]][], "application id");
  const apps: RawApplication[] = [];
  if (!ah) warnings.push("Could not find the 'Application ID' header row in the Applications sheet.");
  else {
    for (let r = ah.headerRow + 1; r < appRows.length; r++) {
      const row = appRows[r] || [];
      if (row.every((v) => cell(v) === "")) continue;
      const a: Record<string, string | number> = { row: r + 1 };
      for (const [f] of APP_COLS) a[f] = ah.map[f] !== undefined ? cell(row[ah.map[f]]) : "";
      apps.push(a as unknown as RawApplication);
    }
  }

  const terRows = toRows(findSheet(wb, ["territor"]) || wb.Sheets[wb.SheetNames[1]]);
  const th = mapHeader(terRows, TER_COLS, "territory id");
  const territories: Territory[] = [];
  if (!th) warnings.push("Could not find the 'Territory ID' header row in the Territories sheet.");
  else {
    for (let r = th.headerRow + 1; r < terRows.length; r++) {
      const row = terRows[r] || [];
      if (row.every((v) => cell(v) === "")) continue;
      const g = (f: string) => (th.map[f] !== undefined ? cell(row[th.map[f]]) : "");
      const id = g("id");
      if (!id) { warnings.push(`Territories row ${r + 1} has no Territory ID and was skipped.`); continue; }
      const pins = (g("pins").match(/\d{6}/g) || []).map(String);
      const slotsN = parseInt(g("slots").replace(/[^0-9]/g, ""), 10);
      territories.push({ id, city: g("city"), state: g("state"), pins, tier: g("tier"), slots: isNaN(slotsN) ? 0 : slotsN, priority: g("priority") || "Medium", row: r + 1 });
      if (isNaN(slotsN)) warnings.push(`${id}: Open slots missing or not a number, treated as 0.`);
    }
  }

  const storeSheet = findSheet(wb, ["existing", "store"]);
  let stores: Store[] = [];
  let storesSource = "built-in list (sheet not uploaded)";
  if (storeSheet) {
    const sRows = toRows(storeSheet);
    const sh = mapHeader(sRows, STORE_COLS, "store id");
    if (sh) {
      for (let r = sh.headerRow + 1; r < sRows.length; r++) {
        const row = sRows[r] || [];
        const g = (f: string) => (sh.map[f] !== undefined ? cell(row[sh.map[f]]) : "");
        const pin = (g("pin").match(/\d{6}/) || [""])[0];
        if (g("id") && pin) stores.push({ id: g("id"), city: g("city"), pin, year: g("year") });
      }
      if (stores.length) storesSource = "uploaded 'Existing stores' sheet";
    }
  }
  if (!stores.length) stores = BUILTIN_STORES;
  return { apps, territories, stores, warnings, storesSource };
}
