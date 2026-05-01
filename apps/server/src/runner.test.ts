import { describe, expect, test } from "bun:test";
import {
  extractWithGenerator,
  getPromptHash,
  type ExtractionStrategy,
} from "./extractor";
import { getCacheKey } from "./cache";
import { evaluate } from "./evaluator";
import { toMedicalRecord, type RawExtraction } from "./loader";

function validExtraction(): RawExtraction {
  return {
    chief_complaint: "sore throat",
    vitals: { bp: "120/80", hr: 80, temp_f: 98.6, spo2: 98 },
    medications: [{ name: "ibuprofen", dose: "200 mg", frequency: "BID", route: "PO" }],
    diagnoses: [{ description: "viral pharyngitis", icd10: "J02.9" }],
    plan: ["fluids", "rest"],
    follow_up: { interval_days: 7, reason: "symptom check" },
  };
}

describe("runner-related reliability tests", () => {
  test("Schema retry test retries invalid then succeeds", async () => {
    let calls = 0;
    const generateJson = async (): Promise<unknown> => {
      calls += 1;
      if (calls === 1) {
        return { chief_complaint: "invalid_only" };
      }
      return validExtraction();
    };

    const result = await extractWithGenerator("Transcript text", "zero_shot", generateJson);
    expect(calls).toBe(2);
    expect(result.chief_complaint).toBe("sore throat");
    expect(Array.isArray(result.medications)).toBeTrue();
  });

  test("Idempotency test uses cache on second run", async () => {
    const transcript = "Patient has sore throat and takes ibuprofen.";
    const strategy: ExtractionStrategy = "zero_shot";
    const inMemoryCache = new Map<string, RawExtraction>();

    let extractCalls = 0;
    const mockExtract = async (): Promise<RawExtraction> => {
      extractCalls += 1;
      return validExtraction();
    };

    const runOnce = async (): Promise<void> => {
      const key = getCacheKey(transcript, strategy);
      const cached = inMemoryCache.get(key);
      const predictionRaw = cached ?? (await mockExtract());
      if (!cached) {
        inMemoryCache.set(key, predictionRaw);
      }
      const prediction = toMedicalRecord(predictionRaw);
      const gold = toMedicalRecord(validExtraction());
      const result = evaluate(prediction, gold, transcript);
      expect(Number.isFinite(result.finalScore)).toBeTrue();
    };

    await runOnce();
    await runOnce();

    expect(extractCalls).toBe(1);
    expect(inMemoryCache.size).toBe(1);
  });

  test("Prompt hash stability remains deterministic", () => {
    const promptA = "Extract structured medical data";
    const promptA2 = "Extract structured medical data";
    const promptB = "Extract structured medical data.";

    const hashA = getPromptHash(promptA);
    const hashA2 = getPromptHash(promptA2);
    const hashB = getPromptHash(promptB);

    expect(hashA).toBe(hashA2);
    expect(hashA).not.toBe(hashB);
  });

  test("Rate limit backoff retries on 429 then succeeds", async () => {
    let calls = 0;
    const slept: number[] = [];
    const generateJson = async (): Promise<unknown> => {
      calls += 1;
      if (calls === 1) {
        const error = new Error("rate limited") as Error & { status: number };
        error.status = 429;
        throw error;
      }
      return validExtraction();
    };

    const result = await extractWithGenerator(
      "Transcript text",
      "few_shot",
      generateJson,
      {
        baseBackoffMs: 5,
        sleepMs: async (ms: number) => {
          slept.push(ms);
        },
      },
    );

    expect(calls).toBe(2);
    expect(slept).toEqual([5]);
    expect(result.plan.length).toBeGreaterThan(0);
  });

  test("Resumability resumes from cache after crash", async () => {
    const strategy: ExtractionStrategy = "zero_shot";
    const caseIds = ["case_001", "case_002", "case_003", "case_004", "case_005"];
    const transcripts = caseIds.map((id) => `${id} transcript content`);
    const inMemoryCache = new Map<string, RawExtraction>();

    const extractCalledFor: string[] = [];
    const cacheLoadedFor: string[] = [];

    const mockExtract = async (caseId: string): Promise<RawExtraction> => {
      extractCalledFor.push(caseId);
      return validExtraction();
    };

    const runCases = async (crashAfterIndex?: number): Promise<string[]> => {
      const completed: string[] = [];
      for (let i = 0; i < caseIds.length; i += 1) {
        const caseId = caseIds[i];
        const transcript = transcripts[i];
        if (!caseId || !transcript) {
          throw new Error("test data mismatch");
        }
        const key = getCacheKey(transcript, strategy);
        const cached = inMemoryCache.get(key);

        if (cached) {
          cacheLoadedFor.push(caseId);
          completed.push(caseId);
        } else {
          const extracted = await mockExtract(caseId);
          inMemoryCache.set(key, extracted);
          completed.push(caseId);
        }

        if (crashAfterIndex !== undefined && i === crashAfterIndex) {
          throw new Error("simulated crash");
        }
      }
      return completed;
    };

    await expect(runCases(2)).rejects.toThrow("simulated crash");
    expect(inMemoryCache.size).toBe(3);
    expect(extractCalledFor).toEqual(["case_001", "case_002", "case_003"]);

    const completedAfterResume = await runCases();

    expect(cacheLoadedFor).toEqual(["case_001", "case_002", "case_003"]);
    expect(extractCalledFor).toEqual([
      "case_001",
      "case_002",
      "case_003",
      "case_004",
      "case_005",
    ]);
    expect(completedAfterResume).toEqual(caseIds);
  });
});
