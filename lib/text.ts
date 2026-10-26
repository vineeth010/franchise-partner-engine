import type { RawApplication, TextInsight, Quote } from "./types";

// Keyword fallback used when Gemini is unavailable. Deterministic.
const DIRECT = /(shop|store|showroom|retail|boutique|outlet|kirana|supermarket|franchise|optical|optician|eyewear|spectacle|angadi|dukaan|dukan|ಅಂಗಡಿ|दुकान)/i;
const ADJ = /(mobile|pharmacy|medical store|chemist|footwear|shoe|apparel|garment|clothing|textile|saree|electronics|jewell|watch|cosmetic|salon|bakery|stationery|book)/i;
const UNRELATED = /(software|\bit\b|engineer|farming|farmer|agricultur|teacher|government job|govt job|student|bank job|driver|homemaker|housewife|accountant|lawyer|doctor|army|retired)/i;

function snippet(text: string, m: RegExpMatchArray | null): string {
  if (!m || m.index === undefined) return "";
  const s = Math.max(0, text.lastIndexOf(".", m.index) + 1);
  let e = text.indexOf(".", m.index + m[0].length);
  if (e < 0) e = text.length;
  return text.slice(s, e).trim().slice(0, 160);
}

export function keywordInsight(a: Pick<RawApplication, "business" | "notes">): TextInsight {
  const biz = a.business || "";
  const notes = a.notes || "";
  const all = `${biz}. ${notes}`;
  let background: TextInsight["background"] = "unknown";
  let backgroundQuote = "";
  if (biz.trim()) {
    const own = /(run|runs|running|own|owns|owned|manag|nadesu|chalata|chalate|had|ran)/i.test(biz);
    if (ADJ.test(biz) && own) { background = "adjacent"; backgroundQuote = biz; }
    if (DIRECT.test(biz) && own) { background = /(optical|optician|eyewear|spectacle)/i.test(biz) ? "direct_retail" : background === "adjacent" ? "adjacent" : "direct_retail"; backgroundQuote = biz; }
    if (background === "unknown" && UNRELATED.test(biz)) { background = "unrelated"; backgroundQuote = biz; }
    if (background === "unknown") { background = "unrelated"; backgroundQuote = biz; }
  }
  let statedOwnYears: number | null = null; let statedQuote = "";
  const ym = all.match(/(\d{1,2})\s*\+?\s*(years|yrs|year|varsha|saal|sal)\b/i);
  const ownShop = /(my|own|i run|i ran|running|ran|nanna|mera|meri|apni|apna)\b[^.]{0,40}(shop|store|business|angadi|dukaan|dukan)/i;
  const om = all.match(ownShop);
  if (om) { statedQuote = snippet(all, om); if (ym) { statedOwnYears = parseInt(ym[1], 10); statedQuote = snippet(all, ym) || statedQuote; } }
  else if (ym && /(shop|store|retail|business|angadi|dukaan)/i.test(snippet(all, ym))) { statedOwnYears = parseInt(ym[1], 10); statedQuote = snippet(all, ym); }
  const fm = all.match(/(father|dad|appa|papa|pitaji|uncle|brother|family|husband|wife|mother|amma)('s)?\b[^.]{0,50}(shop|store|business|angadi|dukaan|dukan)/i);
  const familyNotOwn = !!fm && !/(i (also )?(run|ran|manage|managed)|with me)/i.test(snippet(all, fm));
  // Space: HOLD only when the text clearly says no space is secured yet; looking for a *better/another* place while holding one is a warning only.
  const spaceRe = /(still (looking|searching)( for)?( a| an)?( \w+)?( (shop|space|place|location|site))?|searching for (a )?(\w+ )?(shop|space|place|location)|not (yet )?(found|finali[sz]ed|identified)|yet to (find|finali[sz]e)|no (shop|space|site) yet|haven'?t (found|got)|hudukta|dhoondh|looking for (a )?(\w+ )?(shop|space|place|location))/i;
  const smAll = all.match(spaceRe);
  const doubtWord = /(better|another|bigger|alternative|other|second|backup|second)\b/i;
  const isDoubt = !!smAll && doubtWord.test(snippet(all, smAll));
  const sm = smAll && !isDoubt ? smAll : null;
  const sd = smAll && isDoubt ? smAll : null;
  const timing: Quote[] = []; const funding: Quote[] = []; const redFlags: Quote[] = [];
  const tm = all.match(/(before|by|after)\s+(diwali|dasara|dussehra|ugadi|deepavali|sankranti|new year|march|april|may|june|july|august|september|october|november|december|january|february)|asap|urgent|immediately|next month/i);
  if (tm) timing.push({ text: tm[0], quote: snippet(all, tm) });
  const fdm = all.match(/(loan|bank|mudra|co-?investor|partner (may|will) (join|invest)|after selling|sell(ing)? (land|property|site)|need funding|finance)/i);
  if (fdm) funding.push({ text: fdm[0], quote: snippet(all, fdm) });
  const r1 = all.match(/exclusive|whole city|entire city|monopoly/i);
  if (r1) redFlags.push({ text: "asks for exclusivity", quote: snippet(all, r1) });
  const r2 = all.match(/(already|currently) (run|have|own|operate)[^.]{0,30}(franchise|titan|lenskart|eye ?plus|specsmakers)/i);
  if (r2) redFlags.push({ text: "may run a competing franchise", quote: snippet(all, r2) });
  return {
    background, backgroundQuote, statedOwnYears, statedQuote, familyNotOwn, familyQuote: fm ? snippet(all, fm) : "",
    spaceContradiction: !!sm, spaceQuote: sm ? snippet(all, sm) : "", spaceDoubt: !!sd, spaceDoubtQuote: sd ? snippet(all, sd) : "", timing, funding, redFlags, source: "keywords",
  };
}

// Deterministic family-shop detector used by the engine regardless of Gemini's reading (user decision: 0 yrs + family shop => hold).
export function familyShopQuote(text: string): string {
  const all = text || "";
  const m = all.match(/(father|dad|appa|papa|pitaji|uncle|brother|family|husband|wife|mother|amma|parents?)('s|’s)?\b[^.]{0,50}(shop|store|business|angadi|dukaan|dukan)/i);
  return m ? snippet(all, m) : "";
}
