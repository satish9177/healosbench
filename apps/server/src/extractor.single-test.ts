import "dotenv/config";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { extract } from "./extractor";

function hasRequiredFields(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    "chief_complaint" in record &&
    "vitals" in record &&
    "medications" in record &&
    "diagnoses" in record &&
    "plan" in record &&
    "follow_up" in record
  );
}

async function run(): Promise<void> {
  const forceRetry = process.argv.includes("--force-retry");

  const transcriptPath = join(process.cwd(), "..", "..", "data", "transcripts", "case_001.txt");
  const transcript = await readFile(transcriptPath, "utf8");

  const result = await extract(transcript, "zero_shot", { forceRetry });
  console.log(result);

  const isObject = typeof result === "object" && result !== null && !Array.isArray(result);
  if (!isObject) {
    throw new Error("Extractor did not return a JSON object.");
  }
  if (!hasRequiredFields(result)) {
    throw new Error("Extractor output is missing required fields.");
  }

  console.log("Single-call extractor test passed.");
}

run().catch((error: unknown) => {
  console.error("Single-call extractor test failed.");
  console.error(error);
  process.exit(1);
});
