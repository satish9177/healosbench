import "dotenv/config";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { extract } from "./extractor";

async function run(): Promise<void> {
  const transcriptPath = join(process.cwd(), "..", "..", "data", "transcripts", "case_001.txt");
  const transcript = await readFile(transcriptPath, "utf8");

  const result = await extract(transcript, "zero_shot");
  console.log(result);

  if (typeof result !== "object" || result === null) {
    throw new Error("Shape test failed: typeof result !== object");
  }

  if (!Array.isArray(result.medications)) {
    throw new Error("Shape test failed: medications is not an array");
  }

  if (result.vitals.temp_f === undefined) {
    throw new Error("Shape test failed: vitals.temp_f is undefined");
  }

  console.log("Shape validation test passed.");
}

run().catch((error: unknown) => {
  console.error("Shape validation test failed.");
  console.error(error);
  process.exit(1);
});
