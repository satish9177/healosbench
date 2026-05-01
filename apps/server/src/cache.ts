import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtractionStrategy } from "./extractor";
import type { RawExtraction } from "./loader";

const CACHE_DIR = join(process.cwd(), "..", "..", "cache", "extractor");

export type CachedEvaluation = {
  overallScore: number;
  finalScore: number;
  hallucinationPenalty: number;
};

export type CachedSuccess = {
  status: "success";
  prediction: RawExtraction;
  evaluation?: CachedEvaluation;
};

export type CachedFailure = {
  status: "error";
  message: string;
};

export type CachedResult = CachedSuccess | CachedFailure;

export function getCacheKey(
  transcript: string,
  strategy: ExtractionStrategy,
): string {
  const hash = createHash("sha256");
  hash.update(strategy);
  hash.update("\n");
  hash.update(transcript);
  return hash.digest("hex");
}

function getCachePath(key: string): string {
  return join(CACHE_DIR, `${key}.json`);
}

export async function getCachedResult(key: string): Promise<CachedResult | null> {
  const path = getCachePath(key);
  try {
    const file = await readFile(path, "utf8");
    return JSON.parse(file) as CachedResult;
  } catch {
    return null;
  }
}

export async function setCachedResult(
  key: string,
  value: CachedResult,
): Promise<void> {
  const finalPath = getCachePath(key);
  const tempPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
    await rename(tempPath, finalPath);
  } catch (error) {
    console.error("[cache] failed to write cache file", { key, error });
  }
}
