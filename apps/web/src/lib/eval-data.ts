export type StrategySummary = {
  strategy: "zero_shot" | "few_shot" | "cot";
  avgOverallScore: number;
  avgFinalScore: number;
  avgHallucinationPenalty: number;
  cases: number;
};

export const STRATEGY_SUMMARIES: StrategySummary[] = [
  {
    strategy: "zero_shot",
    avgOverallScore: 0.8897,
    avgFinalScore: 0.8809,
    avgHallucinationPenalty: 0.0088,
    cases: 50,
  },
  {
    strategy: "few_shot",
    avgOverallScore: 0.9377,
    avgFinalScore: 0.9349,
    avgHallucinationPenalty: 0.0028,
    cases: 50,
  },
  {
    strategy: "cot",
    avgOverallScore: 0.9868,
    avgFinalScore: 0.9864,
    avgHallucinationPenalty: 0.0004,
    cases: 50,
  },
];

export type FieldCompare = {
  field: string;
  zero_shot: number;
  few_shot: number;
  cot: number;
};

export const FIELD_COMPARISON: FieldCompare[] = [
  { field: "chief_complaint", zero_shot: 0.88, few_shot: 0.94, cot: 0.99 },
  { field: "vitals", zero_shot: 0.93, few_shot: 0.97, cot: 0.995 },
  { field: "medications", zero_shot: 0.82, few_shot: 0.91, cot: 0.98 },
  { field: "diagnoses", zero_shot: 0.86, few_shot: 0.93, cot: 0.985 },
  { field: "plan", zero_shot: 0.84, few_shot: 0.92, cot: 0.98 },
  { field: "follow_up", zero_shot: 0.91, few_shot: 0.95, cot: 0.989 },
];
