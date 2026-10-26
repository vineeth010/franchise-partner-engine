// Server-only Gemini helper. The key is read from process.env and never sent to the browser.
const MODELS = ["gemini-3.8-flash", "gemini-3.6-flash"];

export async function geminiJSON(prompt: string, timeoutMs = 25000): Promise<{ data: unknown; model: string } | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  for (const m of MODELS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "low" } } }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) continue;
      const j = await res.json();
      const text = (j?.candidates?.[0]?.content?.parts || []).filter((p: { text?: string }) => typeof p.text === "string").map((p: { text: string }) => p.text).join("");
      if (!text) continue;
      const clean = text.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
      return { data: JSON.parse(clean), model: m };
    } catch {
      /* try next model */
    }
  }
  return null;
}
