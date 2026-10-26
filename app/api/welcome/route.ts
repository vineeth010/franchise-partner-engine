import { NextResponse } from "next/server";
import { geminiJSON } from "@/lib/gemini";
import { gate } from "@/lib/gate";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const blocked = gate(req); if (blocked) return blocked;
  const { items } = (await req.json()) as { items: { id: string; name: string; city: string; territory: string; language: string; launchDate: string; firstStep: string }[] };
  const list = (items || []).slice(0, 60);
  if (!list.length) return NextResponse.json({ notes: [], model: null });
  const prompt = `Write a short, warm welcome note (max 70 words) for each newly approved franchise partner of a branded retail showroom chain in Karnataka. Write it in the partner's preferred language (Kannada in Kannada script, Hindi in Devanagari, else English). Mention their city, the realistic launch date and the first step. Do not promise anything else. Return JSON {"notes":[{"id":string,"note":string}]}.
Partners: ${JSON.stringify(list)}`;
  const r = await geminiJSON(prompt);
  const notes = ((r?.data as { notes?: { id: string; note: string }[] })?.notes) || [];
  return NextResponse.json({ notes, model: r?.model || null });
}
