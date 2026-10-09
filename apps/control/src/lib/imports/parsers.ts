import { createHash } from "node:crypto";
import {
  PortableImportError,
  type PortableImportCandidate,
  type PortableImportInput,
  type PortableImportKind,
  type PortableImportPreview,
  type PortableSongSection
} from "./contracts.ts";

export const PORTABLE_IMPORT_LIMITS = Object.freeze({
  maxBytes: 2 * 1024 * 1024,
  maxRows: 500
});

const PROPRIETARY_EXTENSIONS = new Set([".pro", ".pro6", ".ewb", ".vmix", ".obs"]);

function normalizedContent(content: string) {
  return content.replace(/\r\n?/g, "\n").trim();
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function extension(filename: string) {
  const match = filename.trim().toLowerCase().match(/(\.[a-z0-9]+)$/u);
  return match?.[1] ?? "";
}

function candidateFingerprint(targetType: string, value: unknown) {
  return sha256(`${targetType}\n${stableJson(value)}`);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function validateInput(input: PortableImportInput) {
  if (PROPRIETARY_EXTENSIONS.has(extension(input.filename))) {
    throw new PortableImportError(
      "portable_import_proprietary_format",
      "This proprietary project format is not imported directly. Use a documented portable export from the source application, then import that file into iPresenterPlux."
    );
  }
  if (Buffer.byteLength(input.content, "utf8") > PORTABLE_IMPORT_LIMITS.maxBytes) {
    throw new PortableImportError(
      "portable_import_too_large",
      `Portable import input exceeds the ${PORTABLE_IMPORT_LIMITS.maxBytes} byte safety limit.`
    );
  }
}

function candidate(
  index: number,
  status: PortableImportCandidate["status"],
  targetType: string,
  title: string,
  input: Record<string, unknown>,
  options: { sections?: PortableSongSection[]; warnings?: string[]; errors?: string[] } = {}
): PortableImportCandidate {
  return {
    index,
    status,
    targetType,
    title,
    candidateFingerprint: candidateFingerprint(targetType, { title, input }),
    sections: options.sections,
    input,
    warnings: options.warnings ?? [],
    errors: options.errors ?? []
  };
}

function summarize(candidates: PortableImportCandidate[]) {
  return {
    total: candidates.length,
    valid: candidates.filter((item) => item.status === "valid").length,
    warnings: candidates.filter((item) => item.status === "warning").length,
    errors: candidates.filter((item) => item.status === "error").length,
    duplicates: candidates.filter((item) => item.status === "duplicate").length
  };
}

function markCandidateDuplicates(candidates: PortableImportCandidate[]) {
  const seen = new Set<string>();
  return candidates.map((item) => {
    if (item.status === "error") return item;
    if (seen.has(item.candidateFingerprint)) {
      return { ...item, status: "duplicate" as const, warnings: [...item.warnings, "Duplicate candidate in this import source."] };
    }
    seen.add(item.candidateFingerprint);
    return item;
  });
}

function parseSongText(content: string) {
  const lines = content.split("\n");
  const titleIndex = lines.findIndex((line) => line.trim().length > 0);
  if (titleIndex < 0) {
    return [candidate(0, "error", "song", "Untitled song", {}, { errors: ["Song title is required."] })];
  }
  const title = lines[titleIndex].trim();
  const sections: PortableSongSection[] = [];
  let current: PortableSongSection | null = null;
  for (const raw of lines.slice(titleIndex + 1)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^\[([^\]]+)\]$/u);
    if (heading) {
      current = { label: heading[1].trim() || `Section ${sections.length + 1}`, lines: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = { label: "Verse 1", lines: [] };
      sections.push(current);
    }
    current.lines.push(line);
  }
  if (!sections.length || sections.every((section) => section.lines.length === 0)) {
    return [candidate(0, "error", "song", title, { title, sections }, { sections, errors: ["Song lyrics are required."] })];
  }
  const input = { title, sections };
  return [candidate(0, "valid", "song", title, input, { sections })];
}

function csvRows(content: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (quoted) {
      if (char === '"' && content[index + 1] === '"') {
        field += '"'; index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (quoted) throw new PortableImportError("portable_import_malformed", "CSV contains an unterminated quoted field.");
  row.push(field);
  if (row.some((item) => item.length > 0) || rows.length === 0) rows.push(row);
  return rows;
}

function parseSongCsv(content: string) {
  const rows = csvRows(content);
  if (!rows.length) throw new PortableImportError("portable_import_malformed", "CSV is empty.");
  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const titleColumn = headers.indexOf("title");
  const sectionColumn = headers.indexOf("section");
  const textColumn = headers.indexOf("text");
  if ([titleColumn, sectionColumn, textColumn].some((index) => index < 0)) {
    throw new PortableImportError("portable_import_malformed", "Song CSV requires title, section and text columns.");
  }
  const dataRows = rows.slice(1).filter((row) => row.some((value) => value.trim().length > 0));
  if (dataRows.length > PORTABLE_IMPORT_LIMITS.maxRows) {
    throw new PortableImportError("portable_import_row_limit", `CSV exceeds the ${PORTABLE_IMPORT_LIMITS.maxRows} row safety limit.`);
  }

  const songs = new Map<string, { title: string; sections: Map<string, string[]> }>();
  const candidates: PortableImportCandidate[] = [];
  const seenRows = new Set<string>();
  for (const [rowIndex, row] of dataRows.entries()) {
    const title = (row[titleColumn] ?? "").trim();
    const section = (row[sectionColumn] ?? "").trim();
    const text = (row[textColumn] ?? "").trim();
    if (!title || !section || !text) {
      candidates.push(candidate(rowIndex, "error", "song", title || `Row ${rowIndex + 2}`, { title, section, text }, { errors: ["Each CSV row requires title, section and text."] }));
      continue;
    }
    const rowKey = stableJson([title.toLowerCase(), section.toLowerCase(), text]);
    if (seenRows.has(rowKey)) {
      candidates.push(candidate(rowIndex, "duplicate", "song", title, { title, section, text }, { warnings: ["Duplicate song row in this import source."] }));
      continue;
    }
    seenRows.add(rowKey);
    const key = title.toLowerCase();
    const song = songs.get(key) ?? { title, sections: new Map<string, string[]>() };
    const lines = song.sections.get(section) ?? [];
    lines.push(text);
    song.sections.set(section, lines);
    songs.set(key, song);
  }
  for (const song of songs.values()) {
    const sections = [...song.sections.entries()].map(([label, lines]) => ({ label, lines }));
    candidates.unshift(candidate(candidates.length, "valid", "song", song.title, { title: song.title, sections }, { sections }));
  }
  return candidates.map((item, index) => ({ ...item, index }));
}

function parseJsonObject(content: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(content); }
  catch { throw new PortableImportError("portable_import_malformed", "Portable JSON could not be parsed."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PortableImportError("portable_import_malformed", "Portable JSON must contain an object at the top level.");
  }
  return parsed as Record<string, unknown>;
}

function requireRowLimit(items: unknown[]) {
  if (items.length > PORTABLE_IMPORT_LIMITS.maxRows) {
    throw new PortableImportError("portable_import_row_limit", `Import exceeds the ${PORTABLE_IMPORT_LIMITS.maxRows} row safety limit.`);
  }
}

function parseServiceRundown(content: string) {
  const parsed = parseJsonObject(content);
  if (!Array.isArray(parsed.items)) throw new PortableImportError("portable_import_malformed", "Service rundown JSON requires an items array.");
  requireRowLimit(parsed.items);
  const candidates = parsed.items.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return candidate(index, "error", "unknown", `Item ${index + 1}`, {}, { errors: ["Rundown item must be an object."] });
    }
    const item = raw as Record<string, unknown>;
    const targetType = typeof item.type === "string" ? item.type.trim() : "";
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const input = item.input && typeof item.input === "object" && !Array.isArray(item.input) ? item.input as Record<string, unknown> : null;
    if (!targetType || !title || !input) {
      return candidate(index, "error", targetType || "unknown", title || `Item ${index + 1}`, {}, { errors: ["Rundown item requires type, title and object input."] });
    }
    return candidate(index, "valid", targetType, title, input);
  });
  return markCandidateDuplicates(candidates);
}

function parseMediaManifest(content: string) {
  const parsed = parseJsonObject(content);
  if (!Array.isArray(parsed.items)) throw new PortableImportError("portable_import_malformed", "Media manifest JSON requires an items array.");
  requireRowLimit(parsed.items);
  const candidates = parsed.items.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return candidate(index, "error", "media", `Item ${index + 1}`, {}, { errors: ["Media item must be an object."] });
    }
    const item = raw as Record<string, unknown>;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const mediaType = typeof item.mediaType === "string" ? item.mediaType.trim() : "";
    const urlValue = typeof item.url === "string" ? item.url.trim() : "";
    let url: URL | null = null;
    try { url = new URL(urlValue); } catch { url = null; }
    if (!title || !mediaType || !url || url.protocol !== "https:") {
      return candidate(index, "error", "media", title || `Item ${index + 1}`, { title, mediaType, url: urlValue }, { errors: ["Media items require title, mediaType and an HTTPS URL."] });
    }
    return candidate(index, "valid", "media", title, { title, mediaType, url: url.toString() });
  });
  return markCandidateDuplicates(candidates);
}

export function parsePortableImport(input: PortableImportInput): PortableImportPreview {
  validateInput(input);
  const content = normalizedContent(input.content);
  if (!content) throw new PortableImportError("portable_import_malformed", "Portable import input is empty.");
  const sourceFingerprint = sha256(`${input.kind}\n${content}`);

  let candidates: PortableImportCandidate[];
  if (input.kind === "song_text") candidates = parseSongText(content);
  else if (input.kind === "song_csv") candidates = parseSongCsv(content);
  else if (input.kind === "service_rundown_json") candidates = parseServiceRundown(content);
  else if (input.kind === "media_url_manifest") candidates = parseMediaManifest(content);
  else throw new PortableImportError("portable_import_kind_unsupported", "Portable import kind is not supported.");

  candidates = markCandidateDuplicates(candidates);
  return {
    kind: input.kind as PortableImportKind,
    sourceName: input.filename.trim(),
    sourceFingerprint,
    candidates,
    summary: summarize(candidates)
  };
}
