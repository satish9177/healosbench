import type { MedicalRecord } from "./loader";
import { f1Score, fuzzyScore, normalizeText, vitalsScore } from "./metrics";

export type EvaluationResult = {
  fieldScores: {
    chief_complaint: number;
    vitals: number;
    medications: number;
    diagnoses: number;
    plan: number;
    follow_up: number;
  };
  hallucinations: string[];
  debug: {
    missingInPrediction: string[];
    extraInPrediction: string[];
  };
  overallScore: number;
  finalScore: number;
};

function toSafeArray(values: string[] | null | undefined): string[] {
  if (!values) {
    return [];
  }
  return values.filter((value): value is string => typeof value === "string");
}

function toSafeText(value: string | null | undefined): string {
  return typeof value === "string" ? value : "";
}

function collectCandidateValues(record: Partial<MedicalRecord>): string[] {
  return [
    toSafeText(record.chief_complaint),
    toSafeText(record.follow_up),
    ...toSafeArray(record.medications),
    ...toSafeArray(record.diagnoses),
    ...toSafeArray(record.plan),
  ].filter((value) => value.trim().length > 0);
}

function collectDiff(
  prediction: Partial<MedicalRecord>,
  gold: Partial<MedicalRecord>,
): { missingInPrediction: string[]; extraInPrediction: string[] } {
  const predictionValues = collectCandidateValues(prediction);
  const goldValues = collectCandidateValues(gold);

  const predictionMap = new Map<string, string>();
  const goldMap = new Map<string, string>();

  for (const value of predictionValues) {
    const key = normalizeText(value);
    if (key && !predictionMap.has(key)) {
      predictionMap.set(key, value);
    }
  }

  for (const value of goldValues) {
    const key = normalizeText(value);
    if (key && !goldMap.has(key)) {
      goldMap.set(key, value);
    }
  }

  const missingInPrediction: string[] = [];
  const extraInPrediction: string[] = [];

  for (const [key, value] of goldMap.entries()) {
    if (!predictionMap.has(key)) {
      missingInPrediction.push(value);
    }
  }

  for (const [key, value] of predictionMap.entries()) {
    if (!goldMap.has(key)) {
      extraInPrediction.push(value);
    }
  }

  return { missingInPrediction, extraInPrediction };
}

function detectHallucinationsFromValues(values: string[], transcript: string): string[] {
  const transcriptNorm = normalizeText(transcript);
  const transcriptTokens = new Set(transcriptNorm.split(" ").filter(Boolean));

  const hallucinations: string[] = [];
  const seen = new Set<string>();

  // Kept intentionally small: we want simple, predictable grounding.
  const STOPWORDS = new Set([
    "a",
    "an",
    "and",
    "as",
    "at",
    "by",
    "care",
    "chronic",
    "couple",
    "difficulty",
    "essential",
    "for",
    "from",
    "if",
    "in",
    "into",
    "months",
    "mellitus",
    "of",
    "on",
    "only",
    "or",
    "recheck",
    "return",
    "severe",
    "suspected",
    "symptoms",
    "the",
    "to",
    "uncontrolled",
    "urgent",
    "with",
    "worsen",
    "type",
  ]);

  for (const value of values) {
    const valueNorm = normalizeText(value);
    if (!valueNorm) {
      continue;
    }

    // Tiny set of common clinical abbreviations / paraphrases in transcripts.
    if (
      (valueNorm.includes("gastroesophageal reflux disease") &&
        transcriptTokens.has("gerd")) ||
      (valueNorm.includes("irritable bowel syndrome") && transcriptTokens.has("ibs")) ||
      (valueNorm.includes("influenza") && transcriptTokens.has("flu")) ||
      (valueNorm.includes("covid") && transcriptTokens.has("covid"))
    ) {
      continue;
    }

    const valueTokens = valueNorm
      .split(" ")
      .filter(Boolean)
      .filter((t) => !/^\d+$/.test(t))
      .filter((t) => t.length > 2)
      .filter((t) => !STOPWORDS.has(t));

    if (valueTokens.length === 0) {
      continue;
    }

    let matched = 0;
    for (const token of valueTokens) {
      if (transcriptTokens.has(token)) {
        matched += 1;
      }
    }

    // Long values often contain extra words not literally present in the transcript
    // (e.g. "supportive care with ..."). To avoid false positives, cap the
    // denominator so we only require "most" of a few key tokens to appear.
    const denom = Math.min(valueTokens.length, 4);
    const matchRatio = Math.min(matched, denom) / denom;
    const isGrounded = matchRatio >= 0.6;

    if (!isGrounded && !seen.has(valueNorm)) {
      seen.add(valueNorm);
      hallucinations.push(value);
    }
  }

  return hallucinations;
}

export function evaluate(
  prediction: Partial<MedicalRecord>,
  gold: Partial<MedicalRecord>,
  transcript: string,
): EvaluationResult {
  const safePrediction = {
    chief_complaint: toSafeText(prediction.chief_complaint),
    vitals: {
      bp: prediction.vitals?.bp ?? null,
      hr: prediction.vitals?.hr ?? null,
      temp_f: prediction.vitals?.temp_f ?? null,
      spo2: prediction.vitals?.spo2 ?? null,
    },
    medications: toSafeArray(prediction.medications),
    diagnoses: toSafeArray(prediction.diagnoses),
    plan: toSafeArray(prediction.plan),
    follow_up: toSafeText(prediction.follow_up),
  };

  const safeGold = {
    chief_complaint: toSafeText(gold.chief_complaint),
    vitals: {
      bp: gold.vitals?.bp ?? null,
      hr: gold.vitals?.hr ?? null,
      temp_f: gold.vitals?.temp_f ?? null,
      spo2: gold.vitals?.spo2 ?? null,
    },
    medications: toSafeArray(gold.medications),
    diagnoses: toSafeArray(gold.diagnoses),
    plan: toSafeArray(gold.plan),
    follow_up: toSafeText(gold.follow_up),
  };

  const fieldScores = {
    chief_complaint: fuzzyScore(safePrediction.chief_complaint, safeGold.chief_complaint),
    vitals: vitalsScore(safePrediction.vitals, safeGold.vitals),
    medications: f1Score(safePrediction.medications, safeGold.medications),
    diagnoses: f1Score(safePrediction.diagnoses, safeGold.diagnoses),
    plan: f1Score(safePrediction.plan, safeGold.plan),
    follow_up: fuzzyScore(safePrediction.follow_up, safeGold.follow_up),
  };

  const overallScore =
    (fieldScores.chief_complaint +
      fieldScores.vitals +
      fieldScores.medications +
      fieldScores.diagnoses +
      fieldScores.plan +
      fieldScores.follow_up) /
    6;

  const debug = collectDiff(safePrediction, safeGold);

  // Hallucinations are values that are EXTRA vs gold and also not grounded.
  // This makes the signal model-focused (and ensures prediction=gold yields 0).
  const hallucinations = detectHallucinationsFromValues(
    debug.extraInPrediction,
    transcript,
  );

  const penalty = hallucinations.length * 0.02;
  const finalScore = Math.max(0, overallScore - penalty);

  return { fieldScores, hallucinations, debug, overallScore, finalScore };
}