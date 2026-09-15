import { SaxesParser, type SaxesTagPlain } from "saxes";

const allowedTags = new Set([
  "circle", "clipPath", "defs", "desc", "ellipse", "g", "line", "linearGradient",
  "marker", "mask", "path", "pattern", "polygon", "polyline", "radialGradient", "rect",
  "stop", "svg", "symbol", "text", "title", "tspan", "use",
]);

const allowedAttributes = new Set([
  "aria-label", "class", "clip-path", "clip-rule", "color", "cx", "cy", "d",
  "dominant-baseline", "fill", "fill-opacity", "fill-rule", "font-family", "font-size",
  "font-style", "font-weight", "fx", "fy", "gradientTransform", "gradientUnits", "height",
  "href", "id", "marker-end", "marker-mid", "marker-start", "markerHeight", "markerUnits",
  "markerWidth", "mask", "offset", "opacity", "orient", "patternContentUnits", "patternTransform",
  "patternUnits", "points", "preserveAspectRatio", "r", "refX", "refY", "role", "rx", "ry",
  "spreadMethod", "stop-color", "stop-opacity", "stroke", "stroke-dasharray", "stroke-dashoffset",
  "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-opacity", "stroke-width", "style",
  "text-anchor", "transform", "vector-effect", "viewBox", "width", "x", "x1", "x2", "xlink:href",
  "xmlns", "xmlns:xlink", "y", "y1", "y2",
]);

const allowedStyleProperties = new Set([
  "background", "background-color", "clip-path", "clip-rule", "color", "fill", "fill-opacity", "fill-rule", "font-family",
  "font-size", "font-style", "font-weight", "marker-end", "marker-mid", "marker-start", "opacity",
  "stop-color", "stop-opacity", "stroke", "stroke-dasharray", "stroke-dashoffset", "stroke-linecap",
  "stroke-linejoin", "stroke-miterlimit", "stroke-opacity", "stroke-width", "text-anchor",
  "vector-effect",
]);

const urlValueAttributes = new Set([
  "clip-path", "fill", "marker-end", "marker-mid", "marker-start", "mask", "stroke",
]);

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function isSafeValue(name: string, value: string): boolean {
  if (/[^\t\n\r\x20-\u{10ffff}]/u.test(value)) return false;
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("javascript:") || normalized.includes("data:") || normalized.includes("expression(")) {
    return false;
  }
  if (name === "href" || name === "xlink:href") return /^#[A-Za-z_][\w:.-]*$/u.test(value.trim());
  if (urlValueAttributes.has(name) && /url\s*\(/iu.test(value)) {
    return /^url\(\s*#[A-Za-z_][\w:.-]*\s*\)$/u.test(value.trim());
  }
  return !/https?:|file:|\\\\|\/\//iu.test(value);
}

function sanitizeStyle(value: string): string | null {
  const declarations: string[] = [];
  for (const declaration of value.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 1) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const propertyValue = declaration.slice(separator + 1).trim();
    if (!allowedStyleProperties.has(property) || !isSafeValue(property, propertyValue)) continue;
    declarations.push(`${property}:${propertyValue}`);
  }
  return declarations.length === 0 ? null : declarations.join(";");
}

export function sanitizeSvg(content: Uint8Array): Uint8Array | null {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(content).replace(/^\uFEFF/u, "");
  } catch {
    return null;
  }
  if (!/<svg(?:\s|>)/u.test(source) || /<!DOCTYPE|<!ENTITY/iu.test(source)) return null;

  const output: string[] = [];
  const emittedStack: boolean[] = [];
  let rootSeen = false;
  let elementCount = 0;
  let failed = false;
  const parser = new SaxesParser({ xmlns: false });
  parser.on("doctype", () => { throw new Error("SVG 禁止 DOCTYPE"); });
  parser.on("processinginstruction", () => { throw new Error("SVG 禁止处理指令"); });
  parser.on("error", () => { failed = true; });
  parser.on("opentag", (tag: SaxesTagPlain) => {
    elementCount += 1;
    if (elementCount > 100_000 || emittedStack.length >= 128) throw new Error("SVG 结构过大");
    const parentEmitted = emittedStack.every(Boolean);
    const emitted = parentEmitted && allowedTags.has(tag.name);
    emittedStack.push(emitted);
    if (!emitted) return;
    if (!rootSeen) {
      if (tag.name !== "svg") throw new Error("SVG 根元素无效");
      rootSeen = true;
    }
    const attributes: string[] = [];
    for (const [name, rawValue] of Object.entries(tag.attributes)) {
      if (/^on/iu.test(name) || !allowedAttributes.has(name)) continue;
      if (name === "xmlns") {
        if (rawValue === "http://www.w3.org/2000/svg") attributes.push(`xmlns="${rawValue}"`);
        continue;
      }
      if (name === "xmlns:xlink") {
        if (rawValue === "http://www.w3.org/1999/xlink") attributes.push(`xmlns:xlink="${rawValue}"`);
        continue;
      }
      const value = name === "style" ? sanitizeStyle(rawValue) : rawValue;
      if (value === null || !isSafeValue(name, value)) continue;
      attributes.push(`${name}="${escapeXml(value)}"`);
    }
    if (tag.name === "svg" && !attributes.some((attribute) => attribute.startsWith("xmlns="))) {
      attributes.unshift('xmlns="http://www.w3.org/2000/svg"');
    }
    output.push(`<${tag.name}${attributes.length === 0 ? "" : ` ${attributes.join(" ")}`}>`);
  });
  parser.on("text", (text) => {
    if (emittedStack.length > 0 && emittedStack.every(Boolean)) output.push(escapeXml(text));
  });
  parser.on("cdata", (text) => {
    if (emittedStack.length > 0 && emittedStack.every(Boolean)) output.push(escapeXml(text));
  });
  parser.on("closetag", (tag: SaxesTagPlain) => {
    const emitted = emittedStack.pop();
    if (emitted) output.push(`</${tag.name}>`);
  });
  try {
    parser.write(source).close();
  } catch {
    return null;
  }
  if (failed || !rootSeen || emittedStack.length !== 0) return null;
  const sanitized = new TextEncoder().encode(output.join(""));
  return sanitized.byteLength === 0 || sanitized.byteLength > 10 * 1024 * 1024 ? null : sanitized;
}
