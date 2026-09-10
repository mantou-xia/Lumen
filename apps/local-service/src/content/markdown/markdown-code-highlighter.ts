import { createHighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";

async function createMarkdownCodeHighlighter() {
  const [
    githubLight,
    rosePineDawn,
    githubDark,
    javascript,
    typescript,
    jsx,
    tsx,
    html,
    css,
    json,
    markdown,
    python,
    java,
    c,
    cpp,
    csharp,
    go,
    rust,
    sql,
    bash,
    powershell,
    yaml,
  ] = await Promise.all([
    import("@shikijs/themes/github-light"),
    import("@shikijs/themes/rose-pine-dawn"),
    import("@shikijs/themes/github-dark"),
    import("@shikijs/langs/javascript"),
    import("@shikijs/langs/typescript"),
    import("@shikijs/langs/jsx"),
    import("@shikijs/langs/tsx"),
    import("@shikijs/langs/html"),
    import("@shikijs/langs/css"),
    import("@shikijs/langs/json"),
    import("@shikijs/langs/markdown"),
    import("@shikijs/langs/python"),
    import("@shikijs/langs/java"),
    import("@shikijs/langs/c"),
    import("@shikijs/langs/cpp"),
    import("@shikijs/langs/csharp"),
    import("@shikijs/langs/go"),
    import("@shikijs/langs/rust"),
    import("@shikijs/langs/sql"),
    import("@shikijs/langs/bash"),
    import("@shikijs/langs/powershell"),
    import("@shikijs/langs/yaml"),
  ]);

  return createHighlighterCore({
    themes: [githubLight.default, rosePineDawn.default, githubDark.default],
    langs: [
      ...javascript.default,
      ...typescript.default,
      ...jsx.default,
      ...tsx.default,
      ...html.default,
      ...css.default,
      ...json.default,
      ...markdown.default,
      ...python.default,
      ...java.default,
      ...c.default,
      ...cpp.default,
      ...csharp.default,
      ...go.default,
      ...rust.default,
      ...sql.default,
      ...bash.default,
      ...powershell.default,
      ...yaml.default,
    ],
    engine: createOnigurumaEngine(import("shiki/wasm")),
  });
}

let markdownCodeHighlighter: ReturnType<typeof createMarkdownCodeHighlighter> | undefined;

export function getMarkdownCodeHighlighter() {
  markdownCodeHighlighter ??= createMarkdownCodeHighlighter();
  return markdownCodeHighlighter;
}

export const markdownCodeHighlightOptions = {
  themes: {
    light: "github-light",
    sepia: "rose-pine-dawn",
    dark: "github-dark",
  },
  defaultColor: false,
  fallbackLanguage: "text",
  addLanguageClass: true,
} as const;
