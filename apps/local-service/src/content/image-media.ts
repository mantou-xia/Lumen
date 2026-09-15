import { sanitizeSvg } from "./svg-sanitizer.js";

const signatures = {
  gif: new TextEncoder().encode("GIF8"),
  png: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: Uint8Array.from([0xff, 0xd8, 0xff]),
  webp: new TextEncoder().encode("WEBP"),
  avif: new TextEncoder().encode("ftypavif"),
} as const;

function startsWith(content: Uint8Array, signature: Uint8Array, offset = 0): boolean {
  return signature.every((value, index) => content[offset + index] === value);
}

export function detectImageMediaType(content: Uint8Array): string | null {
  if (startsWith(content, signatures.png)) return "image/png";
  if (startsWith(content, signatures.jpeg)) return "image/jpeg";
  if (startsWith(content, signatures.gif)) return "image/gif";
  if (
    startsWith(content, new TextEncoder().encode("RIFF"))
    && startsWith(content, signatures.webp, 8)
  ) return "image/webp";
  if (startsWith(content, signatures.avif, 4)) return "image/avif";
  return null;
}

export function prepareImageContent(
  content: Uint8Array,
): { content: Uint8Array; mediaType: string } | null {
  const rasterMediaType = detectImageMediaType(content);
  if (rasterMediaType !== null) return { content, mediaType: rasterMediaType };
  const sanitizedSvg = sanitizeSvg(content);
  return sanitizedSvg === null ? null : { content: sanitizedSvg, mediaType: "image/svg+xml" };
}

export function imageExtension(mediaType: string): string {
  if (mediaType === "image/png") return ".png";
  if (mediaType === "image/jpeg") return ".jpg";
  if (mediaType === "image/gif") return ".gif";
  if (mediaType === "image/webp") return ".webp";
  if (mediaType === "image/avif") return ".avif";
  if (mediaType === "image/svg+xml") return ".svg";
  throw new Error("不支持的图片媒体类型");
}
