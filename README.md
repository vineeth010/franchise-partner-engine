# PartnerScope: Franchise Partner Acquisition, Geo-Selection & Onboarding Engine

Ops Week Hackathon, Case 1 (Karnataka, branded eyewear retail showroom, sector M1).

**Live app:** https://franchise-partner-engine-vineeth010.vercel.app

Upload the applications workbook (judges' template). The engine validates it (fix, hold or reject), applies hard gates, scores each applicant 0 to 100 (capital 30, site 25, experience 25, background 10, timeline 10), allocates territory slots by priority, and builds a 6-stage onboarding plan. A chat assistant answers questions from the records, previews updates before applying them, and runs what-if simulations. Gemini reads the free text, with a keyword fallback.

- `lib/`: the engine (parse, validate, score, allocate, onboard)
- `app/`: the Next.js UI and API routes (Gemini runs server-side only)
- `tests/`: 3 trap-filled sample workbooks and invariant tests (`npm test`)
- `BUILD_SPEC.md`: full specification and decisions

Run locally: `npm install && npm run dev`, with `GEMINI_API_KEY` set in `.env.local` (optional).
