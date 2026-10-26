import { NextResponse } from "next/server";
import { geminiJSON } from "@/lib/gemini";
import { gate } from "@/lib/gate";
import { keywordInsight } from "@/lib/text";
import type { TextInsight } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const cache = new Map<string, TextInsight>();
const SCHEMA = `{"results":[{"id":string,"background":"direct_retail"|"adjacent"|"unrelated"|"unknown","backgroundQuote":string,"statedOwnYears":number|null,"statedQuote":string,"familyNotOwn":boolean,"familyQuote":string,"spaceContradiction":boolean,"spaceQuote":string,"spaceDoubt":boolean,"spaceDoubtQuote":string,"timing":[{"text":string,"quote":string}],"funding":[{"text":string,"quote":string}],"redFlags":[{"text":string,"quote":string}]}]}`;

export async function POST(req: Request) {
  const blocked = gate(req); if (blocked) return blocked;
  const body = (await req.json()) as { items: { id: string; business: string; notes: string }[] };
  const items = (body.items || []).slice(0, 200);
  const out: Record<string, TextInsight> = {};
  const todo: typeof items = [];
  for (const it of items) {
    const k = JSON.stringify([it.business, it.notes]);
    const c = cache.get(k);
    if (c) out[it.id] = c; else if (!it.business?.trim() && !it.notes?.trim()) out[it.id] = keywordInsight(it); else todo.push(it);
  }
  let model = "cache";
  const chunks: (typeof items)[] = [];
  for (let i = 0; i < todo.length; i += 8) chunks.push(todo.slice(i, i + 8));
  await Promise.all(chunks.map(async (chunk) => {
    const prompt = `You read franchise applications for a branded retail showroom (eyewear-style) in Karnataka. Text may be English, Kannada, Hindi or transliterated Kannada or Hindi. For EACH item extract ONLY what is literally stated; quotes must be exact substrings of the input. Do not guess.
- background: from "business" — direct_retail (runs/ran a shop, store, retail or optical business themselves), adjacent (customer-facing service/sales business like pharmacy, salon, distribution, sales job), unrelated (IT job, farming, teacher, student, etc.), unknown (blank/unclear).
- statedOwnYears: years of the applicant's OWN retail/shop experience if stated in text, else null.
- familyNotOwn: true if the shop experience described belongs to a family member (father, uncle, husband...) rather than the applicant.
- spaceContradiction: true ONLY if the text clearly says they have NO space secured yet (e.g. "still looking for a shop", "not found a place yet"). spaceQuote = exact words.
- spaceDoubt: true if they have a space but mention looking for a better/another/bigger location or may change it (e.g. "rented a shop but still searching for a better location"). This is NOT a contradiction. spaceDoubtQuote = exact words.
- timing: launch timing signals (festival, month, urgency). funding: loans, co-investors, selling property, funding uncertainty. redFlags: requests for exclusivity, running a competing franchise, or other concerns.
Return JSON exactly matching: ${SCHEMA}
Items: ${JSON.stringify(chunk.map((c) => ({ id: c.id, business: c.business, notes: c.notes })))}`;
    const r = await geminiJSON(prompt);
    const results = ((r?.data as { results?: (TextInsight & { id: string })[] })?.results) || [];
    if (r) model = r.model;
    for (const it of chunk) {
      const g = results.find((x) => x.id === it.id);
      let ins: TextInsight;
      if (g) {
        ins = { background: ["direct_retail", "adjacent", "unrelated", "unknown"].includes(g.background) ? g.background : "unknown", backgroundQuote: g.backgroundQuote || "", statedOwnYears: typeof g.statedOwnYears === "number" ? g.statedOwnYears : null, statedQuote: g.statedQuote || "", familyNotOwn: !!g.familyNotOwn, familyQuote: g.familyQuote || "", spaceContradiction: !!g.spaceContradiction, spaceQuote: g.spaceQuote || "", spaceDoubt: !!g.spaceDoubt, spaceDoubtQuote: g.spaceDoubtQuote || "", timing: g.timing || [], funding: g.funding || [], redFlags: g.redFlags || [], source: "gemini" };
        cache.set(JSON.stringify([it.business, it.notes]), ins);
      } else ins = keywordInsight(it);
      out[it.id] = ins;
    }
  }));
  return NextResponse.json({ insights: out, model });
}
