export const THEME_STUDIO_REQUIRED_UAT_CATEGORIES = [
  "scripture_long",
  "lyrics_long",
  "announcement",
  "lower_third",
  "image_background",
  "logo_safe_zone",
  "theme_switch_no_take",
  "invalid_theme_fallback",
  "offline_continuity"
] as const;

export type ThemeStudioUatCategory = typeof THEME_STUDIO_REQUIRED_UAT_CATEGORIES[number];
export type ThemeStudioUatCase = {
  id: string;
  category: ThemeStudioUatCategory;
  status: "pass" | "fail" | "pending";
  readable: boolean | null;
  programMutationObserved: boolean | null;
  notes?: string;
};
export type ThemeStudioUatReport = {
  hardware: { platform?: string; edgeVersion?: string; projector?: string; resolution?: string };
  cases: ThemeStudioUatCase[];
};

export function evaluateThemeStudioFieldUat(report: ThemeStudioUatReport) {
  const rows = Array.isArray(report?.cases) ? report.cases : [];
  const present = new Set(rows.map((row) => row.category));
  const missingCategories = THEME_STUDIO_REQUIRED_UAT_CATEGORIES.filter((category) => !present.has(category));
  const pendingCases = rows.filter((row) => row.status === "pending" || row.readable === null || row.programMutationObserved === null).length;
  const failedCases = rows.filter((row) => row.status === "fail").length;
  const unreadableCases = rows.filter((row) => row.readable === false).length;
  const unsafeProgramMutations = rows.filter((row) => row.programMutationObserved === true).length;
  const blockers: string[] = [];
  if (report?.hardware?.platform !== "windows") blockers.push("windows_projector_uat_required");
  if (!report?.hardware?.edgeVersion?.trim()) blockers.push("edge_version_required");
  if (!report?.hardware?.projector?.trim()) blockers.push("projector_required");
  if (!report?.hardware?.resolution?.trim()) blockers.push("projector_resolution_required");
  if (missingCategories.length) blockers.push("required_categories_missing");
  if (pendingCases) blockers.push("pending_cases");
  if (failedCases) blockers.push("failed_cases");
  if (unreadableCases) blockers.push("unreadable_output");
  if (unsafeProgramMutations) blockers.push("unsafe_program_mutation");
  return {
    releaseReady: blockers.length === 0,
    blockers,
    missingCategories,
    pendingCases,
    failedCases,
    unreadableCases,
    unsafeProgramMutations,
    totalCases: rows.length
  };
}
