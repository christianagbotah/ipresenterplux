export const AUTO_SCRIPTURE_LIVE_FIELD_UAT_MIN_EXPLICIT_REFERENCES = 50;
export const AUTO_SCRIPTURE_LIVE_FIELD_UAT_P95_TARGET_MS = 1500;
export const AUTO_SCRIPTURE_LIVE_FIELD_UAT_REQUIRED_CATEGORIES = [
  "repeated_reference",
  "competing_references",
  "low_asr_confidence",
  "edge_disconnect",
  "service_end",
  "emergency_disarm",
  "quote_mode"
] as const;

type ProgramExpectation = "live" | "not_live";
type ProgramObservation = ProgramExpectation | "pending";

type FieldUatCase = {
  id: string;
  category: string;
  reference?: string | null;
  expectedProgram: ProgramExpectation;
  actualProgram: ProgramObservation;
  recognitionFinalizedAt?: string | null;
  programCommandQueuedAt?: string | null;
};

type FieldUatReport = {
  hardware?: {
    platform?: string | null;
    edgeVersion?: string | null;
    microphone?: string | null;
  } | null;
  cases?: FieldUatCase[] | null;
};

function percentile(values: number[], percentileValue: number) {
  if (!values.length) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(percentileValue * sorted.length));
  return sorted[Math.min(sorted.length - 1, rank - 1)];
}

function latencyMs(item: FieldUatCase) {
  if (!item.recognitionFinalizedAt || !item.programCommandQueuedAt) return null;
  const finalized = new Date(item.recognitionFinalizedAt).getTime();
  const queued = new Date(item.programCommandQueuedAt).getTime();
  if (!Number.isFinite(finalized) || !Number.isFinite(queued) || queued < finalized) return null;
  return queued - finalized;
}

export function evaluateAutoScriptureLiveFieldUat(report: FieldUatReport) {
  const cases = Array.isArray(report?.cases) ? report.cases : [];
  const blockers: string[] = [];
  const explicitReferenceCases = cases.filter((item) => item.category === "explicit_reference").length;
  if (explicitReferenceCases < AUTO_SCRIPTURE_LIVE_FIELD_UAT_MIN_EXPLICIT_REFERENCES) {
    blockers.push("explicit_reference_cases_below_50");
  }

  const observedCategories = new Set(cases.map((item) => item.category));
  const missingCategories = AUTO_SCRIPTURE_LIVE_FIELD_UAT_REQUIRED_CATEGORIES.filter((category) => !observedCategories.has(category));
  if (missingCategories.length) blockers.push("required_safety_categories_missing");

  const pendingCases = cases.filter((item) => item.actualProgram === "pending").length;
  if (pendingCases > 0) blockers.push("pending_cases");

  const falseTakes = cases.filter((item) => item.expectedProgram !== "live" && item.actualProgram === "live").length;
  const nonLiveExpected = cases.filter((item) => item.expectedProgram !== "live").length;
  const eligible = cases.filter((item) => item.expectedProgram === "live");
  const missedEligible = eligible.filter((item) => item.actualProgram !== "live").length;
  const successfulEligible = eligible.filter((item) => item.actualProgram === "live");
  const eligibleLatencies = successfulEligible.map(latencyMs).filter((value): value is number => value !== null);
  const missingEligibleLatency = successfulEligible.length - eligibleLatencies.length;
  const medianMs = percentile(eligibleLatencies, 0.5);
  const p95Ms = percentile(eligibleLatencies, 0.95);

  if (falseTakes > 0) blockers.push("unsafe_program_bypass");
  if (missingEligibleLatency > 0 || p95Ms === null) blockers.push("eligible_latency_missing");
  if (p95Ms !== null && p95Ms > AUTO_SCRIPTURE_LIVE_FIELD_UAT_P95_TARGET_MS) {
    blockers.push("p95_latency_above_1500ms");
  }

  const hardwareReady = Boolean(
    report?.hardware?.platform?.trim()
      && report?.hardware?.edgeVersion?.trim()
      && report?.hardware?.microphone?.trim()
  );
  if (!hardwareReady) blockers.push("field_hardware_metadata_missing");

  return {
    releaseReady: blockers.length === 0,
    blockers,
    totalCases: cases.length,
    pendingCases,
    explicitReferenceCases,
    missingCategories,
    unsafeProgramBypasses: falseTakes,
    falseTakeRate: nonLiveExpected ? falseTakes / nonLiveExpected : 0,
    missedEligibleRate: eligible.length ? missedEligible / eligible.length : 0,
    latency: {
      samples: eligibleLatencies.length,
      medianMs,
      p95Ms,
      targetP95Ms: AUTO_SCRIPTURE_LIVE_FIELD_UAT_P95_TARGET_MS
    }
  };
}

export function createAutoScriptureLiveFieldUatTemplate() {
  const explicit = Array.from({ length: AUTO_SCRIPTURE_LIVE_FIELD_UAT_MIN_EXPLICIT_REFERENCES }, (_, index) => ({
    id: `explicit-${String(index + 1).padStart(2, "0")}`,
    category: "explicit_reference",
    reference: "",
    expectedProgram: "live" as const,
    actualProgram: "pending" as const,
    recognitionFinalizedAt: null,
    programCommandQueuedAt: null,
    notes: ""
  }));
  const safetyExpectations: Record<(typeof AUTO_SCRIPTURE_LIVE_FIELD_UAT_REQUIRED_CATEGORIES)[number], ProgramExpectation> = {
    repeated_reference: "not_live",
    competing_references: "not_live",
    low_asr_confidence: "not_live",
    edge_disconnect: "not_live",
    service_end: "not_live",
    emergency_disarm: "not_live",
    quote_mode: "live"
  };
  const safety = AUTO_SCRIPTURE_LIVE_FIELD_UAT_REQUIRED_CATEGORIES.map((category) => ({
    id: category,
    category,
    reference: "",
    expectedProgram: safetyExpectations[category],
    actualProgram: "pending" as const,
    recognitionFinalizedAt: null,
    programCommandQueuedAt: null,
    notes: ""
  }));
  return {
    hardware: { platform: "windows", edgeVersion: "", microphone: "" },
    cases: [...explicit, ...safety]
  };
}
