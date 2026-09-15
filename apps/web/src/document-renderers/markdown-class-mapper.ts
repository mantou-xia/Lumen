/**
 * Markdown Class Mapper
 * Maps HTML elements to Typora-style modular CSS classes
 * Each Markdown syntax element gets its own semantic class
 */

export interface ClassMapperOptions {
  /** Enable paragraph indentation (Chinese typography style) */
  enableParagraphIndent?: boolean;
  /** Prefix for all markdown classes */
  classPrefix?: string;
}

/**
 * Apply modular CSS classes to rendered Markdown HTML
 * Transforms generic HTML into semantically-classed elements
 */
export function applyMarkdownClasses(
  container: HTMLElement,
  options: ClassMapperOptions = {},
): void {
  const {
    enableParagraphIndent = true,
    classPrefix = "md",
  } = options;

  // Add base content class
  container.classList.add(`${classPrefix}-content`);

  // Process headings
  container.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6").forEach((heading) => {
    const level = heading.tagName.toLowerCase();
    heading.classList.add(`${classPrefix}-heading`, `${classPrefix}-heading-${level.slice(1)}`);
  });

  // Process paragraphs
  container.querySelectorAll<HTMLParagraphElement>("p").forEach((p) => {
    // Skip paragraphs inside blockquotes, list items, or tables
    if (p.closest("blockquote, li, td, th")) {
      p.classList.add(`${classPrefix}-paragraph`, `${classPrefix}-paragraph--no-margin`);
      return;
    }

    p.classList.add(`${classPrefix}-paragraph`);
    if (enableParagraphIndent && shouldIndentParagraph(p)) {
      p.classList.add(`${classPrefix}-paragraph--indented`);
    }
  });

  // Process text formatting
  container.querySelectorAll<HTMLElement>("strong, b").forEach((el) => {
    el.classList.add(`${classPrefix}-strong`);
  });

  container.querySelectorAll<HTMLElement>("em, i").forEach((el) => {
    el.classList.add(`${classPrefix}-emphasis`);
  });

  container.querySelectorAll<HTMLElement>("del, s, strike").forEach((el) => {
    el.classList.add(`${classPrefix}-strikethrough`);
  });

  container.querySelectorAll<HTMLElement>("mark").forEach((el) => {
    // Skip if it's a highlight marker (has renderer-text-highlight class)
    if (!el.classList.contains("renderer-text-highlight")) {
      el.classList.add(`${classPrefix}-mark`);
    }
  });

  // Process links
  container.querySelectorAll<HTMLAnchorElement>("a").forEach((link) => {
    // Skip if it's a footnote or special link
    if (!link.classList.contains("footnote-ref") && !link.closest(".footnotes")) {
      link.classList.add(`${classPrefix}-link`);
    }
  });

  // Process lists
  container.querySelectorAll<HTMLUListElement>("ul").forEach((list) => {
    // Check if it's a task list
    const hasCheckbox = list.querySelector('input[type="checkbox"]') !== null;
    if (hasCheckbox) {
      list.classList.add(`${classPrefix}-list`, `${classPrefix}-task-list`);
      list.querySelectorAll<HTMLLIElement>("li").forEach((item) => {
        item.classList.add(`${classPrefix}-task-item`);
        item.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((checkbox) => {
          checkbox.classList.add(`${classPrefix}-task-checkbox`);
        });
      });
    } else {
      list.classList.add(`${classPrefix}-list`, `${classPrefix}-list--unordered`);
      if (list.closest("li")) {
        list.classList.add(`${classPrefix}-list--nested`);
      }
    }
  });

  container.querySelectorAll<HTMLOListElement>("ol").forEach((list) => {
    list.classList.add(`${classPrefix}-list`, `${classPrefix}-list--ordered`);
    if (list.closest("li")) {
      list.classList.add(`${classPrefix}-list--nested`);
    }
  });

  container.querySelectorAll<HTMLLIElement>("li").forEach((item) => {
    if (!item.classList.contains(`${classPrefix}-task-item`)) {
      item.classList.add(`${classPrefix}-list-item`);
    }
  });

  // Process code
  container.querySelectorAll<HTMLElement>("code").forEach((code) => {
    // Skip if inside pre (code block)
    if (code.parentElement?.tagName === "PRE") {
      return;
    }
    code.classList.add(`${classPrefix}-code-inline`);
  });

  container.querySelectorAll<HTMLPreElement>("pre").forEach((pre) => {
    pre.classList.add(`${classPrefix}-code-block`);
    // Preserve existing shiki classes if present
  });

  // Process blockquotes
  container.querySelectorAll<HTMLElement>("blockquote").forEach((blockquote) => {
    blockquote.classList.add(`${classPrefix}-blockquote`);
  });

  // Process horizontal rules
  container.querySelectorAll<HTMLHRElement>("hr").forEach((hr) => {
    hr.classList.add(`${classPrefix}-hr`);
  });

  // Process tables
  container.querySelectorAll<HTMLTableElement>("table").forEach((table) => {
    // Wrap table if not already wrapped
    if (!table.parentElement?.classList.contains("reader-table-scroll")) {
      const wrapper = document.createElement("div");
      wrapper.className = "reader-table-scroll";
      table.parentNode?.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    }

    // Find the wrapper (either existing or just created)
    const wrapper = table.closest(".reader-table-scroll");
    if (wrapper) {
      wrapper.classList.add(`${classPrefix}-table-container`);
    }

    table.classList.add(`${classPrefix}-table`);

    table.querySelectorAll<HTMLTableSectionElement>("thead").forEach((thead) => {
      thead.classList.add(`${classPrefix}-table-header`);
    });

    table.querySelectorAll<HTMLTableSectionElement>("tbody").forEach((tbody) => {
      tbody.classList.add(`${classPrefix}-table-body`);
    });

    table.querySelectorAll<HTMLTableRowElement>("tr").forEach((row) => {
      row.classList.add(`${classPrefix}-table-row`);
    });

    table.querySelectorAll<HTMLTableCellElement>("th").forEach((cell) => {
      cell.classList.add(`${classPrefix}-table-header-cell`);
    });

    table.querySelectorAll<HTMLTableCellElement>("td").forEach((cell) => {
      cell.classList.add(`${classPrefix}-table-cell`);
    });
  });

  // Process images
  container.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    img.classList.add(`${classPrefix}-image`);

    // Handle figure/caption structure
    const figure = img.closest("figure");
    if (figure) {
      const caption = figure.querySelector("figcaption");
      if (caption) {
        caption.classList.add(`${classPrefix}-image-caption`);
      }
    }
  });

  // Process special elements
  container.querySelectorAll<HTMLElement>("kbd").forEach((kbd) => {
    kbd.classList.add(`${classPrefix}-kbd`);
  });

  container.querySelectorAll<HTMLElement>("abbr").forEach((abbr) => {
    abbr.classList.add(`${classPrefix}-abbr`);
  });

  container.querySelectorAll<HTMLElement>("sub").forEach((sub) => {
    sub.classList.add(`${classPrefix}-subscript`);
  });

  container.querySelectorAll<HTMLElement>("sup").forEach((sup) => {
    // Skip if it's a footnote reference
    if (!sup.closest(".footnote-ref")) {
      sup.classList.add(`${classPrefix}-superscript`);
    }
  });

  // Process footnotes if present
  const footnotes = container.querySelector<HTMLElement>(".footnotes");
  if (footnotes) {
    footnotes.classList.add(`${classPrefix}-footnotes`);
    footnotes.querySelectorAll<HTMLLIElement>("li").forEach((item) => {
      item.classList.add(`${classPrefix}-footnote-item`);
    });
  }

  container.querySelectorAll<HTMLAnchorElement>(".footnote-ref").forEach((ref) => {
    ref.classList.add(`${classPrefix}-footnote-ref`);
  });

  // Process definition lists
  container.querySelectorAll<HTMLDListElement>("dl").forEach((dl) => {
    dl.classList.add(`${classPrefix}-definition-list`);
  });

  container.querySelectorAll<HTMLElement>("dt").forEach((dt) => {
    dt.classList.add(`${classPrefix}-definition-term`);
  });

  container.querySelectorAll<HTMLElement>("dd").forEach((dd) => {
    dd.classList.add(`${classPrefix}-definition-description`);
  });
}

/**
 * Determine if a paragraph should be indented
 * Chinese typography typically indents paragraphs except:
 * - First paragraph after a heading
 * - Paragraphs inside lists or blockquotes
 * - Single-line paragraphs (likely captions or labels)
 */
function shouldIndentParagraph(p: HTMLParagraphElement): boolean {
  // Don't indent if inside blockquote, list, or table
  if (p.closest("blockquote, li, td, th")) {
    return false;
  }

  // Don't indent if it's the first paragraph after a heading
  const prevElement = p.previousElementSibling;
  if (prevElement?.matches("h1, h2, h3, h4, h5, h6")) {
    return false;
  }

  // Don't indent very short paragraphs (likely captions)
  const text = p.textContent?.trim() || "";
  if (text.length < 20) {
    return false;
  }

  return true;
}

/**
 * Remove all markdown classes from a container
 * Useful for re-applying classes with different options
 */
export function removeMarkdownClasses(
  container: HTMLElement,
  classPrefix = "md",
): void {
  const classPattern = new RegExp(`\\b${classPrefix}-[\\w-]+\\b`, "g");

  container.querySelectorAll("*").forEach((element) => {
    const classes = element.className;
    if (typeof classes === "string") {
      element.className = classes.replace(classPattern, "").trim();
    }
  });

  // Remove from container itself
  if (typeof container.className === "string") {
    container.className = container.className.replace(classPattern, "").trim();
  }
}

/**
 * Toggle a specific markdown class feature
 */
export function toggleMarkdownFeature(
  container: HTMLElement,
  feature: "paragraph-indent" | "link-underline" | "code-highlighting",
  enabled: boolean,
  classPrefix = "md",
): void {
  switch (feature) {
    case "paragraph-indent":
      container.querySelectorAll<HTMLParagraphElement>(`.${classPrefix}-paragraph`).forEach((p) => {
        if (enabled && shouldIndentParagraph(p)) {
          p.classList.add(`${classPrefix}-paragraph--indented`);
        } else {
          p.classList.remove(`${classPrefix}-paragraph--indented`);
        }
      });
      break;

    case "link-underline":
      container.style.setProperty(
        "--md-link-decoration",
        enabled ? "underline" : "none",
      );
      break;

    case "code-highlighting":
      container.querySelectorAll<HTMLPreElement>(`.${classPrefix}-code-block`).forEach((pre) => {
        if (enabled) {
          pre.classList.add("shiki");
        } else {
          pre.classList.remove("shiki");
        }
      });
      break;
  }
}
