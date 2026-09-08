import { describe, expect, it } from "vitest";

import { buildLexicalLookupCandidates } from "./lookup-candidates.js";
import { parseWiktionaryEntry } from "./wiktionary-parser.js";

const sourceEntry = {
  entryId: "en.wiktionary:123",
  lemma: "sophisticated",
  revisionId: "456",
  revisionTimestamp: "2026-09-08T00:00:00.000Z",
  sourceUrl: "https://en.wiktionary.org/wiki/sophisticated",
  wikitext: `==English==
===Etymology===
From [[sophisticate]] + {{suffix|en|-ed}}.

===Pronunciation===
* {{IPA|en|/səˈfɪstɪkeɪtɪd/}}

===Adjective===
# {{lb|en|of a person}} Having obtained [[worldly experience]].
# Complicated, especially of [[technology]].
#* This is a sophisticated caching mechanism.

====Derived terms====
* [[sophisticatedly]]

====Related terms====
* [[sophistication]]

==French==
Ignored content.`,
};

describe("Wiktionary 词条解析", () => {
  it("从常见三级标题中保守提取英文事实", () => {
    const profile = parseWiktionaryEntry(sourceEntry, "2026-09-08T01:00:00.000Z");

    expect(profile).toMatchObject({
      lemma: "sophisticated",
      pronunciations: [{ system: "ipa", value: "/səˈfɪstɪkeɪtɪd/" }],
      partsOfSpeech: [{
        partOfSpeech: "Adjective",
        senses: [
          {
            gloss: "Having obtained worldly experience.",
            usageLabels: ["of a person"],
          },
          {
            gloss: "Complicated, especially of technology.",
            examples: ["This is a sophisticated caching mechanism."],
          },
        ],
      }],
      derivedTerms: ["sophisticatedly"],
      relatedTerms: ["sophistication"],
      sourceRevisionId: "456",
    });
    expect(profile?.etymology).toContain("sophisticate");
  });

  it("让三种语境稳定回退到同一 lemma 候选", () => {
    for (const selection of [
      "sophisticated caching mechanism",
      "a sophisticated investor",
      "a sophisticated taste",
    ]) {
      expect(buildLexicalLookupCandidates(selection)).toContain("sophisticated");
    }
  });

  it("没有明确 English 义项时拒绝生成 Profile", () => {
    expect(parseWiktionaryEntry({ ...sourceEntry, wikitext: "==French==\n===Adjective===" }, "2026-09-08T01:00:00.000Z"))
      .toBeNull();
  });
});
