# BUILD SPEC — Franchise Partner Acquisition, Geo-Selection & Onboarding Engine (Case 1)

> Paste this whole file into Claude Code as the prompt. It is self-contained. Build exactly what is described; where a rule is given, implement it literally. Do not add ML, optimisation solvers or a login.

## 0. Goal
A one-page web app for a franchise team of a **branded retail showroom chain (Lenskart-style optical, Karnataka)**. They upload the filled-in Excel template (Applications, Territories, optional Existing stores). The app gives:
1. A **decision for every applicant**: Approved / Waitlisted / On hold / Rejected / Invalid record, with a one-line headline, reasons with evidence, a question to ask (if held), and next actions.
2. **Territory allocation**: slots filled by a deterministic greedy rule, one store per pin, never a pin with an existing store.
3. An **onboarding plan** and **welcome note** (in the partner's language) for every approval.
4. **Chat**: ask questions, report updates (preview → confirm → re-run with a change log), run what-ifs (simulate only).
5. CSV export.

**Principle:** deterministic rules make every decision; Gemini only (a) reads free text into structured signals, (b) drafts welcome notes, (c) interprets chat. Same input ⇒ same output. Every number is in one CONFIG file.

## 1. Stack
- Next.js 15 App Router + TypeScript (React 19). No auth, no database.
- SheetJS `xlsx` from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, parsed **in the browser**.
- Pure-TS engine in `lib/` (no React imports) so it runs in the browser and in tests (`tsx`).
- Server-only API routes call Gemini over REST. `GEMINI_API_KEY` is read only from `process.env` on the server. Never import it in client code, never log it, never commit it. `.env*` stays in `.gitignore`.
- Deploy on Vercel (public, deployment protection off). Route config: `export const runtime = "nodejs"; export const maxDuration = 60;`.
- `next.config.mjs`: `eslint: { ignoreDuringBuilds: true }`. tsconfig `paths: {"@/*": ["./*"]}`, exclude `tests` and `scripts`.
- Scripts: `dev`, `build`, `start`, `test` = `tsx tests/invariants.test.ts`.

### Files
```
app/layout.tsx, app/page.tsx (client), app/globals.css, app/icon.svg
app/api/extract/route.ts, app/api/chat/route.ts, app/api/welcome/route.ts
lib/config.ts, lib/types.ts, lib/parse.ts, lib/text.ts, lib/engine.ts, lib/gemini.ts, lib/gate.ts
lib/data/reference.json   (pin coordinates, India Post pin list, Census cities, sources)
scripts/make_tests.py     (builds 3 test workbooks from the template with openpyxl)
tests/invariants.test.ts, tests/test_1_mixed_traps.xlsx, tests/test_2_dirty_data.xlsx, tests/test_3_competition.xlsx
public/ (copies of the 3 test workbooks for the "Load sample" buttons)
```

## 2. Input template
`template.xlsx`. Row 1 is the title, row 2 holds the headers, row 3 is an example, and data starts on row 4. Find the header row by scanning the first 15 rows. Match headers loosely: lower-case, strip ₹/Rs and punctuation. Match sheets by name contains: "application", "territor", "existing"/"store".
- **Applications:** Application ID, Applicant name, City, State, Pin code, Investment capacity (₹ lakh), Retail experience (years), Current business (free text), Space available (Owned / Rented / Not yet identified), Space size (sq ft), Floor (Ground / Upper / Mall unit / Not known), Target launch (months), Preferred language, Notes (free text).
- **Territories:** Territory ID, City, State, Pin codes (comma/space/semicolon separated; extract with `/\d{6}/g`), City tier, Open slots, Priority (High/Medium/Low).
- **Existing stores:** Store ID, City, Pin, Year opened. If the sheet is missing, use the built-in list and say so in the UI:
  `ST-01 Bengaluru 560001 2019, ST-02 Bengaluru 560034 2020, ST-03 Bengaluru 560038 2021, ST-04 Bengaluru 560066 2022, ST-05 Bengaluru 560076 2023, ST-06 Mysuru 570009 2021, ST-07 Mysuru 570017 2024, ST-08 Mangaluru 575001 2022, ST-09 Hubballi-Dharwad 580020 2023, ST-10 Belagavi 590001 2024`.

**Example rows (user decisions):**
- Applications example row: skip it only when it is the first data row **and** matches the template's APP-001 Ravi Kumar row exactly field-by-field. Add a warning when you do.
- Territories example row (TER-01 Mysuru 570001,570002,570008, Tier 2, 3 slots, High) is **sample data treated as a normal territory**. Do NOT skip it.

## 3. CONFIG (lib/config.ts) — all tunables
```ts
investmentFloorLakh: { "Tier 1": 40, "Tier 2": 35, "Tier 3": 20 }
fundingHoldBand: 0.7            // >=70% and <100% of floor -> hold; <70% -> reject
probableRupeeErrorAboveLakh: 500
minFitByPriority: { High: 45, Medium: 50, Low: 60 }
tieWindowPoints: 3
cannibalisationRadiusKm: 2, maxProximityPenalty: 10
weights: { capital: 30, site: 25, experience: 25, background: 10, timeline: 10 }
experienceCapYears: 8, idealSizeSqft: [500, 1000], fundingProofIfWithinPctOfFloor: 0.2
allowedCities (prefix, tier): Bengaluru 560 T1; Mysuru 570 T2; Mangaluru 575 T2; Hubballi-Dharwad 580 T2; Belagavi 590 T2; Tumakuru 572 T3; Davanagere 577 T3
cityAliases: bangalore/blr→Bengaluru, mysore→Mysuru, mangalore→Mangaluru, hubli/hubballi/dharwad/hubli-dharwad→Hubballi-Dharwad, belgaum→Belagavi, tumkur→Tumakuru, davangere→Davanagere
monthlyRevenueLakh: T1 [8,10], T2 [8,10], T3 [4,6]   (LOW confidence, 2019 interview)
marginPct: [0.25, 0.30]; rentPerSqft: T1 [70,150], T2 [35,70], T3 [25,45] (T2/T3 = team assumption)
staffCount: [2,3]; skilledMinWage (Karnataka 2026-27): T1 18570.47, T2/T3 17902.79; defaultSizeForPayback 600
shopsEstablishmentFee: "Rs 810 for 1-9 employees (Karnataka, amended Schedule I, 2025)"
```

## 4. Cleaning (automatic fixes, each logged as a "fix" reason)
- **ID:** trim, upper-case, remove spaces. A blank ID gives `ROW-n` → **Invalid record**. A duplicate ID: the first row is assessed and later rows are **Invalid record** ("data problem, not a verdict on the applicant").
- **Numbers:** strip commas and text, take the first number; "crore" ×100 → lakh.
- **Pin:** digits only.
- **City:** apply aliases, then title-case.
- **Tier:** find the digit 1–3.
- **Priority:** h/m/l prefix, default Medium.
- **Space and floor:** map synonyms to the allowed values; anything else is held with a question.
- **Language:** Kannada / Hindi / English synonyms; if blank or unknown, use English plus an info note.

## 5. Free-text reading → `TextInsight`
```ts
{ background: "direct_retail"|"adjacent"|"unrelated"|"unknown", backgroundQuote, statedOwnYears: number|null, statedQuote,
  familyNotOwn: boolean, familyQuote, spaceContradiction: boolean, spaceQuote, spaceDoubt?: boolean, spaceDoubtQuote?,
  timing: {text,quote}[], funding: {text,quote}[], redFlags: {text,quote}[], source: "gemini"|"keywords" }
```
- **Keyword fallback (`lib/text.ts`), always available and deterministic:**
  - Background regexes: shop/store/retail/optical/kirana/angadi/dukaan → direct; pharmacy/salon/sales/distribution → adjacent; IT/software/teacher/farming/student → unrelated.
  - Years: `/(\d{1,2})\s*\+?\s*(years|yrs|year|varsha|saal|sal)\b/i`.
  - Family: `(father|dad|appa|papa|pitaji|uncle|brother|family|husband|wife|mother|amma|parents)('s)? … (shop|store|business|angadi|dukaan|dukan)`. Also export `familyShopQuote(text)`.
  - Space (user decision): **hold only when the text clearly says there is no space yet** (still looking for a shop / not found / yet to find / no shop yet / haven't found / dhoondh / hudukta). If the matched phrase contains better/another/bigger/alternative/other/backup, it is a **spaceDoubt (warning only)**, not a contradiction.
  - Timing: before/by/after + festival or month, asap, urgent, next month.
  - Funding: loan, bank, mudra, co-investor, selling land/property.
  - Red flags: exclusive / whole city / monopoly; already run/own a competing franchise (Titan, Lenskart, Eye Plus, Specsmakers).
- **Gemini (`/api/extract`):**
  - Batches of 25 with `Promise.all`.
  - In-memory cache keyed on `JSON.stringify([business, notes])`.
  - Blank text uses keywords.
  - Prompt: "Text may be English, Kannada, Hindi or transliterated Kannada or Hindi. Extract ONLY what is literally stated; quotes must be exact substrings." Use the field definitions above, including spaceContradiction (clearly NO space) versus spaceDoubt (has space, looking for a better one).
  - Validate the enums. On any failure, fall back to keywords per item.
  - Returns `{insights: {id: TextInsight}, model}`.
- **Client flow:** run the engine immediately with keyword insights, then call `/api/extract` and re-run with Gemini insights. Show "Free text read by: Gemini (model) for N rows, keyword rules for the rest".

## 6. Decision rules (`runEngine`), in this order
**Patches** (from chat updates) are applied to raw rows first. A patched row skips the "text says space not secured" hold, because the update supersedes the text.

**Reject** (status Rejected):
1. City is not an allowed city (out of scope), or state is not Karnataka.
2. Pin already has an existing brand store: "The brand never opens two stores in one pin". Name the open territory pins in that city and invite the applicant to reapply.
3. Pin is in no territory: "The brand is not expanding in pin X". List open pins in the city.
4. Investment < 70% of the tier floor. Next action: "Could reapply with at least ₹floor lakh (or 70% plus a loan plan)".

**Hold** (status On hold; each hold has a text, a question and evidence, and the first hold is the headline and the question):
- A required field is missing (name, city, pin, investment, experience, space), the pin isn't 6 digits, or the space value is invalid.
- Pin prefix doesn't match the city (say which city the pin looks like).
- Investment > 500 lakh: probable rupee/lakh unit error.
- Investment ≥ 70% and < 100% of the floor (funding gap): ask about a loan or co-investor for the remaining amount.
- Space "Not yet identified" with no size: "No site identified yet – held until a site is found (held applicants never take a slot)". Not yet identified + a size given: contradiction hold.
- Owned/Rented with a blank size, unless an update just set space (then add "confirm carpet area" to onboarding).
- Owned/Rented + `spaceContradiction` (text clearly says no space): hold. Owned/Rented + `spaceDoubt` only: **warning** "Has a rented/owned space but mentions looking for a better location – not a hold", plus a next action "Confirm the final shop address before fit-out".
- **Experience/text rules (user decisions):**
  - **Vague family-shop mention** (`familyShopQuote(business+notes)` matches, or Gemini familyNotOwn) **with no years stated in the text** and experience entered as 0: **no hold, no question**. Override the insight to `background = "unrelated"` ("no relevant background", 3/10), `statedOwnYears = null`, experience credit 0. This overrides Gemini in both paths. Add an info reason. Example: APP-007 "My father's saree shop, I help there on weekends" is scored normally and ends below the bar.
  - **Clearly stated personal years** in the text (e.g. APP-033 "It's my father's shop, I have been running it for 3 years") with experience entered as 0: **contradiction hold** "Experience field says 0 years but the applicant wrote '…'". Question: "Please confirm your own retail experience – is it N years?". This applies in both keyword and Gemini paths.
  - Otherwise, experience 0 but Gemini/keywords found own years or a direct-retail own-shop quote: same contradiction hold.
  - Experience > 0 but the text says it's a family member's shop: hold and ask whose experience it is.
- Any red flag: hold for human review.

**Scored** (no reject or hold) → fit score (also computed for holds when possible, for display):
- capital = 10 + 20 × clamp(investment/floor − 1, 0, 1) (max 30).
- site = space (Owned 10, Rented 9) + size (8 if 500–1000; 300–500 linear 4→8; <300 2; 1000–1500 linear 8→6; >1500 5; unknown 4) + floor (Ground/Mall 7, Upper 2, unknown 4) (max 25).
- experience = 25 × min(years/8, 1).
- background: direct 10, adjacent 7, unknown 5, unrelated 3.
- timeline: blank 7; target ≥ plan months → 10, else 10 − 2.5 × shortfall (min 0).
- proximity penalty vs the nearest existing store: d < 2 km ⇒ 10 × (1 − d/2); unknown coordinates ⇒ 0 and "Distance unknown".
- total = clamp(sum − penalty, 0, 100), one decimal. Store a note for every component.

**Allocation** (deterministic greedy):
- Territories are processed High → Medium → Low, then by ID.
- Pin → territory uses the first listed; a pin listed in two territories gives a warning.
- Per territory:
  1. Scored applicants below `minFitByPriority` → On hold "Fit score X is below the N minimum for a P-priority territory (T). Held rather than approved just because a slot is free."
  2. **Locked approvals** (approved before a confirmed update) and a what-if force are approved first. They are never silently un-approved.
  3. Loop: rank the remaining by adjusted score = score − penalty versus *newly approved* partners in this run (same 2 km rule), then by faster launch (onboarding weeks), then by ID.
     - **Tie-break:** if the top two are within 3 points and #2 launches sooner, swap them and log it on both.
     - If the top applicant's pin is already taken → Waitlisted ("Pin X is already allocated to Y (higher fit score); only one store per pin. Free pins in T: …").
     - Else if slots remain → Approved (apply the penalty to the stored score, with a note "−p for being ~d km from newly approved Z"; headline "Approved for T: fit score S/100, rank r of n slot(s), pin P is free.").
     - Else → Waitlisted (the penalty is applied to the score as well). If the applicant now outranks a locked approval, keep the locked one Approved but set `bumpFlag` for human review.
  4. Waitlist ranks #1..n with next actions. Approved next actions = the onboarding stages.
  5. Territory warnings: pins with existing stores; no approvals.

**Onboarding plan** (per approval):
- Agreement & KYC (1 wk).
- Funding proof (2 wk) if investment < 1.2 × floor or there are funding signals.
- Site (2 wk; 3 if Upper floor; extra tasks for compact size or unknown size).
- Licences in parallel (Shops & Establishments ₹810, trade licence, GST).
- Fit-out & stock (5 wk).
- Training in the preferred language: 1 wk if ≥ 3 yrs experience, else 2 wk plus a "running a shop" module.
- Realistic date = today + total weeks. Flag the gap if the target is shorter. If timing mentions Diwali, flag that Diwali 8 Nov 2026 is not achievable.
- **Payback** (low-confidence, shown as context only, never scored): investment ÷ (revenue × margin − rent − staff × min wage) as a range.

## 7. Chat (`/api/chat`)
- Send `{message, context}`. The context holds counts, territories, and every applicant's status, headline, question, score, breakdown, reasons, next actions and cleaned fields.
- Prompt: "You may ONLY use the records in CONTEXT… If not in the records, say so."
- Gemini returns `{intent: question|update|whatif, answer, patches: [{appId, field, newValue}], forceApprove}`.
  - Allowed patch fields: name, city, state, pin, investment, experience, business, space, size, floor, target, language, notes.
  - On failure → 503 `gemini_unavailable`. The client then uses a regex fallback for simple updates and questions.
- **Update:** show a preview (old → new values and a before/after decision diff). On **Confirm**, apply the patches, lock the current approvals and append to the Change log.
- **What-if:** show the preview only; nothing is saved.
- `diffResults(before, after)` lists every applicant whose status or score changed, with the new headline.

## 8. Welcome notes (`/api/welcome`)
- Input: `items` (id, name, city, territory, language, launchDate, firstStep). An empty list returns immediately.
- Prompt: warm, ≤ 70 words, in Kannada script / Devanagari Hindi / English. Mention the city, the realistic launch date and the first step. Promise nothing else.
- Client fallback: fixed Kannada/Hindi/English templates.

## 9. Security & public deploy
- Public deploy, no passcode (user decision): `APP_PASSCODE` stays unset, and Vercel deployment protection is off.
- `lib/gate.ts` returns 401 only if `APP_PASSCODE` is set and the `x-app-passcode` header differs. The client `api()` helper sends the stored passcode and prompts on 401. This keeps a passcode one env var away.
- `GEMINI_API_KEY` is set as an encrypted Vercel env var (production + preview). It is never echoed.
- `lib/gemini.ts`:
  - POST `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` with the `x-goog-api-key` header.
  - Models: `gemini-3.8-flash`, then `gemini-3.6-flash`.
  - `generationConfig: {temperature: 0, responseMimeType: "application/json"}`, with a 25 s abort.
  - Concatenate only parts that have a `text` field (skip thoughtSignature parts), strip code fences, JSON.parse. Return null on failure.

## 10. UI (retail look, own brand "PartnerScope")
- **Brand:** our own name "PartnerScope" with a "P" monogram logo. The look is inspired by a modern eyewear-retail site (deep navy + aqua, airy white layout). Do NOT use any real retailer's name, logo or imagery.
- **Palette:** bg #f7f8fb, surface #fff, ink/primary deep navy #000042, aqua accents #00bac6 / #11daac, lines #e3e6ef; radius 16, soft navy-tinted shadows.
- **Typography:** Inter/system font with Noto Kannada/Devanagari fallbacks, bold (800) headings.
- **Top nav (sticky, white):** logo + "PartnerScope / Franchise partner engine", links (How it works, Territories, Onboarding; hidden on mobile), pill CTAs (Upload applications, or Export CSV + New upload once results show).
- **Kannada touches (light):** "Namaskara · ನಮಸ್ಕಾರ" greeting above the hero headline; "Dhanyavadagalu · ಧನ್ಯವಾದಗಳು (thank you)" in the footer and after the welcome note in the onboarding drawer. All other UI text is English; test data is English (no Hinglish).
- **Hero:** navy gradient promo banner with an aqua glow, a "Partner with us" pill, headline "Grow the store network with the right partners, in the right pin codes." (accent words in aqua) and an aqua pill CTA "Try the sample data →"; 3 step cards below; drop zone card on the right.
- **Status chips** (pill with a dot): Approved green #1f7a4d/#e6f4ec, Waitlisted blue #33598f/#e8eef8, On hold amber #8a5a00/#fbf1dc, Rejected rose #a3333d/#fbe9ea, Invalid grey.
- **Layout:**
  - Results header: eyebrow "Case 1 · Partner acquisition, geo-selection & onboarding", title "Partner decisions", one-line principle.
  - Upload: dashed drop zone, "Load sample data", Sample 2 and Sample 3 buttons.
  - 6 summary tiles (All + each status) with a coloured top border, rounded 18px, and a progress bar (All tile = slots filled of total); clicking one filters the table.
  - Segmented tabs: Decisions (filter + search; columns ID, Applicant, Location (city + pin), Territory, Status chip (+ waitlist #, ⚑ needs review), Fit, Why (+ question)); Territories (slots filled, approved, waitlist, people per store from Census 2011, context only); Change log (updates, data warnings, automatic fixes); Assumptions & sources.
  - Right column: sticky chat card.
  - Detail drawer (slide-over): ID, name, chip, headline, question note, score bars per component with notes, reasons with kind labels and evidence, next actions, context (nearest store, payback, text source), onboarding stages, welcome note, and the cleaned record.

## 11. Reference data (`lib/data/reference.json`)
- `coords`: pin → [lat, lon]. Approximate pin centres from OpenStreetMap Nominatim, filtered to within 60 km of the city centre, covering all pins in the allowed cities and the test files (≈280).
- `dopPins`: India Post 2019 directory pins for the 7 cities. A missing pin is a warning only.
- `cities`: Census 2011 urban-agglomeration population.
- `sources`: the cited sources list.
- If this file is available from the original repo, copy it as-is; otherwise regenerate it with Nominatim at ≤ 1 request/second.

## 12. Test workbooks (`scripts/make_tests.py`, from the template)
- **test_1_mixed_traps.xlsx** keeps both example rows. Territories: TER-01 (example), TER-B1 (Bengaluru 560011, 560041, 560070; 2 slots; High), TER-B2, TER-M1 (Mysuru 570001/2/8/9; overlaps TER-01 → warnings), TER-T1 (Tumakuru), TER-D1 (Davanagere, Low), TER-MG, TER-H1. Applicants APP-002…APP-023 cover:
  - existing-store pin, pin outside territories, Chennai, investment < 70%, 70–99% funding gap, pin/city mismatch
  - APP-012 with no site; APP-013 rupee/lakh error; duplicate APP-002 and a missing ID
  - Rented with blank size; exclusivity red flag; Not yet identified + size
  - APP-008 "Ran my own mobile shop for 5 years" with 0 entered; APP-007 vague family shop
  - same-pin competition APP-003 vs APP-004; below-bar APP-021 and APP-023
- **test_2_dirty_data.xlsx** has no Existing stores sheet (built-in list is used) and no example rows. Dirty values: aliases, "45 lakh", crore, odd case, "560011,560041;560076". 570008 sits in TER-02 and TER-03. Includes APP-033 Hinglish (experience 0) and APP-039 (Rented + "Rented a shop but still searching for a better location").
- **test_3_competition.xlsx** has TER-JN (2 slots: APP-101…APP-106 close pins 560011/560041/560004/560069) and TER-MY (APP-107 vs APP-108 at 570023, 1.2 km from ST-06).

## 13. Invariant tests (`tests/invariants.test.ts`, must print ALL PASSED)
- For every file:
  - no two approvals share a pin
  - no approval on an existing-store pin
  - approvals ≤ slots per territory
  - every applicant has a status, a headline and next actions
  - every row gets a decision
  - determinism (run twice, deep-equal)
- **T1 traps:**
  - Applications example skipped; TER-01 kept as a normal territory
  - existing-store reject, outside-territory reject, out-of-scope reject, < 70% reject
  - funding-gap hold, pin/city mismatch hold, no-site hold, unit-error hold, blank-size hold, red-flag hold, Not-yet+size hold
  - APP-008 experience contradiction hold
  - duplicate and missing ID → Invalid
- **T2:** APP-039 has no hold for "better location" and does carry the warning.
- **Family rule:**
  - APP-007 is not held or asked about family experience, gets experience 0 and background 3, and its score is identical in keyword and favourable-Gemini runs.
  - APP-033 gets the contradiction hold with the "3 years" question in both paths.
- **T3:**
  - the 2 km penalty fires for APP-108 (−4 at ~1.2 km from ST-06)
  - the penalty versus newly approved partners (APP-102 −4.5 at ~1.1 km from APP-101)
  - 560069 shows "Distance unknown"
- **Update:** APP-012 patched to Rented / 600 / Ground ⇒ On hold 49.4 → Approved 65.4; no locked approval removed; invariants still hold.

**Expected keyword-mode counts:**
- T1: Approved 4, Waitlisted 1, On hold 11, Rejected 5, Invalid 2.
- T2: 4 / 0 / 4 / 2 / 0.
- T3: 3 / 3 / 2 / 0 / 0.

## 14. Assumptions & sources tab
- Show every CONFIG number with its source and confidence.
- Revenue: 2019 interview (LOW). Margin: brand franchise portal. Rent: T1 broker ranges (LOW); T2/T3 are team assumptions.
- Minimum wage: Karnataka 2026-27 (HIGH). Shops & Establishments fee ₹810. Census 2011. India Post 2019. OSM Nominatim.
- Stated limitations: distances are approximate pin centres; payback is indicative only; Gemini output is advisory and validated, and the rules decide.
