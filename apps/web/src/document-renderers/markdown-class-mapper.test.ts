import { describe, it, expect, beforeEach } from "vitest";
import {
  applyMarkdownClasses,
  removeMarkdownClasses,
  toggleMarkdownFeature,
} from "./markdown-class-mapper";

describe("Markdown Class Mapper", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  describe("applyMarkdownClasses", () => {
    it("should add base content class to container", () => {
      applyMarkdownClasses(container);
      expect(container.classList.contains("md-content")).toBe(true);
    });

    it("should apply heading classes with proper levels", () => {
      container.innerHTML = `
        <h1>Heading 1</h1>
        <h2>Heading 2</h2>
        <h3>Heading 3</h3>
      `;
      applyMarkdownClasses(container);

      const h1 = container.querySelector("h1");
      expect(h1?.classList.contains("md-heading")).toBe(true);
      expect(h1?.classList.contains("md-heading-1")).toBe(true);

      const h2 = container.querySelector("h2");
      expect(h2?.classList.contains("md-heading")).toBe(true);
      expect(h2?.classList.contains("md-heading-2")).toBe(true);
    });

    it("should apply paragraph classes", () => {
      container.innerHTML = `<p>This is a long paragraph with more than 20 characters.</p>`;
      applyMarkdownClasses(container);

      const p = container.querySelector("p");
      expect(p?.classList.contains("md-paragraph")).toBe(true);
      expect(p?.classList.contains("md-paragraph--indented")).toBe(true);
    });

    it("should not indent first paragraph after heading", () => {
      container.innerHTML = `
        <h2>Title</h2>
        <p>First paragraph after heading, long enough to test.</p>
      `;
      applyMarkdownClasses(container);

      const p = container.querySelector("p");
      expect(p?.classList.contains("md-paragraph")).toBe(true);
      expect(p?.classList.contains("md-paragraph--indented")).toBe(false);
    });

    it("should not indent short paragraphs", () => {
      container.innerHTML = `<p>Short text</p>`;
      applyMarkdownClasses(container);

      const p = container.querySelector("p");
      expect(p?.classList.contains("md-paragraph")).toBe(true);
      expect(p?.classList.contains("md-paragraph--indented")).toBe(false);
    });

    it("should apply text formatting classes", () => {
      container.innerHTML = `
        <p>
          <strong>Bold text</strong>
          <em>Italic text</em>
          <del>Strikethrough</del>
          <mark>Marked</mark>
        </p>
      `;
      applyMarkdownClasses(container);

      expect(container.querySelector("strong")?.classList.contains("md-strong")).toBe(true);
      expect(container.querySelector("em")?.classList.contains("md-emphasis")).toBe(true);
      expect(container.querySelector("del")?.classList.contains("md-strikethrough")).toBe(true);
      expect(container.querySelector("mark")?.classList.contains("md-mark")).toBe(true);
    });

    it("should apply link classes", () => {
      container.innerHTML = `<a href="#">Link text</a>`;
      applyMarkdownClasses(container);

      const link = container.querySelector("a");
      expect(link?.classList.contains("md-link")).toBe(true);
    });

    it("should handle unordered lists", () => {
      container.innerHTML = `
        <ul>
          <li>Item 1</li>
          <li>Item 2</li>
        </ul>
      `;
      applyMarkdownClasses(container);

      const ul = container.querySelector("ul");
      expect(ul?.classList.contains("md-list")).toBe(true);
      expect(ul?.classList.contains("md-list--unordered")).toBe(true);

      const items = container.querySelectorAll("li");
      items.forEach((item) => {
        expect(item.classList.contains("md-list-item")).toBe(true);
      });
    });

    it("should handle ordered lists", () => {
      container.innerHTML = `
        <ol>
          <li>First</li>
          <li>Second</li>
        </ol>
      `;
      applyMarkdownClasses(container);

      const ol = container.querySelector("ol");
      expect(ol?.classList.contains("md-list")).toBe(true);
      expect(ol?.classList.contains("md-list--ordered")).toBe(true);
    });

    it("should handle task lists", () => {
      container.innerHTML = `
        <ul>
          <li><input type="checkbox" checked> Completed task</li>
          <li><input type="checkbox"> Pending task</li>
        </ul>
      `;
      applyMarkdownClasses(container);

      const ul = container.querySelector("ul");
      expect(ul?.classList.contains("md-task-list")).toBe(true);

      const items = container.querySelectorAll("li");
      items.forEach((item) => {
        expect(item.classList.contains("md-task-item")).toBe(true);
      });

      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach((checkbox) => {
        expect(checkbox.classList.contains("md-task-checkbox")).toBe(true);
      });
    });

    it("should handle nested lists", () => {
      container.innerHTML = `
        <ul>
          <li>
            Item 1
            <ul>
              <li>Nested item</li>
            </ul>
          </li>
        </ul>
      `;
      applyMarkdownClasses(container);

      const nestedList = container.querySelector("ul ul");
      expect(nestedList?.classList.contains("md-list--nested")).toBe(true);
    });

    it("should apply inline code classes", () => {
      container.innerHTML = `<p>Some <code>inline code</code> here</p>`;
      applyMarkdownClasses(container);

      const code = container.querySelector("code");
      expect(code?.classList.contains("md-code-inline")).toBe(true);
    });

    it("should apply code block classes", () => {
      container.innerHTML = `<pre><code>const x = 1;</code></pre>`;
      applyMarkdownClasses(container);

      const pre = container.querySelector("pre");
      expect(pre?.classList.contains("md-code-block")).toBe(true);

      // Inline code inside pre should not have inline class
      const code = container.querySelector("code");
      expect(code?.classList.contains("md-code-inline")).toBe(false);
    });

    it("should apply blockquote classes", () => {
      container.innerHTML = `<blockquote><p>Quote text</p></blockquote>`;
      applyMarkdownClasses(container);

      const blockquote = container.querySelector("blockquote");
      expect(blockquote?.classList.contains("md-blockquote")).toBe(true);
    });

    it("should apply horizontal rule classes", () => {
      container.innerHTML = `<hr>`;
      applyMarkdownClasses(container);

      const hr = container.querySelector("hr");
      expect(hr?.classList.contains("md-hr")).toBe(true);
    });

    it("should apply table classes", () => {
      container.innerHTML = `
        <table>
          <thead>
            <tr>
              <th>Header 1</th>
              <th>Header 2</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Cell 1</td>
              <td>Cell 2</td>
            </tr>
          </tbody>
        </table>
      `;
      applyMarkdownClasses(container);

      const table = container.querySelector("table");
      expect(table?.classList.contains("md-table")).toBe(true);

      const thead = container.querySelector("thead");
      expect(thead?.classList.contains("md-table-header")).toBe(true);

      const tbody = container.querySelector("tbody");
      expect(tbody?.classList.contains("md-table-body")).toBe(true);

      const th = container.querySelector("th");
      expect(th?.classList.contains("md-table-header-cell")).toBe(true);

      const td = container.querySelector("td");
      expect(td?.classList.contains("md-table-cell")).toBe(true);
    });

    it("should wrap tables in container", () => {
      container.innerHTML = `<table><tr><td>Cell</td></tr></table>`;
      applyMarkdownClasses(container);

      const wrapper = container.querySelector(".md-table-container");
      expect(wrapper).not.toBeNull();
      expect(wrapper?.querySelector("table")).not.toBeNull();
    });

    it("should apply image classes", () => {
      container.innerHTML = `<img src="test.jpg" alt="Test">`;
      applyMarkdownClasses(container);

      const img = container.querySelector("img");
      expect(img?.classList.contains("md-image")).toBe(true);
    });

    it("should handle custom prefix", () => {
      container.innerHTML = `<h1>Title</h1>`;
      applyMarkdownClasses(container, { classPrefix: "custom" });

      expect(container.classList.contains("custom-content")).toBe(true);
      const h1 = container.querySelector("h1");
      expect(h1?.classList.contains("custom-heading")).toBe(true);
      expect(h1?.classList.contains("custom-heading-1")).toBe(true);
    });

    it("should respect enableParagraphIndent option", () => {
      container.innerHTML = `<p>Long enough paragraph to be indented by default.</p>`;
      applyMarkdownClasses(container, { enableParagraphIndent: false });

      const p = container.querySelector("p");
      expect(p?.classList.contains("md-paragraph--indented")).toBe(false);
    });
  });

  describe("removeMarkdownClasses", () => {
    it("should remove all markdown classes", () => {
      container.innerHTML = `<h1>Title</h1><p>Text</p>`;
      applyMarkdownClasses(container);

      expect(container.classList.contains("md-content")).toBe(true);

      removeMarkdownClasses(container);

      expect(container.classList.contains("md-content")).toBe(false);
      expect(container.querySelector("h1")?.className).toBe("");
      expect(container.querySelector("p")?.className).toBe("");
    });

    it("should preserve non-markdown classes", () => {
      container.innerHTML = `<h1 class="custom-class">Title</h1>`;
      applyMarkdownClasses(container);

      const h1 = container.querySelector("h1");
      expect(h1?.classList.contains("custom-class")).toBe(true);
      expect(h1?.classList.contains("md-heading")).toBe(true);

      removeMarkdownClasses(container);

      expect(h1?.classList.contains("custom-class")).toBe(true);
      expect(h1?.classList.contains("md-heading")).toBe(false);
    });
  });

  describe("toggleMarkdownFeature", () => {
    it("should toggle paragraph indent", () => {
      container.innerHTML = `<p>Long enough paragraph to be indented by default.</p>`;
      applyMarkdownClasses(container);

      const p = container.querySelector("p");
      expect(p?.classList.contains("md-paragraph--indented")).toBe(true);

      toggleMarkdownFeature(container, "paragraph-indent", false);
      expect(p?.classList.contains("md-paragraph--indented")).toBe(false);

      toggleMarkdownFeature(container, "paragraph-indent", true);
      expect(p?.classList.contains("md-paragraph--indented")).toBe(true);
    });

    it("should toggle code highlighting", () => {
      container.innerHTML = `<pre><code>const x = 1;</code></pre>`;
      applyMarkdownClasses(container);

      const pre = container.querySelector("pre");
      expect(pre?.classList.contains("shiki")).toBe(false);

      toggleMarkdownFeature(container, "code-highlighting", true);
      expect(pre?.classList.contains("shiki")).toBe(true);

      toggleMarkdownFeature(container, "code-highlighting", false);
      expect(pre?.classList.contains("shiki")).toBe(false);
    });
  });
});
