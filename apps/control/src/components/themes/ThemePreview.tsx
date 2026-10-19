"use client";

import type { PresentationAppearance } from "@/lib/presentation-themes";

export const MIN_PREVIEW_TEXT_PX = 12;

export type ThemePreviewFixture = "Scripture" | "Lyrics" | "Announcement" | "Lower Third";

const gradients: Record<string,string> = {
  midnight: "linear-gradient(135deg,#090d14,#121b2a)",
  violet_pink: "linear-gradient(135deg,#312e81,#7c3aed,#db2777)",
  navy_teal: "linear-gradient(135deg,#07111f,#0f3d56)",
  ivory_rose: "linear-gradient(135deg,#fff7ed,#fce7f3)"
};

const fixtures: Record<ThemePreviewFixture,{ title:string; body:string; footer:string }> = {
  Scripture: { title:"John 3:16", body:"For God so loved the world…", footer:"WEB · Scripture" },
  Lyrics: { title:"Worship", body:"Your grace is enough for every season", footer:"Song · Verse 1" },
  Announcement: { title:"Welcome Home", body:"Service begins at 9:00 AM · Invite someone this Sunday", footer:"Announcement" },
  "Lower Third": { title:"Pastor David Mensah", body:"Senior Pastor", footer:"Sunday Service" }
};

function px(base:number, scale:number, ceiling:number) {
  return Math.max(MIN_PREVIEW_TEXT_PX, Math.min(ceiling, Math.round(base * scale)));
}

function background(appearance: PresentationAppearance) {
  if (appearance.background.kind === "solid") return appearance.background.value;
  if (appearance.background.kind === "gradient") return gradients[appearance.background.value] ?? gradients.midnight;
  return "linear-gradient(135deg,#111827,#1f2937)";
}

export function ThemePreview({ appearance, fixture }: { appearance: PresentationAppearance; fixture: ThemePreviewFixture }) {
  const content=fixtures[fixture];
  const horizontal = appearance.horizontalAlignment === "left" ? "flex-start" : appearance.horizontalAlignment === "right" ? "flex-end" : "center";
  const vertical = appearance.verticalAlignment === "top" ? "flex-start" : appearance.verticalAlignment === "bottom" ? "flex-end" : "center";
  const showLowerThird = fixture === "Lower Third" || appearance.lowerThird.mode === "always";
  return <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/[.09] bg-black shadow-2xl" data-theme-preview-fixture={fixture}>
    <div className="absolute inset-0" style={{ background:background(appearance) }} />
    {appearance.background.kind === "image" ? <div className="absolute inset-0 flex items-center justify-center text-xs text-white/35">Image background · asset selected</div> : null}
    <div className="absolute inset-0 flex" style={{ alignItems:vertical, justifyContent:horizontal, padding:`${appearance.safeAreaPercent}%` }}>
      <div className={`max-w-[92%] ${showLowerThird ? "w-full" : ""}`} style={{ textAlign:appearance.horizontalAlignment }}>
        <div className={showLowerThird ? "inline-block max-w-[88%] rounded-xl px-4 py-3" : ""} style={showLowerThird ? { backgroundColor:`rgba(0,0,0,${appearance.backingOpacity})` } : undefined}>
          <div style={{ color:appearance.secondaryTextColor, fontFamily:appearance.fontFamily, fontSize:px(28,appearance.titleSizeScale,64), lineHeight:1.08, textShadow:appearance.shadow ? "0 2px 14px rgba(0,0,0,.65)" : "none" }} className="font-black">{content.title}</div>
          <div className="mt-2" style={{ color:appearance.primaryTextColor, fontFamily:appearance.fontFamily, fontSize:px(22,appearance.bodySizeScale,52), lineHeight:1.18, textShadow:appearance.shadow ? "0 2px 12px rgba(0,0,0,.65)" : "none" }}>{content.body}</div>
          <div className="mt-2 font-semibold uppercase tracking-[.08em]" style={{ color:appearance.secondaryTextColor, fontFamily:appearance.fontFamily, fontSize:px(12,appearance.footerSizeScale,24) }}>{content.footer}</div>
        </div>
      </div>
    </div>
    {appearance.logo.mediaId ? <div className={`absolute rounded-lg border border-white/20 bg-black/35 px-2 py-1 text-[12px] font-bold text-white/70 ${appearance.logo.position.includes("top") ? "top-3" : "bottom-3"} ${appearance.logo.position.includes("left") ? "left-3" : "right-3"}`} style={{ maxWidth:`${appearance.logo.sizePercent * 2}%` }}>LOGO</div> : null}
  </div>;
}
