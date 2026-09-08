import { z } from "zod";

export const lexicalSenseSchema = z.object({
  gloss: z.string().min(1),
  usageLabels: z.array(z.string().min(1)),
  examples: z.array(z.string().min(1)),
});

export const lexicalPartOfSpeechSchema = z.object({
  partOfSpeech: z.string().min(1),
  senses: z.array(lexicalSenseSchema).min(1),
});

export const lexicalProfileSchema = z.object({
  entryId: z.string().min(1),
  lemma: z.string().min(1),
  language: z.literal("en"),
  pronunciations: z.array(z.object({
    system: z.enum(["ipa", "other"]),
    value: z.string().min(1),
  })),
  partsOfSpeech: z.array(lexicalPartOfSpeechSchema).min(1),
  etymology: z.string(),
  derivedTerms: z.array(z.string().min(1)),
  relatedTerms: z.array(z.string().min(1)),
  sourceRevisionId: z.string().min(1),
  sourceRevisionTimestamp: z.string().datetime(),
  sourceUrl: z.string().url(),
  fetchedAt: z.string().datetime(),
});

export const localizedLexicalSenseSchema = z.object({
  sourceGloss: z.string().min(1),
  chineseGloss: z.string().min(1),
  usageNote: z.string(),
});

export const lexicalLocalizationSchema = z.object({
  operationId: z.string().min(1),
  entryId: z.string().min(1),
  sourceRevisionId: z.string().min(1),
  senses: z.array(localizedLexicalSenseSchema).min(1),
  etymologySummary: z.string(),
  localizedAt: z.string().datetime(),
});

export const lexicalAttributionSchema = z.object({
  sourceName: z.literal("English Wiktionary"),
  sourceUrl: z.string().url(),
  licenseName: z.literal("CC BY-SA 4.0 / GFDL"),
  licenseUrl: z.string().url(),
  attributionText: z.string().min(1),
});

export const lexicalProfileResponseSchema = z.object({
  lookupText: z.string().min(1),
  matchedLemma: z.string().min(1).nullable(),
  status: z.enum(["ready", "not_found", "source_unavailable"]),
  profile: lexicalProfileSchema.nullable(),
  localizationStatus: z.enum(["ready", "unavailable", "not_applicable"]),
  localization: lexicalLocalizationSchema.nullable(),
  message: z.string().min(1).nullable(),
  attribution: lexicalAttributionSchema,
});

export type LexicalSense = z.infer<typeof lexicalSenseSchema>;
export type LexicalPartOfSpeech = z.infer<typeof lexicalPartOfSpeechSchema>;
export type LexicalProfile = z.infer<typeof lexicalProfileSchema>;
export type LexicalLocalization = z.infer<typeof lexicalLocalizationSchema>;
export type LexicalAttribution = z.infer<typeof lexicalAttributionSchema>;
export type LexicalProfileResponse = z.infer<typeof lexicalProfileResponseSchema>;
