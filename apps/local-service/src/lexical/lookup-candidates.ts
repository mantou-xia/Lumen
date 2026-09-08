const leadingArticlePattern = /^(?:a|an|the)\s+/i;
const englishWordPattern = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;

const ignoredWords = new Set([
  "a",
  "an",
  "and",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

export function normalizeLexicalLookup(value: string): string {
  return value
    .normalize("NFKC")
    .replaceAll("’", "'")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

function inflectionCandidates(word: string): string[] {
  const candidates: string[] = [];
  if (word.endsWith("ies") && word.length > 4) candidates.push(`${word.slice(0, -3)}y`);
  if (word.endsWith("ied") && word.length > 4) candidates.push(`${word.slice(0, -3)}y`);
  if (word.endsWith("ing") && word.length > 5) {
    candidates.push(word.slice(0, -3));
    candidates.push(`${word.slice(0, -3)}e`);
  }
  if (word.endsWith("ed") && word.length > 4) {
    candidates.push(word.slice(0, -2));
    candidates.push(`${word.slice(0, -1)}`);
  }
  if (word.endsWith("es") && word.length > 4) candidates.push(word.slice(0, -2));
  if (word.endsWith("s") && word.length > 3) candidates.push(word.slice(0, -1));
  return candidates;
}

export function buildLexicalLookupCandidates(value: string): string[] {
  const normalized = normalizeLexicalLookup(value);
  const candidates: string[] = [];
  const add = (candidate: string): void => {
    const next = normalizeLexicalLookup(candidate);
    if (next.length > 0 && !candidates.includes(next)) candidates.push(next);
  };

  add(normalized);
  add(normalized.replace(leadingArticlePattern, ""));

  const words = normalized.match(englishWordPattern) ?? [];
  for (const word of words) {
    if (ignoredWords.has(word)) continue;
    add(word);
    for (const candidate of inflectionCandidates(word)) add(candidate);
  }
  return candidates;
}
