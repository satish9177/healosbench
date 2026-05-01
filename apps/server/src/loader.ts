import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type RawMedication = {
  name: string;
  dose: string | null;
  frequency: string | null;
  route: string | null;
};

export type RawDiagnosis = {
  description: string;
  icd10?: string;
};

export type RawExtraction = {
  chief_complaint: string;
  vitals: {
    bp: string | null;
    hr: number | null;
    temp_f: number | null;
    spo2: number | null;
  };
  medications: RawMedication[];
  diagnoses: RawDiagnosis[];
  plan: string[];
  follow_up: {
    interval_days: number | null;
    reason: string | null;
  };
};

export type MedicalRecord = {
  chief_complaint: string;
  vitals: {
    bp: string | null;
    hr: number | null;
    temp_f: number | null;
    spo2: number | null;
  };
  medications: string[];
  diagnoses: string[];
  plan: string[];
  follow_up: string;
};

export type DatasetCase = {
  id: string;
  transcript: string;
  goldRaw: RawExtraction;
  gold: MedicalRecord;
};

export function toMedicalRecord(raw: RawExtraction): MedicalRecord {
  return {
    chief_complaint: raw.chief_complaint ?? "",
    vitals: raw.vitals,
    medications: raw.medications.map((med) => med.name),
    diagnoses: raw.diagnoses.map((diagnosis) => diagnosis.description),
    plan: raw.plan,
    follow_up: raw.follow_up.reason ?? "",
  };
}

export async function loadDataset(
  baseDir = join(process.cwd(), "..", "..", "data"),
): Promise<DatasetCase[]> {
  const transcriptsDir = join(baseDir, "transcripts");
  const goldDir = join(baseDir, "gold");

  const transcriptFiles = (await readdir(transcriptsDir))
    .filter((name) => name.endsWith(".txt"))
    .sort();

  const cases = await Promise.all(
    transcriptFiles.map(async (filename) => {
      const id = filename.replace(".txt", "");
      const transcriptPath = join(transcriptsDir, filename);
      const goldPath = join(goldDir, `${id}.json`);

      const [transcript, goldJson] = await Promise.all([
        readFile(transcriptPath, "utf8"),
        readFile(goldPath, "utf8"),
      ]);

      const goldRaw = JSON.parse(goldJson) as RawExtraction;

      return {
        id,
        transcript,
        goldRaw,
        gold: toMedicalRecord(goldRaw),
      } satisfies DatasetCase;
    }),
  );

  return cases;
}
