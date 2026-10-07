import { z } from "zod";
import {
  PLANNER_BODY_MAX,
  PLANNER_FOOTER_MAX,
  PLANNER_ITEM_TYPES,
  PLANNER_MAX_SONG_SECTIONS,
  type PlannerItemType
} from "./planner-contracts.ts";

export class PlannerItemError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status = 422) {
    super(message);
    this.name = "PlannerItemError";
    this.status = status;
    this.code = code;
  }
}

const cleanOneLine = (value: string) => value.trim().replace(/\s+/g, " ");
const oneLine = (max: number, min = 1) => z.string().min(min).max(max).transform(cleanOneLine);
const optionalOneLine = (max: number) => z.string().max(max).transform(cleanOneLine).optional();
const footer = z.string().max(PLANNER_FOOTER_MAX).transform(cleanOneLine).optional();
const body = z.string().max(PLANNER_BODY_MAX);
const style = z.enum(["default", "scripture", "announcement", "sermon", "lower_third"]).optional();

const scriptureSchema = z.object({
  reference: oneLine(120, 3),
  version: optionalOneLine(32),
  footer
}).strict();

const songSectionSchema = z.object({
  label: oneLine(80),
  text: z.string().min(1).max(4000)
}).strict();

const songSchema = z.object({
  title: oneLine(160),
  author: optionalOneLine(500),
  sections: z.array(songSectionSchema).min(1).max(PLANNER_MAX_SONG_SECTIONS),
  defaultSection: z.number().int().min(0).max(PLANNER_MAX_SONG_SECTIONS - 1).optional()
}).strict().superRefine((value, context) => {
  if (value.defaultSection !== undefined && value.defaultSection >= value.sections.length) {
    context.addIssue({ code: "custom", path: ["defaultSection"], message: "Default section is outside the section list" });
  }
});

const slideSchema = z.object({
  title: oneLine(160),
  body,
  footer,
  style
}).strict();

const announcementSchema = z.object({
  title: oneLine(160),
  body,
  footer,
  dateNote: optionalOneLine(160),
  style: z.enum(["default", "announcement"]).optional()
}).strict();

const lowerThirdSchema = z.object({
  primaryText: oneLine(160),
  secondaryText: z.string().max(PLANNER_FOOTER_MAX).transform(cleanOneLine).optional(),
  durationSeconds: z.number().int().min(1).max(3600).optional()
}).strict();

const mediaSchema = z.object({
  title: oneLine(160),
  sourceId: z.string().uuid(),
  mediaKind: z.enum(["image", "video", "audio"]),
  operatorNotes: z.string().max(1000).transform(cleanOneLine).optional()
}).strict();

const cameraSchema = z.object({
  sourceId: z.string().uuid(),
  label: optionalOneLine(160),
  operatorNote: z.string().max(1000).transform(cleanOneLine).optional()
}).strict();

const customSchema = z.object({
  title: oneLine(160),
  body,
  footer,
  style
}).strict();

const schemas = {
  scripture: scriptureSchema,
  song: songSchema,
  slide: slideSchema,
  media: mediaSchema,
  announcement: announcementSchema,
  lower_third: lowerThirdSchema,
  camera: cameraSchema,
  custom: customSchema
} satisfies Record<PlannerItemType, z.ZodType>;

export type ParsedPlannerItemInput = z.infer<(typeof schemas)[PlannerItemType]>;

function mapZodError(error: z.ZodError) {
  const issue = error.issues[0];
  const root = String(issue?.path?.[0] ?? "");
  if (root === "body" && issue?.code === "too_big") {
    return new PlannerItemError("planner_body_too_long", `Presentation body exceeds ${PLANNER_BODY_MAX} characters`);
  }
  if (root === "footer" && issue?.code === "too_big") {
    return new PlannerItemError("planner_footer_too_long", `Presentation footer exceeds ${PLANNER_FOOTER_MAX} characters`);
  }
  if (root === "sections" && issue?.code === "too_big") {
    return new PlannerItemError("planner_song_sections_exceeded", `Song exceeds ${PLANNER_MAX_SONG_SECTIONS} sections`);
  }
  return new PlannerItemError("planner_item_invalid", issue?.message || "Planner item is invalid");
}

export function parsePlannerItemInput(itemType: string, input: unknown): ParsedPlannerItemInput {
  if (!(PLANNER_ITEM_TYPES as readonly string[]).includes(itemType)) {
    throw new PlannerItemError("planner_item_type_invalid", "Planner item type is not supported");
  }
  try {
    return schemas[itemType as PlannerItemType].parse(input) as ParsedPlannerItemInput;
  } catch (error) {
    if (error instanceof z.ZodError) throw mapZodError(error);
    throw error;
  }
}
