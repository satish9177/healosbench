import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getCacheKey,
  getCachedResult,
  setCachedResult,
  type CachedEvaluation,
} from "./cache";
import { evaluate } from "./evaluator";
import type { ExtractionStrategy } from "./extractor";
import {
  loadDataset,
  toMedicalRecord,
  type RawExtraction,
} from "./loader";

type VerificationCaseResult = {
  caseId: string;
  strategy: ExtractionStrategy;
  overallScore: number;
  finalScore: number;
  hallucinationPenalty: number;
};

type StrategySummary = {
  strategy: ExtractionStrategy;
  avgOverallScore: number;
  avgFinalScore: number;
  avgHallucinationPenalty: number;
  count: number;
};

const STRATEGIES: ExtractionStrategy[] = ["zero_shot", "few_shot", "cot"];
const MAX_CONCURRENCY = 3;

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function hashInt(input: string): number {
  const hex = createHash("sha256").update(input).digest("hex");
  return Number.parseInt(hex.slice(0, 8), 16);
}

function maybeDropOne<T>(arr: T[], seed: number, threshold: number): T[] {
  if (arr.length === 0) {
    return arr;
  }
  if (seed % 100 >= threshold) {
    return arr;
  }
  const idx = seed % arr.length;
  return arr.filter((_, i) => i !== idx);
}

function mockExtract(
  caseId: string,
  strategy: ExtractionStrategy,
  transcript: string,
  goldRaw: RawExtraction,
): RawExtraction {
  const seed = hashInt(`${caseId}::${strategy}::${transcript.length}`);
  const strictness =
    strategy === "cot" ? 8 : strategy === "few_shot" ? 18 : 30;

  const medications = maybeDropOne(
    [...goldRaw.medications],
    seed + 11,
    strictness,
  );
  const diagnoses = maybeDropOne([...goldRaw.diagnoses], seed + 17, strictness);
  const plan = maybeDropOne([...goldRaw.plan], seed + 23, strictness);

  const addFakeMedication = (seed + 29) % 100 < Math.max(2, strictness - 10);
  if (addFakeMedication) {
    medications.push({
      name: "fake_drug",
      dose: "10 mg",
      frequency: "daily",
      route: "PO",
    });
  }

  const chiefComplaint =
    (seed + 31) % 100 < strictness
      ? `${goldRaw.chief_complaint} ongoing`
      : goldRaw.chief_complaint;

  return {
    chief_complaint: chiefComplaint,
    vitals: { ...goldRaw.vitals },
    medications,
    diagnoses,
    plan,
    follow_up: { ...goldRaw.follow_up },
  };
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const current = nextIndex;
      nextIndex += 1;
      const task = tasks[current];
      if (!task) {
        continue;
      }
      results[current] = await task();
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, tasks.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function verifyDatasetIntegrity(dataRoot: string): Promise<{
  ok: boolean;
  missingTranscripts: string[];
  missingGold: string[];
  mismatchedIds: string[];
}> {
  const transcriptsDir = join(dataRoot, "transcripts");
  const goldDir = join(dataRoot, "gold");

  const transcriptFiles = (await readdir(transcriptsDir))
    .filter((name) => name.endsWith(".txt"))
    .sort();
  const goldFiles = (await readdir(goldDir))
    .filter((name) => name.endsWith(".json"))
    .sort();

  const transcriptIds = new Set(transcriptFiles.map((f) => f.replace(".txt", "")));
  const goldIds = new Set(goldFiles.map((f) => f.replace(".json", "")));

  const missingTranscripts: string[] = [];
  const missingGold: string[] = [];
  const mismatchedIds: string[] = [];

  for (const id of goldIds) {
    if (!transcriptIds.has(id)) {
      missingTranscripts.push(id);
    }
  }
  for (const id of transcriptIds) {
    if (!goldIds.has(id)) {
      missingGold.push(id);
    }
  }
  for (const id of transcriptIds) {
    if (!goldIds.has(id)) {
      mismatchedIds.push(id);
    }
  }
  for (const id of goldIds) {
    if (!transcriptIds.has(id)) {
      mismatchedIds.push(id);
    }
  }

  const ok =
    transcriptIds.size === 50 &&
    goldIds.size === 50 &&
    missingTranscripts.length === 0 &&
    missingGold.length === 0 &&
    mismatchedIds.length === 0;

  return { ok, missingTranscripts, missingGold, mismatchedIds };
}

function summarizeByStrategy(results: VerificationCaseResult[]): StrategySummary[] {
  return STRATEGIES.map((strategy) => {
    const slice = results.filter((x) => x.strategy === strategy);
    return {
      strategy,
      avgOverallScore: average(slice.map((x) => x.overallScore)),
      avgFinalScore: average(slice.map((x) => x.finalScore)),
      avgHallucinationPenalty: average(slice.map((x) => x.hallucinationPenalty)),
      count: slice.length,
    };
  });
}

function validateCaseResult(result: VerificationCaseResult): string[] {
  const issues: string[] = [];
  if (!result.caseId) {
    issues.push("missing caseId");
  }
  if (!STRATEGIES.includes(result.strategy)) {
    issues.push("invalid strategy");
  }
  if (!Number.isFinite(result.overallScore)) {
    issues.push("overallScore is not finite");
  }
  if (!Number.isFinite(result.finalScore)) {
    issues.push("finalScore is not finite");
  }
  if (!Number.isFinite(result.hallucinationPenalty)) {
    issues.push("hallucinationPenalty is not finite");
  }
  return issues;
}

async function run(): Promise<void> {
  const dataRoot = join(process.cwd(), "..", "..", "data");
  const reportPath = join(process.cwd(), "verification_report.json");
  const warnings: string[] = [];
  const errors: string[] = [];

  let cacheHits = 0;
  let cacheWrites = 0;
  let duplicateWriteAttempts = 0;
  const writeKeys = new Set<string>();

  const datasetStatus = await verifyDatasetIntegrity(dataRoot);
  if (!datasetStatus.ok) {
    console.error("Dataset status: FAIL");
    console.error(datasetStatus);
    const report = {
      datasetStatus: "FAIL",
      pipelineStatus: "FAIL",
      cacheStatus: "FAIL",
      strategySummaries: [],
      perCaseResults: [],
      warnings,
      errors: [
        "Dataset mismatch found. Execution stopped.",
        ...datasetStatus.missingTranscripts.map((id) => `missing transcript for ${id}`),
        ...datasetStatus.missingGold.map((id) => `missing gold for ${id}`),
      ],
    };
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
    process.exit(1);
  }

  const dataset = await loadDataset(dataRoot);
  const tasks: Array<() => Promise<VerificationCaseResult | null>> = [];

  for (const item of dataset) {
    for (const strategy of STRATEGIES) {
      tasks.push(async () => {
        const key = getCacheKey(item.transcript, strategy);
        try {
          const cached = await getCachedResult(key);
          if (cached) {
            cacheHits += 1;
            if (cached.status === "success" && cached.evaluation) {
              return {
                caseId: item.id,
                strategy,
                overallScore: cached.evaluation.overallScore,
                finalScore: cached.evaluation.finalScore,
                hallucinationPenalty: Math.max(
                  0,
                  cached.evaluation.hallucinationPenalty,
                ),
              };
            }
          }

          const predictionRaw = mockExtract(
            item.id,
            strategy,
            item.transcript,
            item.goldRaw,
          );
          const prediction = toMedicalRecord(predictionRaw);
          const evaluation = evaluate(prediction, item.gold, item.transcript);
          const evaluationSummary: CachedEvaluation = {
            overallScore: evaluation.overallScore,
            finalScore: evaluation.finalScore,
            hallucinationPenalty: Math.max(
              0,
              evaluation.overallScore - evaluation.finalScore,
            ),
          };

          if (writeKeys.has(key)) {
            duplicateWriteAttempts += 1;
          } else {
            writeKeys.add(key);
          }

          await setCachedResult(key, {
            status: "success",
            prediction: predictionRaw,
            evaluation: evaluationSummary,
          });
          cacheWrites += 1;

          return {
            caseId: item.id,
            strategy,
            overallScore: evaluationSummary.overallScore,
            finalScore: evaluationSummary.finalScore,
            hallucinationPenalty: evaluationSummary.hallucinationPenalty,
          };
        } catch (error) {
          errors.push(
            `failed case=${item.id} strategy=${strategy}: ${String(error)}`,
          );
          return null;
        }
      });
    }
  }

  const maybeResults = await runWithConcurrency(tasks, MAX_CONCURRENCY);
  const perCaseResults = maybeResults.filter(
    (x): x is VerificationCaseResult => x !== null,
  );

  for (const result of perCaseResults) {
    const issues = validateCaseResult(result);
    for (const issue of issues) {
      errors.push(`invalid result case=${result.caseId} strategy=${result.strategy}: ${issue}`);
    }
  }

  const strategySummaries = summarizeByStrategy(perCaseResults);
  const countsPerStrategy = STRATEGIES.map(
    (strategy) => perCaseResults.filter((x) => x.strategy === strategy).length,
  );

  if (strategySummaries.length !== 3) {
    errors.push("strategy summary missing one or more strategies");
  }
  if (countsPerStrategy.some((count) => count !== 50)) {
    errors.push(`unexpected strategy counts: ${countsPerStrategy.join(", ")}`);
  }
  for (const summary of strategySummaries) {
    if (
      !Number.isFinite(summary.avgOverallScore) ||
      !Number.isFinite(summary.avgFinalScore) ||
      !Number.isFinite(summary.avgHallucinationPenalty)
    ) {
      errors.push(`NaN in strategy summary for ${summary.strategy}`);
    }
  }

  const sorted = [...perCaseResults].sort((a, b) => b.finalScore - a.finalScore);
  const top3 = sorted.slice(0, 3);
  const bottom3 = [...sorted].reverse().slice(0, 3);
  const uniqueScores = new Set(perCaseResults.map((r) => r.finalScore.toFixed(6)));
  if (uniqueScores.size <= 1) {
    warnings.push("All outputs are identical; check evaluator signal.");
  }
  if (duplicateWriteAttempts > 0) {
    warnings.push(`Duplicate cache write attempts: ${duplicateWriteAttempts}`);
  }

  const allProcessed = perCaseResults.length === 150;
  const pipelineOk = allProcessed && errors.length === 0;
  const cacheOk = duplicateWriteAttempts === 0;

  console.log(`Dataset status: ${datasetStatus.ok ? "OK" : "FAIL"}`);
  console.log(`Pipeline status: ${pipelineOk ? "OK" : "FAIL"}`);
  console.log(`Cache status: ${cacheOk ? "OK" : "FAIL"}`);
  console.table(strategySummaries);
  console.log("Top 3 highest scoring cases:", top3);
  console.log("Bottom 3 lowest scoring cases:", bottom3);
  console.log(`Cache hits: ${cacheHits}`);
  console.log(`Cache writes: ${cacheWrites}`);
  if (warnings.length > 0) {
    console.log("Warnings:", warnings);
  }
  if (errors.length > 0) {
    console.log("Errors:", errors);
  }

  const report = {
    datasetStatus: datasetStatus.ok ? "OK" : "FAIL",
    pipelineStatus: pipelineOk ? "OK" : "FAIL",
    cacheStatus: cacheOk ? "OK" : "FAIL",
    cacheHits,
    cacheWrites,
    top3,
    bottom3,
    strategySummaries,
    perCaseResults,
    warnings,
    errors,
  };
  await mkdir(join(process.cwd()), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
}

run().catch((error: unknown) => {
  console.error("Verification run failed.");
  console.error(error);
  process.exit(1);
});
