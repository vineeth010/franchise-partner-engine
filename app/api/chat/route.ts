import { NextResponse } from "next/server";
import { geminiJSON } from "@/lib/gemini";
import { gate } from "@/lib/gate";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const blocked = gate(req); if (blocked) return blocked;
  const { message, context } = (await req.json()) as { message: string; context: unknown };
  const prompt = `You are the assistant inside a franchise-partner selection tool. You may ONLY use the records in CONTEXT below. Never invent applicants, numbers or reasons. If the answer is not in the records, say so.
Classify the user's message:
- "question": answer from the records. Quote the decision headline/reasons. Keep it under 120 words.
- "update": the user reports new information about an applicant (e.g. "APP-012 found a rented shop of 600 sq ft on ground floor"). Produce patches. Allowed fields: name, city, state, pin, investment, experience, business, space (Owned|Rented|Not yet identified), size (number, sq ft), floor (Ground|Upper|Mall unit|Not known), target (months), language, notes. One patch per field. Do NOT apply anything; the user will confirm.
- "whatif": a hypothetical ("what if X had 50 lakh", "what if APP-007 is approved"). Return whatIf with either patches or forceApprove appId. It will be simulated only.
Return JSON: {"intent":"question"|"update"|"whatif","answer":string,"patches":[{"appId":string,"field":string,"newValue":string}],"forceApprove":string|null}
CONTEXT: ${JSON.stringify(context).slice(0, 180000)}
USER: ${message}`;
  const r = await geminiJSON(prompt, 30000);
  if (!r) return NextResponse.json({ error: "gemini_unavailable" }, { status: 503 });
  return NextResponse.json({ ...(r.data as object), model: r.model });
}
