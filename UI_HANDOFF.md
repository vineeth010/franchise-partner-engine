# UI_HANDOFF — rebuild the PartnerScope frontend (Claude Code prompt)

> Paste this whole file into Claude Code at the repo root. Rebuild **only the frontend** (`app/` pages, components and styles). **Do not change anything in `lib/`, `tests/`, `scripts/` or the business logic in `app/api/*`.** After your work, `npm test` must still print 55 PASS / 0 FAIL and `npm run build` must succeed.

## 1. What the product is
**PartnerScope** is a franchise-partner acquisition, geo-selection and onboarding engine for a branded eyewear-retail showroom chain expanding across 7 Karnataka cities. A franchise team uploads the filled-in Excel application template. Deterministic rules then:
- clean messy data and log every fix
- give each applicant a clear status with evidence
- fill each territory's slots by priority and fit
- build a week-by-week onboarding plan and a welcome note for each approved partner

AI (Gemini) only **reads free text**, **drafts welcome notes** and **interprets chat**; it never decides.

Stack: Next.js 15.5.28 App Router, React 19.1, TypeScript, SheetJS (`xlsx`), a pure TS engine in `lib/`, server-only Gemini routes, deployed on Vercel. No login, no database. Everything is computed in the browser apart from the 3 AI routes.

## 2. Backend / engine (DO NOT MODIFY)
| Module | Pure exports | Purpose |
|---|---|---|
| `lib/types.ts` | types only | `Status`, `RawApplication`, `Territory`, `Store`, `TextInsight`, `CleanApp`, `Reason`, `ScoreBreakdown`, `Stage`, `Onboarding`, `Decision`, `EngineInput`, `Patch`, `EngineResult` |
| `lib/parse.ts` | `parseWorkbook(data: ArrayBuffer\|Uint8Array): ParsedWorkbook` (`{apps, territories, stores, warnings, storesSource}`), `BUILTIN_STORES` | Reads the sheets Applications, Territories and an optional Existing stores (falls back to the 10 built-in stores) |
| `lib/text.ts` | `keywordInsight({business, notes}): TextInsight`, `familyShopQuote(text): string` | Keyword/regex reading of free text (offline fallback for Gemini) |
| `lib/engine.ts` | `runEngine(input: EngineInput): EngineResult`, `diffResults(before, after)`, `fitScore`, `buildOnboarding`, `parseNumber`, `normPin`, `normCity`, `normTier`, `normPriority`, `km`, `CITY_REF`, `EXAMPLE_ROW` | The whole decision engine: cleaning, eligibility, holds, rejects, fit score, slot allocation, waitlist, onboarding, payback |
| `lib/config.ts` | `CONFIG` | All thresholds: floors (Tier1 ₹40L / Tier2 ₹35L / Tier3 ₹20L), `minFitByPriority` (High 45, Medium 50, Low 60), weights (capital 30, site 25, experience 25, background 10, timeline 10), 7 allowed cities with pin prefixes and tiers, `assumedFormat` |
| `lib/gemini.ts` | `geminiJSON(prompt, timeoutMs=25000)` → `{data, model} \| null` | Server-only; tries `gemini-3.8-flash` then `gemini-3.6-flash`; returns `null` if there is no key or both fail |
| `lib/gate.ts` | `gate(req)` | Optional passcode (off unless `APP_PASSCODE` is set; client sends `x-app-passcode`) |
| `lib/data/reference.json` | data | Pin coordinates, India Post pins, census population, sources list |

Key types (abridged):
```ts
type Status = "Approved"|"Waitlisted"|"On hold"|"Rejected"|"Invalid record";
interface Decision { id; row; name; city; pin; territoryId: string|null; tier; priority; status: Status; headline: string; question?: string;
  eligible: boolean; readiness: string; reasons: {kind:"fix"|"hold"|"reject"|"info"|"warning"|"score"|"allocation"; text; evidence?}[]; fixes: string[];
  score: {capital; site; experience; background; timeline; proximityPenalty; total; notes: Record<string,string>} | null;
  nearestStore: {storeId; km: number|null; label}|null; payback: {lowMonths; highMonths; text}|null;
  onboarding: {stages:{name; weeks; tasks:string[]}[]; totalWeeks; realisticMonths; realisticDate; targetMonths; gapFlag: string|null; trainingLanguage}|null;
  nextActions: string[]; waitlistRank?: number; bumpFlag?: string; insight?: TextInsight; app?: CleanApp }
interface EngineInput { apps; territories; stores; insights: Record<string,TextInsight>; patches?: Patch[]; lockedApproved?: string[]; forceApprove?: string; today?: string; parseWarnings?: string[] }
interface EngineResult { decisions: Decision[]; territories: (Territory & {approved: string[]; waitlisted: string[]; filled: number; warnings: string[]})[]; warnings: string[]; counts: Record<string, number> }
interface Patch { appId: string; field: keyof RawApplication; newValue: string; note?: string }
```

### API routes (server, Node runtime)
- `POST /api/extract` `{items:[{id, business, notes}]}` → `{insights: Record<id, TextInsight>, source?, model?}`. Uses Gemini in chunks of 25 with an in-memory cache. Each insight has `source: "gemini"|"keywords"`; if Gemini is unavailable it falls back to `keywordInsight`.
- `POST /api/chat` `{message, context}` → `{intent:"question"|"update"|"whatif", answer, patches:[{appId, field, newValue}], forceApprove: string|null, model}`, or **503** `{error:"gemini_unavailable"}`. The client then uses its own regex fallback (`regexFallback` in the old page) and prefixes answers with "(Offline mode)".
- `POST /api/welcome` `{items:[{id, name, city, territory, language, launchDate, firstStep}]}` → `{notes:[{id, note}], model|null}`. If notes is empty, the client uses built-in Kannada/Hindi/English templates marked "(template)".
- The key `GEMINI_API_KEY` lives only in server env (Vercel, encrypted). Never import `lib/gemini.ts` into client code.

## 3. Data flow (client)
1. **Upload**: drop/choose an `.xlsx` or load `/test_1_mixed_traps.xlsx`, `/test_2_dirty_data.xlsx` or `/test_3_competition.xlsx` from `public/`, then `parseWorkbook(buf)`.
2. **Read text**: call `/api/extract` with business+notes for every app and store `insights`. Show "Free text read by: Gemini <model> | keyword rules (Gemini unavailable)".
3. **Decide**: `result = runEngine({apps, territories, stores, insights, patches, lockedApproved, today, parseWarnings})` inside `useMemo`.
4. **Welcome notes**: call `/api/welcome` for Approved decisions.
5. **Table → Drawer**: clicking a row opens the drawer for that `Decision`.
6. **Chat**: `/api/chat` with `context` (decisions summary + territories). Each intent is handled differently:
   - **question**: show the answer.
   - **update**: show a **preview diff** (`diffResults(before, after)` with the patches applied) plus Confirm/Cancel. On Confirm, append the patches, lock the currently approved IDs (`lockedApproved`, so updates never bump existing partners), log the change, and re-fetch welcome notes.
   - **whatif**: simulate only, never apply.
7. **Export CSV** of all decisions. The **Change log** tab lists confirmed updates, data warnings and automatic fixes.

## 4. Status semantics (keep these colours, they pass contrast)
- **Approved** (green #1f7a4d on #e6f4ec): eligible, fit ≥ the territory's min fit, got a slot.
- **Waitlisted** (blue #33598f on #e8eef8): eligible and good enough but the slots or that pin are taken; shows `#rank`.
- **On hold** (amber #8a5a00 on #fbf1dc): needs a human answer; always has a `question` to ask (funding gap 70–99% of floor, contradictions, space not secured, red flags, fit below min).
- **Rejected** (rose #a3333d on #fbe9ea): hard rule failed (city not allowed, investment <70% of floor, existing-store pin, …).
- **Invalid record** (grey #5b6370): unusable row (missing ID or name, duplicate).
- `bumpFlag` / "⚑ needs review" marks a decision that changed after an update.

## 5. Screens & components
**/ (landing):**
- sticky nav (logo, How it works, Territories, Scoring, Try demo, Launch engine CTA)
- hero (headline, subcopy, CTAs "Upload applications" and "Try sample data", stats strip, product-preview mock)
- How it works (4 steps)
- Why partner (value props)
- Transparent scoring (weights as bars from `CONFIG.weights`)
- Karnataka coverage (7 cities, tier, floor from `CONFIG`)
- FAQ accordion
- CTA band
- footer with "Dhanyavadagalu · ಧನ್ಯವಾದಗಳು"

**/engine (tool):**
- **Sidebar:** Overview, Applicants, Territories, Onboarding, Assistant.
- **Empty state:** dropzone plus the 3 sample buttons.
- **Overview:** KPI cards (Applications + slots filled/total, Approved, Waitlisted, On hold, Rejected, Invalid), a status donut and territory slot bars (`filled/slots`).
- **Applicants:** status filter plus search (ID, name, city, pin, territory). Columns: ID, Applicant, Location (city + pin), Territory, Status chip (+ waitlist # and ⚑), Fit, Why (headline + question).
- **Territories:** id, city, tier, priority, pins, slots filled, approved, waitlist, warnings.
- **Onboarding:** each Approved partner with realistic date, total weeks, stages, gap flag and welcome note.
- **Assistant:** chat with suggestion chips, the preview diff and Confirm/Cancel.
- **Drawer:** ID, name, status chip, city/pin/territory/tier/readiness, headline, question box, fit score (big total, stacked bar, 5 component bars with `score.notes`, proximity penalty), reasons with kind labels and evidence quotes, next actions, context (nearest store km, payback text, text source), onboarding stages, welcome note (+ "Dhanyavadagalu" line) and the cleaned record (`app`).
- **Assumptions & sources:** rules table plus the sources from `reference.json`.

## 6. Design brief
- **Inspiration and limits:** a modern eyewear-retail site look, but **no Lenskart name, logo or trademarked imagery**, and the app is never presented as anyone's official product. Brand: **PartnerScope**, "P" monogram.
- **Palette:** deep navy #000042 (primary/ink), aqua #00bac6 / mint #11daac (accents), white and #f7f8fb backgrounds, lines #e3e6ef.
- **Type and layout:** Plus Jakarta Sans or Inter via `next/font`; 8px spacing scale; radius 16–24; soft navy-tinted shadows; pill CTAs; airy white retail layout.
- **Icons and motion:** lucide-react icons; subtle framer-motion entrances.
- **Accessibility:** visible focus rings, hover states, AA contrast.
- **Responsive:** down to 390px with no horizontal scroll.
- **Language:** light Kannada touches only ("Namaskara · ನಮಸ್ಕಾರ" greeting, "Dhanyavadagalu · ಧನ್ಯವಾದಗಳು" thank-you). Everything else in English.

## 7. Constraints
- Keep `lib/`, `tests/`, `scripts/` and the API route logic unchanged. `npm test` must stay at 55 PASS / 0 FAIL.
- The Gemini key is server-side only; never log it or put it in client code or the repo. No `.env*` in git.
- No login. The deploy is fully public.

## 8. Run & deploy
```bash
npm install
npm test            # tsx tests/invariants.test.ts  → 55 PASS / 0 FAIL
npm run dev         # http://localhost:3000  (works without a key: keyword fallback)
GEMINI_API_KEY=... npm run dev   # optional, enables Gemini locally
npm run build && npm start
```
Vercel project `franchise-partner-engine` (team vineeth010), framework nextjs. Set `GEMINI_API_KEY` (encrypted, Production + Preview) in Project → Settings → Environment Variables, then redeploy. Live: https://franchise-partner-engine-vineeth010.vercel.app
