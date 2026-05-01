export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeArray(values: string[]): string[] {
  return values
    .map((value) => normalizeText(value))
    .filter((value) => value.length > 0);
}

function tokenize(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }
  return normalized.split(" ");
}

function tokenSetFuzzy(a: string, b: string): number {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));

  if (aTokens.size === 0 && bTokens.size === 0) {
    return 1;
  }

  if (aTokens.size === 0 || bTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      overlap += 1;
    }
  }

  const precision = overlap / aTokens.size;
  const recall = overlap / bTokens.size;

  if (precision + recall === 0) {
    return 0;
  }

  return (2 * precision * recall) / (precision + recall);
}

export function fuzzyScore(a: string, b: string): number {
  return tokenSetFuzzy(a, b);
}

export function numericToleranceScore(
  predicted: number | null,
  gold: number | null,
  tolerance = 0.2,
): number {
  if (predicted === null && gold === null) {
    return 1;
  }
  if (predicted === null || gold === null) {
    return 0;
  }
  return Math.abs(predicted - gold) <= tolerance ? 1 : 0;
}

export function exactStringScore(
  predicted: string | null,
  gold: string | null,
): number {
  if (predicted === null && gold === null) {
    return 1;
  }
  if (predicted === null || gold === null) {
    return 0;
  }
  return normalizeText(predicted) === normalizeText(gold) ? 1 : 0;
}

export function f1Score(predicted: string[], gold: string[]): number {
  const predictedSet = new Set(normalizeArray(predicted));
  const goldSet = new Set(normalizeArray(gold));

  if (predictedSet.size === 0 && goldSet.size === 0) {
    return 1;
  }
  if (predictedSet.size === 0 || goldSet.size === 0) {
    return 0;
  }

  let matches = 0;
  for (const item of predictedSet) {
    if (goldSet.has(item)) {
      matches += 1;
    }
  }

  const precision = matches / predictedSet.size;
  const recall = matches / goldSet.size;

  if (precision + recall === 0) {
    return 0;
  }

  return (2 * precision * recall) / (precision + recall);
}

export type Vitals = {
  bp: string | null;
  hr: number | null;
  temp_f: number | null;
  spo2: number | null;
};

export function vitalsScore(predicted: Vitals, gold: Vitals): number {
  const bp = exactStringScore(predicted.bp, gold.bp);
  const hr = numericToleranceScore(predicted.hr, gold.hr, 0.2);
  const temp = numericToleranceScore(predicted.temp_f, gold.temp_f, 0.2);
  const spo2 = numericToleranceScore(predicted.spo2, gold.spo2, 0.2);

  return (bp + hr + temp + spo2) / 4;
}
