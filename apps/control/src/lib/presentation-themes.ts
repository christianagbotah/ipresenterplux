import type { PoolClient } from "pg";
import { z } from "zod";

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i, "Expected a six-digit hex color");
const backgroundValue = z.string().trim().min(1).max(500);
const fontFamily = z.enum(["Inter", "Arial", "Verdana", "Trebuchet MS", "Georgia", "Times New Roman", "Noto Sans", "Noto Serif"]);

export const presentationAppearanceSchema = z.object({
  version: z.literal(1),
  background: z.object({
    kind: z.enum(["solid", "gradient", "image"]),
    value: backgroundValue
  }).strict(),
  primaryTextColor: hexColor,
  secondaryTextColor: hexColor,
  fontFamily,
  titleSizeScale: z.number().min(0.5).max(2.5),
  bodySizeScale: z.number().min(0.5).max(2.25),
  footerSizeScale: z.number().min(0.5).max(1.75),
  horizontalAlignment: z.enum(["left", "center", "right"]),
  verticalAlignment: z.enum(["top", "center", "bottom"]),
  shadow: z.boolean(),
  backingOpacity: z.number().min(0).max(1),
  safeAreaPercent: z.number().min(0).max(15),
  animation: z.enum(["instant", "fade", "slide", "zoom"]),
  lowerThird: z.object({
    mode: z.enum(["off", "auto", "always"]),
    position: z.enum(["bottom_left", "bottom_center", "bottom_right"])
  }).strict(),
  logo: z.object({
    mediaId: z.string().uuid().nullable(),
    position: z.enum(["top_left", "top_right", "bottom_left", "bottom_right"]),
    sizePercent: z.number().min(1).max(30)
  }).strict()
}).strict();

export type PresentationAppearance = z.infer<typeof presentationAppearanceSchema>;

export const DEFAULT_PRESENTATION_APPEARANCE: PresentationAppearance = {
  version: 1,
  background: { kind: "gradient", value: "linear-gradient(135deg,#090d14,#121b2a)" },
  primaryTextColor: "#ffffff",
  secondaryTextColor: "#e5b95e",
  fontFamily: "Inter",
  titleSizeScale: 1,
  bodySizeScale: 1,
  footerSizeScale: 1,
  horizontalAlignment: "center",
  verticalAlignment: "center",
  shadow: true,
  backingOpacity: 0.18,
  safeAreaPercent: 6,
  animation: "fade",
  lowerThird: { mode: "auto", position: "bottom_left" },
  logo: { mediaId: null, position: "top_right", sizePercent: 8 }
};

function themeAppearance(overrides: Partial<PresentationAppearance>): PresentationAppearance {
  return presentationAppearanceSchema.parse({
    ...DEFAULT_PRESENTATION_APPEARANCE,
    ...overrides,
    background: overrides.background ?? DEFAULT_PRESENTATION_APPEARANCE.background,
    lowerThird: overrides.lowerThird ?? DEFAULT_PRESENTATION_APPEARANCE.lowerThird,
    logo: overrides.logo ?? DEFAULT_PRESENTATION_APPEARANCE.logo
  });
}

export const BUILTIN_PRESENTATION_THEMES: ReadonlyArray<{ name: string; templateKey: string; appearance: PresentationAppearance }> = [
  { name: "Sunday Modern", templateKey: "sunday_modern", appearance: themeAppearance({}) },
  { name: "Lower Third Scripture", templateKey: "lower_third_scripture", appearance: themeAppearance({ verticalAlignment: "bottom", bodySizeScale: 0.9, backingOpacity: 0.62, lowerThird: { mode: "always", position: "bottom_left" } }) },
  { name: "Sermon Scripture", templateKey: "sermon_scripture", appearance: themeAppearance({ bodySizeScale: 1.18, safeAreaPercent: 8, animation: "fade" }) },
  { name: "Worship Lyrics", templateKey: "worship_lyrics", appearance: themeAppearance({ bodySizeScale: 1.3, secondaryTextColor: "#dbeafe", animation: "slide" }) },
  { name: "Announcement", templateKey: "announcement", appearance: themeAppearance({ horizontalAlignment: "left", titleSizeScale: 1.25, bodySizeScale: 0.9, safeAreaPercent: 9 }) },
  { name: "Youth Service", templateKey: "youth_service", appearance: themeAppearance({ background: { kind: "gradient", value: "linear-gradient(135deg,#312e81,#7c3aed,#db2777)" }, secondaryTextColor: "#fde047", animation: "zoom" }) },
  { name: "Conference", templateKey: "conference", appearance: themeAppearance({ background: { kind: "gradient", value: "linear-gradient(135deg,#07111f,#0f3d56)" }, horizontalAlignment: "left", secondaryTextColor: "#67e8f9", safeAreaPercent: 7 }) },
  { name: "Funeral", templateKey: "funeral", appearance: themeAppearance({ background: { kind: "solid", value: "#111827" }, secondaryTextColor: "#d1d5db", animation: "fade", shadow: false }) },
  { name: "Wedding", templateKey: "wedding", appearance: themeAppearance({ background: { kind: "gradient", value: "linear-gradient(135deg,#fff7ed,#fce7f3)" }, primaryTextColor: "#3f2d2d", secondaryTextColor: "#9f1239", fontFamily: "Georgia", shadow: false }) }
] as const;

type QueryClient = Pick<PoolClient, "query">;

export function parsePresentationAppearance(value: unknown): PresentationAppearance {
  return presentationAppearanceSchema.parse(value);
}

export function resolvePresentationAppearance(value: unknown): PresentationAppearance {
  const parsed = presentationAppearanceSchema.safeParse(value);
  return parsed.success ? parsed.data : presentationAppearanceSchema.parse(DEFAULT_PRESENTATION_APPEARANCE);
}

export async function ensureBuiltinPresentationThemes(client: QueryClient, organizationId: string, createdBy: string | null) {
  for (const theme of BUILTIN_PRESENTATION_THEMES) {
    await client.query(
      `insert into presentation_themes
        (organization_id,name,template_key,appearance,is_builtin,created_by)
       values ($1::uuid,$2,$3,$4::jsonb,true,$5::uuid)
       on conflict (organization_id,name) do nothing`,
      [organizationId, theme.name, theme.templateKey, JSON.stringify(theme.appearance), createdBy]
    );
  }
}

export async function resolveServicePresentationTheme(client: QueryClient, organizationId: string, serviceId: string) {
  const found = await client.query<{
    service_id: string;
    theme_id: string | null;
    theme_name: string | null;
    template_key: string | null;
    appearance: unknown;
    is_builtin: boolean | null;
  }>(
    `select s.id::text as service_id,
            t.id::text as theme_id,t.name as theme_name,t.template_key,t.appearance,t.is_builtin
       from services s
       left join presentation_themes t
         on t.id=s.active_theme_id and t.organization_id=s.organization_id
      where s.id=$1::uuid and s.organization_id=$2::uuid
      limit 1`,
    [serviceId, organizationId]
  );
  const row = found.rows[0];
  if (!row || !row.theme_id) {
    return { serviceFound: Boolean(row), theme: null, appearance: presentationAppearanceSchema.parse(DEFAULT_PRESENTATION_APPEARANCE) };
  }
  return {
    serviceFound: true,
    theme: { id: row.theme_id, name: row.theme_name!, templateKey: row.template_key!, isBuiltin: Boolean(row.is_builtin) },
    appearance: resolvePresentationAppearance(row.appearance)
  };
}
