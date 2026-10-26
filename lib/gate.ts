// Optional passcode gate for the Gemini routes. Off unless APP_PASSCODE is set on the server.
// To enable: set APP_PASSCODE in Vercel env; the client sends it as the "x-app-passcode" header.
import { NextResponse } from "next/server";
export function gate(req: Request): NextResponse | null {
  const need = process.env.APP_PASSCODE;
  if (!need) return null;
  return req.headers.get("x-app-passcode") === need ? null : NextResponse.json({ error: "passcode_required" }, { status: 401 });
}
