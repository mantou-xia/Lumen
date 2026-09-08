import type { LexicalPartOfSpeech, LexicalProfile } from "@lumen/api-contract";

export const wiktionaryParserVersion = "wiktionary.wikitext.v1";

export interface WiktionarySourceEntry {
  entryId: string;
  lemma: string;
  revisionId: string;
  revisionTimestamp: string;
  sourceUrl: string;
  wikitext: string;
}

const partOfSpeechHeadings = new Set([
  "Adjective",
  "Adverb",
  "Conjunction",
  "Determiner",
  "Interjection",
  "Noun",
  "Numeral",
  "Preposition",
  "Pronoun",
  "Proper noun",
  "Verb",
]);

function extractEnglishSection(wikitext: string): string | null {
  const match = /^==English==\s*$/m.exec(wikitext);
  if (match === null) return null;
  const start = match.index + match[0].length;
  const remaining = wikitext.slice(start);
  const nextLanguage = /^==[^=\n]+==\s*$/m.exec(remaining);
  return nextLanguage === null ? remaining : remaining.slice(0, nextLanguage.index);
}

function cleanTemplate(template: string): string {
  const fields = template.slice(2, -2).split("|");
  const name = fields[0]?.trim().toLowerCase();
  const values = fields.slice(1).map((field) => field.trim()).filter(Boolean);
  if (name === "l" || name === "link" || name === "m" || name === "mention") {
    return values.at(-1) ?? "";
  }
  if (name === "gloss" || name === "non-gloss definition" || name === "ngd") {
    return values.join(" ");
  }
  if (name === "plural of" || name === "past of" || name === "present participle of") {
    return `${name} ${values.at(-1) ?? ""}`.trim();
  }
  return "";
}

function cleanWikitext(value: string): string {
  let text = value;
  for (let index = 0; index < 4 && /\{\{[^{}]*\}\}/.test(text); index += 1) {
    text = text.replace(/\{\{[^{}]*\}\}/g, (template) => cleanTemplate(template));
  }
  return text
    .replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, "$1")
    .replace(/\[(?:https?:\/\/\S+)\s+([^\]]+)\]/g, "$1")
    .replace(/'''?/g, "")
    .replace(/<!--.*?-->/gs, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLabels(value: string): string[] {
  const match = /\{\{(?:lb|label|qualifier|q)\|(?:en\|)?([^{}]+)\}\}/i.exec(value);
  if (match?.[1] === undefined) return [];
  return match[1]
    .split("|")
    .map((label) => cleanWikitext(label))
    .filter(Boolean);
}

function extractPronunciations(section: string): LexicalProfile["pronunciations"] {
  const values: LexicalProfile["pronunciations"] = [];
  const seen = new Set<string>();
  for (const match of section.matchAll(/\{\{IPA\|en\|([^{}]+)\}\}/gi)) {
    for (const field of (match[1] ?? "").split("|")) {
      const value = cleanWikitext(field);
      if (value.length === 0 || value.includes("=")) continue;
      if (!seen.has(value)) {
        seen.add(value);
        values.push({ system: "ipa", value });
      }
    }
  }
  return values;
}

function extractListTerms(lines: string[], heading: string): string[] {
  const headingPattern = new RegExp(`^(={3,5})${heading}\\1$`);
  const headingIndex = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (headingIndex < 0) return [];
  const level = /^=+/.exec(lines[headingIndex]?.trim() ?? "")?.[0].length ?? 3;
  const terms: string[] = [];
  for (const line of lines.slice(headingIndex + 1)) {
    const nextLevel = /^=+/.exec(line.trim())?.[0].length;
    if (nextLevel !== undefined && nextLevel <= level) break;
    if (!/^\s*[*#]/.test(line)) continue;
    const cleaned = cleanWikitext(line.replace(/^\s*[*#:;]+\s*/, ""));
    if (cleaned.length > 0 && !terms.includes(cleaned)) terms.push(cleaned);
  }
  return terms;
}

function extractEtymology(lines: string[]): string {
  const headingIndex = lines.findIndex((line) => /^(={3,4})Etymology(?: \d+)?\1$/.test(line.trim()));
  if (headingIndex < 0) return "";
  const level = /^=+/.exec(lines[headingIndex]?.trim() ?? "")?.[0].length ?? 3;
  const content: string[] = [];
  for (const line of lines.slice(headingIndex + 1)) {
    const nextLevel = /^=+/.exec(line.trim())?.[0].length;
    if (nextLevel !== undefined && nextLevel <= level) break;
    if (line.trim().length > 0) content.push(line);
  }
  return cleanWikitext(content.join(" "));
}

function extractPartsOfSpeech(lines: string[]): LexicalPartOfSpeech[] {
  const parts: LexicalPartOfSpeech[] = [];
  let current: LexicalPartOfSpeech | null = null;
  for (const line of lines) {
    const headingMatch = /^(={3,5})([^=]+)\1$/.exec(line.trim());
    if (headingMatch !== null) {
      const heading = headingMatch[2]?.trim() ?? "";
      current = partOfSpeechHeadings.has(heading)
        ? { partOfSpeech: heading, senses: [] }
        : null;
      if (current !== null) parts.push(current);
      continue;
    }
    if (current === null) continue;
    if (/^#(?![#*:])\s+/.test(line)) {
      const rawGloss = line.replace(/^#\s+/, "");
      const gloss = cleanWikitext(rawGloss);
      if (gloss.length > 0) {
        current.senses.push({ gloss, usageLabels: extractLabels(rawGloss), examples: [] });
      }
      continue;
    }
    if (/^#[*:]+\s+/.test(line) && current.senses.length > 0) {
      const example = cleanWikitext(line.replace(/^#[*:]+\s+/, ""));
      const latest = current.senses.at(-1);
      if (latest !== undefined && example.length > 0) latest.examples.push(example);
    }
  }
  return parts.filter((part) => part.senses.length > 0);
}

export function parseWiktionaryEntry(
  entry: WiktionarySourceEntry,
  fetchedAt: string,
): LexicalProfile | null {
  const englishSection = extractEnglishSection(entry.wikitext);
  if (englishSection === null) return null;
  const lines = englishSection.split(/\r?\n/);
  const partsOfSpeech = extractPartsOfSpeech(lines);
  if (partsOfSpeech.length === 0) return null;
  return {
    entryId: entry.entryId,
    lemma: entry.lemma,
    language: "en",
    pronunciations: extractPronunciations(englishSection),
    partsOfSpeech,
    etymology: extractEtymology(lines),
    derivedTerms: extractListTerms(lines, "Derived terms"),
    relatedTerms: extractListTerms(lines, "Related terms"),
    sourceRevisionId: entry.revisionId,
    sourceRevisionTimestamp: entry.revisionTimestamp,
    sourceUrl: entry.sourceUrl,
    fetchedAt,
  };
}
