export type Status = "Approved" | "Waitlisted" | "On hold" | "Rejected" | "Invalid record";

export interface RawApplication {
  row: number;
  id: string; name: string; city: string; state: string; pin: string;
  investment: string; experience: string; business: string; space: string; size: string;
  floor: string; target: string; language: string; notes: string;
}
export interface Territory { id: string; city: string; state: string; pins: string[]; tier: string; slots: number; priority: string; row: number }
export interface Store { id: string; city: string; pin: string; year: string }

export interface Quote { text: string; quote: string }
export interface TextInsight {
  background: "direct_retail" | "adjacent" | "unrelated" | "unknown";
  backgroundQuote: string;
  statedOwnYears: number | null;
  statedQuote: string;
  familyNotOwn: boolean; familyQuote: string;
  spaceContradiction: boolean; spaceQuote: string; spaceDoubt?: boolean; spaceDoubtQuote?: string;
  timing: Quote[]; funding: Quote[]; redFlags: Quote[];
  source: "gemini" | "keywords";
}

export interface CleanApp {
  row: number; id: string; name: string; city: string; state: string; pin: string;
  investment: number | null; experience: number | null; business: string;
  space: string; size: number | null; floor: string; target: number | null;
  language: string; notes: string;
  sizeToConfirm?: boolean; // set when a site was reported via chat update without a size
}

export interface Reason { kind: "fix" | "hold" | "reject" | "info" | "warning" | "score" | "allocation"; text: string; evidence?: string }
export interface ScoreBreakdown { capital: number; site: number; experience: number; background: number; timeline: number; proximityPenalty: number; total: number; notes: Record<string, string> }
export interface Stage { name: string; weeks: number; tasks: string[] }
export interface Onboarding { stages: Stage[]; totalWeeks: number; realisticMonths: number; realisticDate: string; targetMonths: number | null; gapFlag: string | null; trainingLanguage: string }
export interface Decision {
  id: string; row: number; name: string; city: string; pin: string;
  territoryId: string | null; tier: string | null; priority: string | null;
  status: Status; headline: string; question?: string;
  eligible: boolean; readiness: string;
  reasons: Reason[]; fixes: string[];
  score: ScoreBreakdown | null;
  nearestStore: { storeId: string; km: number | null; label: string } | null;
  payback: { lowMonths: number | null; highMonths: number | null; text: string } | null;
  onboarding: Onboarding | null;
  nextActions: string[];
  waitlistRank?: number;
  bumpFlag?: string;
  insight?: TextInsight;
  app?: CleanApp;
}
export interface EngineInput { apps: RawApplication[]; territories: Territory[]; stores: Store[]; insights: Record<string, TextInsight>; patches?: Patch[]; lockedApproved?: string[]; forceApprove?: string; today?: string; parseWarnings?: string[] }
export interface Patch { appId: string; field: keyof RawApplication; newValue: string; note?: string }
export interface EngineResult { decisions: Decision[]; territories: (Territory & { approved: string[]; waitlisted: string[]; filled: number; warnings: string[] })[]; warnings: string[]; counts: Record<string, number> }
