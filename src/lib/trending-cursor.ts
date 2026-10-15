export type TrendingCursor = {
  createdAt: Date;
  id: string;
};

const LISTING_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function encodeTrendingCursor(cursor: TrendingCursor): string {
  const timestamp = cursor.createdAt.getTime();
  if (!Number.isSafeInteger(timestamp) || !LISTING_ID_PATTERN.test(cursor.id)) {
    throw new Error("Cannot encode an invalid Trending cursor.");
  }

  return `${timestamp}|${cursor.id}`;
}

export function parseTrendingCursor(value: string): TrendingCursor | null {
  if (value.length > 96) return null;

  const separator = value.indexOf("|");
  if (separator < 1 || separator === value.length - 1) return null;

  const timestampText = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (!/^\d{1,16}$/.test(timestampText) || !LISTING_ID_PATTERN.test(id)) return null;

  const timestamp = Number(timestampText);
  const createdAt = new Date(timestamp);
  if (!Number.isSafeInteger(timestamp) || createdAt.getTime() !== timestamp) return null;

  return { createdAt, id };
}
