import { createHash } from "node:crypto";

export type OperatorScriptureReference = {
  book: string;
  chapter: number;
  verseStart: number | null;
  verseEnd: number | null;
};

const referencePattern = /^((?:[1-3]\s+)?[A-Za-z][A-Za-z ]*?)\s+(\d{1,3})(?::(\d{1,3})(?:\s*-\s*(\d{1,3}))?)?$/;

export function parseOperatorScriptureReference(input: string): OperatorScriptureReference | null {
  const normalized = input.trim().replace(/\s+/g, " ");
  if (normalized.length < 3 || normalized.length > 120) return null;
  const match = referencePattern.exec(normalized);
  if (!match) return null;

  const chapter = Number(match[2]);
  const verseStart = match[3] ? Number(match[3]) : null;
  const verseEnd = match[4] ? Number(match[4]) : verseStart;
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > 200) return null;
  if (verseStart !== null && (!Number.isInteger(verseStart) || verseStart < 1 || verseStart > 200)) return null;
  if (verseEnd !== null && (!Number.isInteger(verseEnd) || verseEnd < 1 || verseEnd > 200)) return null;
  if (verseStart !== null && verseEnd !== null && (verseEnd < verseStart || verseEnd - verseStart + 1 > 80)) return null;

  return {
    book: match[1].trim(),
    chapter,
    verseStart,
    verseEnd,
  };
}

export function deterministicScriptureItemId(
  version: string,
  book: string,
  chapter: number,
  verseStart: number | null,
  verseEnd: number | null,
) {
  const key = [version.trim().toUpperCase(), book.trim().toLowerCase(), chapter, verseStart ?? "", verseEnd ?? ""].join("|");
  return `local-scripture-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

export function normalizeOperatorPresentationBody(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/[ \t]+/g, " "))
    .join("\n")
    .trim()
    .slice(0, 12000);
}

export function normalizeOperatorText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

export function asSafeStringRecord(value: unknown, maxEntries = 16): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, maxEntries)) {
    const safeKey = normalizeOperatorText(key, 64);
    const safeValue = normalizeOperatorText(raw, 500);
    if (safeKey && safeValue) result[safeKey] = safeValue;
  }
  return result;
}

export type OperatorPresentationFields = {
  body: string;
  footer: string | null;
  metadata: Record<string, string>;
};

export function extractOperatorPresentationFields(value: unknown): OperatorPresentationFields {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { body: "", footer: null, metadata: {} };
  }

  const content = value as Record<string, unknown>;
  const lines = Array.isArray(content.lines)
    ? content.lines.filter((item): item is string => typeof item === "string").join("\n")
    : "";
  const bodySource = [content.body, content.text, content.content].find((item) => typeof item === "string") as string | undefined;
  const footerSource = [content.footer, content.subtitle, content.author].find((item) => typeof item === "string") as string | undefined;
  const body = normalizeOperatorPresentationBody(bodySource ?? lines);
  const footer = normalizeOperatorText(footerSource, 500) || null;
  const metadata = asSafeStringRecord(content.metadata);
  return { body, footer, metadata };
}
