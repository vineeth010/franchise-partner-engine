# Progress log (times IST)

## Milestone (a) – engine + scoring done, unit checks passing — 26 Oct 2026, ~9:30 PM IST
- lib/config.ts (all thresholds), lib/types.ts, lib/parse.ts (SheetJS, loose header match, built-in store fallback, exact-match example-row skip),
  lib/text.ts (keyword fallback reader), lib/engine.ts (clean/validate → hold/reject → fit score → greedy allocation High→Medium→Low → onboarding → payback → diff).
- API routes written (server-side Gemini 3.8-flash → 3.6-flash fallback): app/api/extract, app/api/chat, app/api/welcome. Not yet exercised end-to-end.
- `tsc --noEmit` passes.

## Milestone (b) – 3 test Excel files + invariant tests passing — 26 Oct 2026, ~9:30 PM IST
- tests/test_1_mixed_traps.xlsx (template example row kept + APP-012 no-site scenario), tests/test_2_dirty_data.xlsx (no Existing stores sheet, dirty values),
  tests/test_3_competition.xlsx (slot competition, quality bar). Copies in public/ for "Load sample data". Generator: scripts/make_tests.py.
- tests/invariants.test.ts: 43/43 PASS (keyword mode, no Gemini): no two approvals per pin, none on an existing-store pin, approvals ≤ slots,
  every applicant has status + reason + next actions, deterministic, 14 trap expectations, APP-012 update (On hold 49.4 → Approved 65.4) with no silent un-approval.

## Next
- (c) UI + chat locally: app/page.tsx written (typechecks), needs styling pass to the "elegant" bar, next build, local run, chat/Gemini check.
- Merge Nominatim pin coordinates (266/427 done) into lib/data/reference.json so proximity penalties work.
- (d) Deploy via Vercel connector, verify with curl. BUILD_SPEC.md still to write.

## Milestone (c) — UI + chat working locally ✅ (26 Oct 2026, IST)
**User decisions applied**
- Q1: Territories example row TER-01 is now a normal territory (skip logic removed from lib/parse.ts; kept in test 1 & 3 files). Test 2 was already built without the example rows and keeps its own TER-01, so nothing changed there. The Applications example row (APP-001) is still skipped on an exact match.
- Q2: Space hold only when the text clearly says no space yet. New `spaceDoubt` signal (keywords + Gemini): Rented/Owned + "better/another location" → warning + "confirm final shop address before fit-out" next action, no hold. APP-039 is now Approved 76.5 in TER-02.
**Done & verified**
- Elegant restyle: calm slate/teal palette, Inter/system type, status chips with dots (green/blue/amber/rose/grey), coloured tile accents, sticky table headers, segmented tabs, slide-over detail drawer. Screenshots in docs/screens/.
- Passcode-ready: lib/gate.ts (off unless APP_PASSCODE is set) wired into all 3 Gemini routes; the client sends the x-app-passcode header and prompts on 401. Verified on a test port: no code 401, wrong code 401, right code 200.
- `npm test`: ALL PASSED (incl. new checks: TER-01 kept; APP-039 has no hold and does have a warning). `next build`: success.
- Local `next start` :3100: / 200, 3 sample xlsx 200, no browser console errors.
- /api/extract (gemini-3.8-flash): APP-033 (now English: "It's my father's shop, I have been running it for 3 years") → statedOwnYears 3, familyNotOwn false → engine holds it: "Experience field says 0 years but the applicant wrote '3 saal'" (56.9) with a confirm question. APP-039 → spaceDoubt true, spaceContradiction false.
- /api/chat: question (APP-007) answered from the records; update for APP-012 → 3 patches (space Rented, size 600, floor Ground) for a preview, nothing applied; what-if APP-005 40 lakh → simulate patch; "Pune" → "no applicants or territories for Pune in the records".
- /api/welcome: Kannada (APP-002, APP-022), Hindi (APP-004) and English (APP-020) notes with the right launch dates.
- Browser flow (headless Chrome): sample 1 loads, Gemini rerun completes (fell back to gemini-3.6-flash once — fallback works).
**Open question:** with Gemini reading, APP-007 ("My father's saree shop, I help there on weekends", exp 0) scores 51.9 and is Approved in TER-01; keyword mode gives 44.9, which is held.
**Next:** GitHub push once the user signs in.

## (d) Deploy + spec + export — 26 Oct 2026
- APP-007 question resolved (user decision): a vague family-shop mention gets no hold, no question, 0 experience credit and background 3/10 ("no relevant background"), in both Gemini and keyword paths. Stated personal years (APP-033) still trigger the contradiction hold. Tests: 55 PASS / 0 FAIL. Build OK.
- BUILD_SPEC.md written (ready-to-paste Claude Code prompt).
- Clean export prepared at /workspace/franchise-engine-export.
- Vercel: access approved. Project franchise-partner-engine (public, no protection), GEMINI_API_KEY set as an encrypted env var. First deploy failed (Vercel blocks Next 15.5.4, CVE-2025-66478), so Next was upgraded to 15.5.28 / React 19.1.10. Production: https://franchise-partner-engine-vineeth010.vercel.app
- UI restyle: PartnerScope brand, sticky top nav, navy/aqua promo banner, rounded KPI tiles; status chips kept at accessible contrast. Mobile overflow fixed (390px).
- GitHub: not pushed. `gh` is not signed in on the box and there's no repo-create tool; the export is ready to push.
- Live deploys: dpl_G4xd97k28DCXsqJAM7uhJWuCVZ4W (restyle + Next 15.5.28), then dpl_F87HiDsbCPpccVXFHjTRCcEQCcD3 (English test data, light Kannada touches: Namaskara / Dhanyavadagalu). Tests 55 PASS / 0 FAIL.
- Gemini on the live site: NOT active yet. The connector redacts the key value when passing it, so the stored GEMINI_API_KEY is wrong (10 bytes). The app runs on the keyword fallback. Fix: in Vercel → Project → Settings → Environment Variables, paste the real key into GEMINI_API_KEY (Production + Preview), then Redeploy.
