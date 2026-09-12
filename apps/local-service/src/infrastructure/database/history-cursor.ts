export type HistoryCursor = { createdAt: string; id: string };

export function encodeHistoryCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeHistoryCursor(cursor: string | undefined): HistoryCursor | null {
  if (cursor === undefined) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<HistoryCursor>;
    if (typeof value.createdAt !== "string" || typeof value.id !== "string") throw new Error();
    return { createdAt: value.createdAt, id: value.id };
  } catch {
    throw new Error("历史记录游标无效");
  }
}
