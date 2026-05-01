import { extract, type ExtractionStrategy } from "./extractor";
import { evaluate } from "./evaluator";
import {
  type CachedEvaluation,
  type CachedSuccess,
  getCacheKey,
  getCachedResult,
  setCachedResult,
} from "./cache";
import { loadDataset, toMedicalRecord } from "./loader";

type CaseResult = {
  caseId: string;
  strategy: ExtractionStrategy;
  overallScore: number;
  finalScore: number;
  hallucinationPenalty: number;
};

const STRATEGIES: ExtractionStrategy[] = ["zero_shot", "few_shot", "cot"];
const MAX_CONCURRENCY = 3;

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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

function summarizeByStrategy(results: CaseResult[]): Array<{
  strategy: ExtractionStrategy;
  avgOverallScore: number;
  avgFinalScore: number;
  avgHallucinationPenalty: number;
  cases: number;
}> {
  const strategiesInResults = [...new Set(results.map((r) => r.strategy))] as ExtractionStrategy[];
  return strategiesInResults.map((strategy) => {
    const slice = results.filter((result) => result.strategy === strategy);
    return {
      strategy,
      avgOverallScore: average(slice.map((x) => x.overallScore)),
      avgFinalScore: average(slice.map((x) => x.finalScore)),
      avgHallucinationPenalty: average(slice.map((x) => x.hallucinationPenalty)),
      cases: slice.length,
    };
  });
}

function toCaseResult(
  caseId: string,
  strategy: ExtractionStrategy,
  evaluation: CachedEvaluation,
): CaseResult {
  return {
    caseId,
    strategy,
    overallScore: evaluation.overallScore,
    finalScore: evaluation.finalScore,
    hallucinationPenalty: Math.max(0, evaluation.hallucinationPenalty),
  };
}

async function run(): Promise<void> {
  const debug = process.argv.includes("--debug");
  const strategyArg = process.argv.find((arg) => arg.startsWith("--strategy="));
  const casesArg = process.argv.find((arg) => arg.startsWith("--cases="));
  const singleStrategy = strategyArg
    ? (strategyArg.split("=")[1] as ExtractionStrategy)
    : undefined;
  const selectedStrategies = singleStrategy
    ? STRATEGIES.filter((s) => s === singleStrategy)
    : STRATEGIES;
  const caseLimit = casesArg ? Number(casesArg.split("=")[1]) : undefined;

  if (singleStrategy && selectedStrategies.length === 0) {
    console.error(`[runner] invalid strategy: ${singleStrategy}`);
    return;
  }

  let dataset: Awaited<ReturnType<typeof loadDataset>>;
  try {
    dataset = await loadDataset();
  } catch (error) {
    console.error("[runner] failed to load dataset", error);
    return;
  }

  if (dataset.length === 0) {
    console.log("[runner] no cases found.");
    return;
  }

  const selectedDataset =
    Number.isFinite(caseLimit) && (caseLimit as number) > 0
      ? dataset.slice(0, caseLimit)
      : dataset;

  const tasks: Array<() => Promise<CaseResult | null>> = [];

  for (const item of selectedDataset) {
    for (const strategy of selectedStrategies) {
      tasks.push(async () => {
        const key = getCacheKey(item.transcript, strategy);
        try {
          const cached = await getCachedResult(key);
          if (cached?.status === "error") {
            console.log(
              `[runner] skipping cached failure case=${item.id} strategy=${strategy}`,
            );
            return null;
          }

          if (cached?.status === "success" && cached.evaluation) {
            const cachedCaseResult = toCaseResult(item.id, strategy, cached.evaluation);
            if (debug) {
              console.log({ ...cachedCaseResult, source: "cache:evaluation" });
            }
            return cachedCaseResult;
          }

          let successCache: CachedSuccess;
          if (cached?.status === "success") {
            successCache = cached;
          } else {
            const predictionRaw = await extract(item.transcript, strategy);
            successCache = { status: "success", prediction: predictionRaw };
          }

          const prediction = toMedicalRecord(successCache.prediction);
          const evaluation = evaluate(prediction, item.gold, item.transcript);
          const hallucinationPenalty = Math.max(
            0,
            evaluation.overallScore - evaluation.finalScore,
          );
          const evaluationSummary: CachedEvaluation = {
            overallScore: evaluation.overallScore,
            finalScore: evaluation.finalScore,
            hallucinationPenalty,
          };
          const caseResult: CaseResult = {
            caseId: item.id,
            strategy,
            overallScore: evaluation.overallScore,
            finalScore: evaluation.finalScore,
            hallucinationPenalty,
          };

          await setCachedResult(key, {
            status: "success",
            prediction: successCache.prediction,
            evaluation: evaluationSummary,
          });

          if (debug) {
            console.log(caseResult);
          }

          return caseResult;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await setCachedResult(key, {
            status: "error",
            message,
          });
          console.error(
            `[runner] failed case=${item.id} strategy=${strategy}`,
            error,
          );
          return null;
        }
      });
    }
  }

  const maybeResults = await runWithConcurrency(tasks, MAX_CONCURRENCY);
  const results = maybeResults.filter((result): result is CaseResult => result !== null);

  const summary = summarizeByStrategy(results);
  console.table(summary);
}

run().catch((error: unknown) => {
  console.error("Evaluation runner failed.");
  console.error(error);
  process.exit(1);
});
