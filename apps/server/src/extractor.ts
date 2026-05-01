import { GoogleGenerativeAI } from "@google/generative-ai";
import { createHash } from "node:crypto";
import type { RawExtraction } from "./loader";

export type ExtractionStrategy = "zero_shot" | "few_shot" | "cot";
export type ExtractOptions = {
  forceRetry?: boolean;
  sleepMs?: (ms: number) => Promise<void>;
  baseBackoffMs?: number;
};

const MODEL = "gemini-1.5-flash";
const MAX_ATTEMPTS = 3;

export function buildPrompt(
  transcript: string,
  strategy: ExtractionStrategy,
  feedback?: string,
): string {
  const baseInstruction = [
    "Extract structured medical data from this transcript.",
    "Return JSON only with this exact object shape:",
    "{",
    '  "chief_complaint": string,',
    '  "vitals": { "bp": string|null, "hr": number|null, "temp_f": number|null, "spo2": number|null },',
    '  "medications": [{ "name": string, "dose": string|null, "frequency": string|null, "route": string|null }],',
    '  "diagnoses": [{ "description": string, "icd10": string|null }],',
    '  "plan": string[],',
    '  "follow_up": { "interval_days": number|null, "reason": string|null }',
    "}",
  ].join("\n");

  if (strategy === "few_shot") {
    const example = [
      "Example transcript: Patient has cough and mild fever. BP 120/80, HR 85, Temp 99.5, SpO2 98. Started azithromycin 500 mg daily PO. Diagnosis bronchitis. Plan rest, fluids. Follow up in 7 days for symptom check.",
      'Example output: {"chief_complaint":"cough and mild fever","vitals":{"bp":"120/80","hr":85,"temp_f":99.5,"spo2":98},"medications":[{"name":"azithromycin","dose":"500 mg","frequency":"daily","route":"PO"}],"diagnoses":[{"description":"bronchitis","icd10":null}],"plan":["rest","fluids"],"follow_up":{"interval_days":7,"reason":"symptom check"}}',
    ].join("\n");
    return `${baseInstruction}\n${example}\nTranscript:\n${transcript}${feedback ? `\n\n${feedback}` : ""}`;
  }

  if (strategy === "cot") {
    return `Think step by step, then return final JSON only.\n${baseInstruction}\nTranscript:\n${transcript}${feedback ? `\n\n${feedback}` : ""}`;
  }

  return `${baseInstruction}\nTranscript:\n${transcript}${feedback ? `\n\n${feedback}` : ""}`;
}

export function getPromptHash(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isNumberOrNull(value: unknown): value is number | null {
  return typeof value === "number" || value === null;
}

function isExtractionValid(value: unknown): value is RawExtraction {
  if (!isObject(value)) {
    return false;
  }
  if (typeof value.chief_complaint !== "string") {
    return false;
  }
  if (!isObject(value.vitals)) {
    return false;
  }
  const vitals = value.vitals;
  if (
    !isStringOrNull(vitals.bp) ||
    !isNumberOrNull(vitals.hr) ||
    !isNumberOrNull(vitals.temp_f) ||
    !isNumberOrNull(vitals.spo2)
  ) {
    return false;
  }
  if (!Array.isArray(value.medications) || !Array.isArray(value.diagnoses) || !Array.isArray(value.plan)) {
    return false;
  }
  if (!isObject(value.follow_up)) {
    return false;
  }
  if (!isNumberOrNull(value.follow_up.interval_days) || !isStringOrNull(value.follow_up.reason)) {
    return false;
  }

  for (const med of value.medications) {
    if (!isObject(med)) {
      return false;
    }
    if (
      typeof med.name !== "string" ||
      !isStringOrNull(med.dose) ||
      !isStringOrNull(med.frequency) ||
      !isStringOrNull(med.route)
    ) {
      return false;
    }
  }

  for (const dx of value.diagnoses) {
    if (!isObject(dx)) {
      return false;
    }
    if (typeof dx.description !== "string") {
      return false;
    }
    if (!(typeof dx.icd10 === "string" || dx.icd10 === undefined || dx.icd10 === null)) {
      return false;
    }
  }

  for (const planItem of value.plan) {
    if (typeof planItem !== "string") {
      return false;
    }
  }

  return true;
}

export async function extract(
  transcript: string,
  strategy: ExtractionStrategy,
  options?: ExtractOptions,
): Promise<RawExtraction> {
  const forceRetry = options?.forceRetry === true;
  const sleepMs = options?.sleepMs ?? ((ms: number) => Bun.sleep(ms));
  const baseBackoffMs = options?.baseBackoffMs ?? 300;

  if (!forceRetry) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error("GOOGLE_API_KEY is missing.");
    }
  }

  const model = forceRetry
    ? null
    : new GoogleGenerativeAI(process.env.GOOGLE_API_KEY as string)
        .getGenerativeModel({
          model: MODEL,
          generationConfig: {
            responseMimeType: "application/json",
          },
        });

  const generateJson = async (prompt: string): Promise<unknown> => {
    if (!model) {
      throw new Error("Gemini client is unavailable.");
    }
    const response = await model.generateContent(prompt);
    const text = response.response.text();
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };

  return extractWithGenerator(transcript, strategy, generateJson, {
    ...options,
    sleepMs,
    baseBackoffMs,
  });
}

function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const status = (error as { status?: unknown }).status;
  return status === 429;
}

export async function extractWithGenerator(
  transcript: string,
  strategy: ExtractionStrategy,
  generateJson: (prompt: string) => Promise<unknown>,
  options?: ExtractOptions,
): Promise<RawExtraction> {
  const forceRetry = options?.forceRetry === true;
  const sleepMs = options?.sleepMs ?? ((ms: number) => Bun.sleep(ms));
  const baseBackoffMs = options?.baseBackoffMs ?? 300;
  let feedback: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    console.log(`[extract] strategy=${strategy} attempt=${attempt} status=start`);

    if (forceRetry) {
      console.log(
        `[extract] strategy=${strategy} attempt=${attempt} status=invalid_output reason=forced_retry_test`,
      );
      feedback = "Your previous output was invalid. Return valid JSON only.";
      continue;
    }

    try {
      const parsed = await generateJson(buildPrompt(transcript, strategy, feedback));

      if (isExtractionValid(parsed)) {
        console.log(`[extract] strategy=${strategy} attempt=${attempt} status=success`);
        return parsed;
      }

      console.log(`[extract] strategy=${strategy} attempt=${attempt} status=invalid_output`);
      feedback = "Your previous output was invalid. Return valid JSON only.";
    } catch (error) {
      if (isRateLimitError(error) && attempt < MAX_ATTEMPTS) {
        const backoffMs = baseBackoffMs * attempt;
        console.log(
          `[extract] strategy=${strategy} attempt=${attempt} status=rate_limited backoff_ms=${backoffMs}`,
        );
        await sleepMs(backoffMs);
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Failed to extract valid JSON after ${MAX_ATTEMPTS} attempts.`);
}
