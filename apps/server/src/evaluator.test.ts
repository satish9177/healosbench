import { describe, expect, test } from "bun:test";
import { evaluate } from "./evaluator";
import { f1Score, fuzzyScore, vitalsScore } from "./metrics";

describe("metrics", () => {
  test("exact match score is 1", () => {
    expect(fuzzyScore("Chest pain", "Chest pain")).toBe(1);
  });

  test("empty vs empty F1 is 1", () => {
    expect(f1Score([], [])).toBe(1);
  });

  test("empty vs non-empty F1 is 0", () => {
    expect(f1Score([], ["ibuprofen"])).toBe(0);
    expect(f1Score(["ibuprofen"], [])).toBe(0);
  });

  test("partial overlap F1 is correct", () => {
    const score = f1Score(["ibuprofen", "metformin"], ["ibuprofen", "lisinopril"]);
    expect(score).toBeCloseTo(0.5, 5);
  });

  test("vitals within tolerance pass", () => {
    const score = vitalsScore(
      { bp: "120/80", hr: 88, temp_f: 100.5, spo2: 98 },
      { bp: "120/80", hr: 88, temp_f: 100.4, spo2: 98 },
    );
    expect(score).toBe(1);
  });

  test("vitals outside tolerance fail", () => {
    const score = vitalsScore(
      { bp: "120/80", hr: 88, temp_f: 101.0, spo2: 98 },
      { bp: "120/80", hr: 88, temp_f: 100.4, spo2: 98 },
    );
    expect(score).toBeCloseTo(0.75, 5);
  });

  test("fuzzy text partial match is between 0 and 1", () => {
    const score = fuzzyScore(
      "sore throat and congestion",
      "sore throat for four days",
    );
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe("evaluator", () => {
  const gold = {
    chief_complaint: "sore throat and cough",
    vitals: { bp: "122/78", hr: 88, temp_f: 100.4, spo2: 98 },
    medications: ["ibuprofen", "ibuprofen"],
    diagnoses: ["viral upper respiratory infection"],
    plan: ["rest and hydration"],
    follow_up: "return if symptoms worsen",
  };

  test("hallucination detection flags unsupported value", () => {
    const prediction = {
      ...gold,
      diagnoses: ["pneumonia"],
    };
    const transcript = "Patient has sore throat and cough. Advise rest and hydration.";

    const result = evaluate(prediction, gold, transcript);

    expect(result.hallucinations.length).toBeGreaterThan(0);
    expect(result.hallucinations).toContain("pneumonia");
    expect(result.finalScore).toBeLessThan(result.overallScore);
  });

  test("hallucination detection ignores grounded values", () => {
    const prediction = { ...gold };
    const transcript =
      "Patient reports sore throat and cough. Diagnosis viral upper respiratory infection. Use ibuprofen. Return if symptoms worsen. Plan rest and hydration.";

    const result = evaluate(prediction, gold, transcript);
    expect(result.hallucinations).toEqual([]);
  });

  test("debug output reports missing and extra values", () => {
    const prediction = {
      ...gold,
      medications: ["acetaminophen"],
      diagnoses: [],
    };

    const result = evaluate(prediction, gold, "");

    expect(result.debug.extraInPrediction).toContain("acetaminophen");
    expect(result.debug.missingInPrediction).toContain("ibuprofen");
    expect(result.debug.missingInPrediction).toContain(
      "viral upper respiratory infection",
    );
  });

  test("handles null/undefined fields without crashing", () => {
    const prediction = {
      chief_complaint: undefined,
      vitals: undefined,
      medications: undefined,
      diagnoses: undefined,
      plan: [],
      follow_up: undefined,
    };

    const result = evaluate(
      prediction,
      {
        chief_complaint: "",
        vitals: { bp: null, hr: null, temp_f: null, spo2: null },
        medications: [],
        diagnoses: [],
        plan: [],
        follow_up: "",
      },
      "",
    );

    expect(Number.isFinite(result.overallScore)).toBeTrue();
    expect(Number.isFinite(result.finalScore)).toBeTrue();
    expect(result.debug.extraInPrediction).toEqual([]);
  });
});
