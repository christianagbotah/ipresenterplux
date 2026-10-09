export const PORTABLE_IMPORT_KINDS = [
  "song_text",
  "song_csv",
  "service_rundown_json",
  "media_url_manifest"
] as const;

export type PortableImportKind = typeof PORTABLE_IMPORT_KINDS[number];
export type PortableImportCandidateStatus = "valid" | "warning" | "error" | "duplicate";

export type PortableSongSection = {
  label: string;
  lines: string[];
};

export type PortableImportCandidate = {
  index: number;
  status: PortableImportCandidateStatus;
  targetType: string;
  title: string;
  candidateFingerprint: string;
  sections?: PortableSongSection[];
  input: Record<string, unknown>;
  warnings: string[];
  errors: string[];
};

export type PortableImportSummary = {
  total: number;
  valid: number;
  warnings: number;
  errors: number;
  duplicates: number;
};

export type PortableImportPreview = {
  kind: PortableImportKind;
  sourceName: string;
  sourceFingerprint: string;
  candidates: PortableImportCandidate[];
  summary: PortableImportSummary;
};

export type PortableImportInput = {
  kind: PortableImportKind;
  filename: string;
  content: string;
};

export class PortableImportError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PortableImportError";
    this.code = code;
  }
}
