// ALL tunable thresholds live here. Change a number, re-run, and every decision updates.
export const CONFIG = {
  assumedFormat: "Branded eyewear retail showroom (sector M1)",
  investmentFloorLakh: { "Tier 1": 40, "Tier 2": 35, "Tier 3": 20 } as Record<string, number>,
  fundingHoldBand: 0.7, // >=70% and <100% of floor -> hold with funding-gap question; <70% -> reject
  probableRupeeErrorAboveLakh: 500, // > 500 lakh (= Rs 5 crore) is probably rupees typed into the lakh field
  minFitByPriority: { High: 45, Medium: 50, Low: 60 } as Record<string, number>,
  tieWindowPoints: 3,
  cannibalisationRadiusKm: 2,
  maxProximityPenalty: 10,
  weights: { capital: 30, site: 25, experience: 25, background: 10, timeline: 10 },
  experienceCapYears: 8,
  idealSizeSqft: [500, 1000] as [number, number],
  fundingProofIfWithinPctOfFloor: 0.2,
  allowedCities: {
    Bengaluru: { prefix: "560", tier: "Tier 1" },
    Mysuru: { prefix: "570", tier: "Tier 2" },
    Mangaluru: { prefix: "575", tier: "Tier 2" },
    "Hubballi-Dharwad": { prefix: "580", tier: "Tier 2" },
    Belagavi: { prefix: "590", tier: "Tier 2" },
    Tumakuru: { prefix: "572", tier: "Tier 3" },
    Davanagere: { prefix: "577", tier: "Tier 3" },
  } as Record<string, { prefix: string; tier: string }>,
  cityAliases: {
    bangalore: "Bengaluru", bengaluru: "Bengaluru", blr: "Bengaluru", "bengaluru urban": "Bengaluru",
    mysore: "Mysuru", mysuru: "Mysuru", mangalore: "Mangaluru", mangaluru: "Mangaluru",
    hubli: "Hubballi-Dharwad", hubballi: "Hubballi-Dharwad", dharwad: "Hubballi-Dharwad",
    "hubli-dharwad": "Hubballi-Dharwad", "hubballi-dharwad": "Hubballi-Dharwad", "hubballi dharwad": "Hubballi-Dharwad", "hubli dharwad": "Hubballi-Dharwad",
    belgaum: "Belagavi", belagavi: "Belagavi", tumkur: "Tumakuru", tumakuru: "Tumakuru",
    davangere: "Davanagere", davanagere: "Davanagere", davangere_: "Davanagere",
  } as Record<string, string>,
  // Payback inputs (LOW confidence). Revenue: Lenskart 2019 interview (S02). Margin: Lenskart portal (S01).
  monthlyRevenueLakh: { "Tier 1": [8, 10], "Tier 2": [8, 10], "Tier 3": [4, 6] } as Record<string, [number, number]>,
  marginPct: [0.25, 0.3] as [number, number],
  // Rent Rs/sq ft/month. Tier 1 from Bengaluru broker ranges (S32, LOW). Tier 2/3 have NO source: team assumption.
  rentPerSqft: { "Tier 1": [70, 150], "Tier 2": [35, 70], "Tier 3": [25, 45] } as Record<string, [number, number]>,
  staffCount: [2, 3] as [number, number],
  // Karnataka statutory minimum wage, skilled (salesman / optical), Rs/month, 2026-27 (S21, HIGH)
  skilledMinWage: { "Tier 1": 18570.47, "Tier 2": 17902.79, "Tier 3": 17902.79 } as Record<string, number>,
  defaultSizeForPayback: 600,
  shopsEstablishmentFee: "Rs 810 for 1-9 employees (Karnataka, amended Schedule I, 2025)",
};
export type Tier = "Tier 1" | "Tier 2" | "Tier 3";
