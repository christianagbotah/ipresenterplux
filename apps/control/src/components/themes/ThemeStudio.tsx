"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Palette, RotateCcw, Save, Sparkles } from "lucide-react";
import { DEFAULT_PRESENTATION_APPEARANCE, type PresentationAppearance } from "@/lib/presentation-themes";
import { ThemePreview, type ThemePreviewFixture } from "./ThemePreview";

export const BUILTIN_TEMPLATE_ORDER = ["Sunday Modern","Lower Third Scripture","Sermon Scripture","Worship Lyrics","Announcement","Youth Service","Conference","Funeral","Wedding"] as const;

type Theme = {
  id:string; organizationId:string; name:string; templateKey:string; appearance:PresentationAppearance;
  isBuiltin:boolean; createdBy:string|null; createdAt:string; updatedAt:string;
};
type Service = { id:string; title:string; activeThemeId:string|null };

type Props = { organizationId:string; initialThemes:Theme[]; service:Service|null; canEdit:boolean; canAssign:boolean };

const gradientOptions = ["midnight","violet_pink","navy_teal","ivory_rose"] as const;
const fixtureOptions: ThemePreviewFixture[] = ["Scripture","Lyrics","Announcement","Lower Third"];

function cloneAppearance(value:PresentationAppearance):PresentationAppearance {
  return { ...value, background:{...value.background}, lowerThird:{...value.lowerThird}, logo:{...value.logo} };
}
function slug(value:string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,48) || "custom_theme";
}

export function ThemeStudio({ organizationId, initialThemes, service, canEdit, canAssign }:Props) {
  const router=useRouter();
  const [themes,setThemes]=useState(initialThemes);
  const firstId=service?.activeThemeId && initialThemes.some((item)=>item.id===service.activeThemeId) ? service.activeThemeId : initialThemes[0]?.id ?? "";
  const first=initialThemes.find((item)=>item.id===firstId) ?? initialThemes[0];
  const [selectedId,setSelectedId]=useState(first?.id ?? "");
  const [draft,setDraft]=useState<PresentationAppearance>(()=>cloneAppearance(first?.appearance ?? DEFAULT_PRESENTATION_APPEARANCE));
  const [draftName,setDraftName]=useState(first?.name ?? "New Theme");
  const [fixture,setFixture]=useState<ThemePreviewFixture>("Scripture");
  const [dirty,setDirty]=useState(false);
  const [activeThemeId,setActiveThemeId]=useState(service?.activeThemeId ?? null);
  const [busy,setBusy]=useState<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);

  const selected=themes.find((item)=>item.id===selectedId) ?? null;
  const orderedThemes=useMemo(()=>themes.slice().sort((a,b)=>{
    const ai=BUILTIN_TEMPLATE_ORDER.indexOf(a.name as never), bi=BUILTIN_TEMPLATE_ORDER.indexOf(b.name as never);
    if (a.isBuiltin && b.isBuiltin) return ai-bi;
    if (a.isBuiltin) return -1; if (b.isBuiltin) return 1; return a.name.localeCompare(b.name);
  }),[themes]);

  function choose(theme:Theme) { setSelectedId(theme.id); setDraft(cloneAppearance(theme.appearance)); setDraftName(theme.name); setDirty(false); setMessage(null); }
  function resetDraft() { if (selected) choose(selected); }
  function patch(next:Partial<PresentationAppearance>) { setDraft((current)=>({...current,...next})); setDirty(true); }
  function patchBackground(kind:PresentationAppearance["background"]["kind"]) {
    const value = kind==="solid" ? "#111827" : kind==="gradient" ? "midnight" : "00000000-0000-4000-8000-000000000000";
    patch({ background:{ kind, value } as PresentationAppearance["background"] });
  }

  async function saveTheme() {
    if (!selected || !canEdit || busy) return;
    setBusy("save"); setMessage(null);
    try {
      const builtInCopy=selected.isBuiltin;
      const url=builtInCopy ? "/api/v1/themes" : `/api/v1/themes/${selected.id}`;
      const name=(draftName.trim() || selected.name) + (builtInCopy && draftName.trim()===selected.name ? " Custom" : "");
      const body=builtInCopy
        ? { organizationId, name, templateKey:`${slug(name)}_${Date.now().toString(36)}`, appearance:draft }
        : { name, appearance:draft };
      const response=await fetch(url,{ method:builtInCopy?"POST":"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
      const payload=await response.json().catch(()=>null) as { error?:string; theme?:Theme }|null;
      if (!response.ok || !payload?.theme) throw new Error(payload?.error ?? "Theme could not be saved");
      const saved=payload.theme;
      setThemes((current)=>builtInCopy ? [...current,saved] : current.map((item)=>item.id===saved.id?saved:item));
      setSelectedId(saved.id); setDraft(cloneAppearance(saved.appearance)); setDraftName(saved.name); setDirty(false);
      setMessage(builtInCopy ? "Custom theme created. Apply it when you are ready." : "Theme saved. Live output is unchanged until Apply.");
      router.refresh();
    } catch(error){ setMessage(error instanceof Error?error.message:"Theme could not be saved"); }
    finally { setBusy(null); }
  }

  async function applyTheme() {
    if (!service || !selected || !canAssign || dirty || busy) return;
    setBusy("apply"); setMessage(null);
    try {
      const response=await fetch(`/api/v1/services/${service.id}/theme`,{ method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({themeId:selected.id}) });
      const payload=await response.json().catch(()=>null) as { error?:string }|null;
      if (!response.ok) throw new Error(payload?.error ?? "Theme could not be applied");
      setActiveThemeId(selected.id); setMessage(`${selected.name} is now the service theme. Program content/state was not changed.`); router.refresh();
    } catch(error){ setMessage(error instanceof Error?error.message:"Theme could not be applied"); }
    finally { setBusy(null); }
  }

  if (!selected) return <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[.06] p-6 text-sm text-amber-100">No presentation themes are available for this organization.</div>;

  return <div className="grid gap-4 2xl:grid-cols-[320px_minmax(0,1fr)]">
    <aside className="rounded-2xl border border-white/[.08] bg-[#0b0f16] p-4">
      <div className="flex items-center gap-2 text-[#e5b95e]"><Palette size={16}/><span className="text-[10px] font-black uppercase tracking-[.14em]">Theme library</span></div>
      <p className="mt-2 text-xs leading-5 text-white/45">Built-ins are protected. Edit one locally, then Save as custom to make a church-owned copy.</p>
      <div className="mt-4 space-y-2">
        {orderedThemes.map((theme)=><button key={theme.id} type="button" onClick={()=>choose(theme)} className={`ip-focus-gold min-h-11 w-full rounded-xl border px-3 py-2 text-left transition ${theme.id===selectedId?"border-[#d7a94a]/35 bg-[#d7a94a]/[.08]":"border-white/[.06] bg-white/[.02] hover:bg-white/[.045]"}`}>
          <span className="flex items-center justify-between gap-2"><span className="truncate text-xs font-black text-white/80">{theme.name}</span>{theme.id===activeThemeId?<span className="shrink-0 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-black text-emerald-200">ACTIVE</span>:null}</span>
          <span className="mt-1 block text-[10px] uppercase tracking-[.1em] text-white/35">{theme.isBuiltin?"Built-in":"Church theme"}</span>
        </button>)}
      </div>
    </aside>

    <div className="space-y-4">
      <section className="rounded-2xl border border-white/[.08] bg-[#0b0f16] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><div className="flex items-center gap-2 text-[#e5b95e]"><Sparkles size={15}/><span className="text-[10px] font-black uppercase tracking-[.14em]">Local preview</span></div><h1 className="mt-2 text-xl font-black">{selected.name}</h1><p className="mt-1 text-xs text-white/45">Draft changes stay here until you explicitly Save. Apply changes only the service theme selection—not Program content/state.</p></div>
          {dirty?<span className="rounded-full border border-amber-400/20 bg-amber-400/[.07] px-3 py-1.5 text-[10px] font-black uppercase tracking-[.1em] text-amber-100">Unsaved draft</span>:null}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">{fixtureOptions.map((item)=><button key={item} type="button" onClick={()=>setFixture(item)} className={`ip-focus-gold min-h-11 rounded-xl border px-3 text-xs font-bold ${fixture===item?"border-[#d7a94a]/35 bg-[#d7a94a]/[.08] text-[#efc86f]":"border-white/[.07] bg-white/[.02] text-white/55"}`}>{item}</button>)}</div>
        <div className="mt-4"><ThemePreview appearance={draft} fixture={fixture}/></div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <EditorSection title="Typography">
          <Field label="Theme name"><input value={draftName} onChange={(e)=>{setDraftName(e.target.value);setDirty(true)}} disabled={!canEdit} className="min-h-11 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-sm"/></Field>
          <Field label="Font family"><select value={draft.fontFamily} onChange={(e)=>patch({fontFamily:e.target.value as PresentationAppearance["fontFamily"]})} disabled={!canEdit} className="min-h-11 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-sm"><option>Inter</option><option>Arial</option><option>Verdana</option><option>Trebuchet MS</option><option>Georgia</option><option>Times New Roman</option><option>Noto Sans</option><option>Noto Serif</option></select></Field>
          <Range label="Title scale" value={draft.titleSizeScale} min={0.5} max={2.5} step={0.05} disabled={!canEdit} onChange={(value)=>patch({titleSizeScale:value})}/>
          <Range label="Body scale" value={draft.bodySizeScale} min={0.5} max={2.25} step={0.05} disabled={!canEdit} onChange={(value)=>patch({bodySizeScale:value})}/>
          <Range label="Footer scale" value={draft.footerSizeScale} min={0.5} max={1.75} step={0.05} disabled={!canEdit} onChange={(value)=>patch({footerSizeScale:value})}/>
          <div className="grid grid-cols-2 gap-2"><Field label="Primary"><input type="color" value={draft.primaryTextColor} onChange={(e)=>patch({primaryTextColor:e.target.value})} disabled={!canEdit} className="min-h-11 w-full rounded-xl border border-white/[.08] bg-black/20 p-2"/></Field><Field label="Accent"><input type="color" value={draft.secondaryTextColor} onChange={(e)=>patch({secondaryTextColor:e.target.value})} disabled={!canEdit} className="min-h-11 w-full rounded-xl border border-white/[.08] bg-black/20 p-2"/></Field></div>
        </EditorSection>

        <EditorSection title="Background">
          <Field label="Kind"><select value={draft.background.kind} onChange={(e)=>patchBackground(e.target.value as PresentationAppearance["background"]["kind"])} disabled={!canEdit} className="min-h-11 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-sm"><option value="solid">Solid</option><option value="gradient">Gradient</option><option value="image">Image asset</option></select></Field>
          {draft.background.kind==="solid"?<Field label="Color"><input type="color" value={draft.background.value} onChange={(e)=>patch({background:{kind:"solid",value:e.target.value}})} disabled={!canEdit} className="min-h-11 w-full rounded-xl border border-white/[.08] bg-black/20 p-2"/></Field>:null}
          {draft.background.kind==="gradient"?<Field label="Gradient"><select value={draft.background.value} onChange={(e)=>patch({background:{kind:"gradient",value:e.target.value as typeof gradientOptions[number]}})} disabled={!canEdit} className="min-h-11 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-sm">{gradientOptions.map((item)=><option key={item} value={item}>{item.replaceAll("_"," ")}</option>)}</select></Field>:null}
          {draft.background.kind==="image"?<Field label="Media asset UUID"><input value={draft.background.value} onChange={(e)=>patch({background:{kind:"image",value:e.target.value}})} disabled={!canEdit} className="min-h-11 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-sm"/></Field>:null}
        </EditorSection>

        <EditorSection title="Layout">
          <div className="grid grid-cols-2 gap-2"><Field label="Horizontal"><select value={draft.horizontalAlignment} onChange={(e)=>patch({horizontalAlignment:e.target.value as PresentationAppearance["horizontalAlignment"]})} disabled={!canEdit} className="min-h-11 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-sm"><option>left</option><option>center</option><option>right</option></select></Field><Field label="Vertical"><select value={draft.verticalAlignment} onChange={(e)=>patch({verticalAlignment:e.target.value as PresentationAppearance["verticalAlignment"]})} disabled={!canEdit} className="min-h-11 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-sm"><option>top</option><option>center</option><option>bottom</option></select></Field></div>
          <Range label="Safe area %" value={draft.safeAreaPercent} min={0} max={15} step={1} disabled={!canEdit} onChange={(value)=>patch({safeAreaPercent:value})}/>
          <Range label="Backing opacity" value={draft.backingOpacity} min={0} max={1} step={0.05} disabled={!canEdit} onChange={(value)=>patch({backingOpacity:value})}/>
          <label className="flex min-h-11 items-center gap-3 rounded-xl border border-white/[.07] bg-white/[.02] px-3 text-xs font-bold text-white/65"><input type="checkbox" checked={draft.shadow} onChange={(e)=>patch({shadow:e.target.checked})} disabled={!canEdit}/> Text shadow</label>
        </EditorSection>

        <EditorSection title="Lower Third">
          <Field label="Mode"><select value={draft.lowerThird.mode} onChange={(e)=>{setDraft((c)=>({...c,lowerThird:{...c.lowerThird,mode:e.target.value as PresentationAppearance["lowerThird"]["mode"]}}));setDirty(true)}} disabled={!canEdit} className="min-h-11 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-sm"><option>off</option><option>auto</option><option>always</option></select></Field>
          <Field label="Position"><select value={draft.lowerThird.position} onChange={(e)=>{setDraft((c)=>({...c,lowerThird:{...c.lowerThird,position:e.target.value as PresentationAppearance["lowerThird"]["position"]}}));setDirty(true)}} disabled={!canEdit} className="min-h-11 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-sm"><option value="bottom_left">bottom left</option><option value="bottom_center">bottom center</option><option value="bottom_right">bottom right</option></select></Field>
        </EditorSection>

        <EditorSection title="Logo">
          <Field label="Media asset UUID"><input value={draft.logo.mediaId ?? ""} onChange={(e)=>{setDraft((c)=>({...c,logo:{...c.logo,mediaId:e.target.value||null}}));setDirty(true)}} disabled={!canEdit} placeholder="Optional" className="min-h-11 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-sm"/></Field>
          <Field label="Position"><select value={draft.logo.position} onChange={(e)=>{setDraft((c)=>({...c,logo:{...c.logo,position:e.target.value as PresentationAppearance["logo"]["position"]}}));setDirty(true)}} disabled={!canEdit} className="min-h-11 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-sm"><option value="top_left">top left</option><option value="top_right">top right</option><option value="bottom_left">bottom left</option><option value="bottom_right">bottom right</option></select></Field>
          <Range label="Logo size %" value={draft.logo.sizePercent} min={1} max={30} step={1} disabled={!canEdit} onChange={(value)=>{setDraft((c)=>({...c,logo:{...c.logo,sizePercent:value}}));setDirty(true)}}/>
        </EditorSection>

        <EditorSection title="Motion">
          <Field label="Transition"><select value={draft.animation} onChange={(e)=>patch({animation:e.target.value as PresentationAppearance["animation"]})} disabled={!canEdit} className="min-h-11 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-sm"><option>instant</option><option>fade</option><option>slide</option><option>zoom</option></select></Field>
          <p className="text-xs leading-5 text-white/45">Motion is a bounded rendering hint. Theme data never contains arbitrary CSS, HTML or JavaScript.</p>
        </EditorSection>
      </section>

      <section className="sticky bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-white/[.09] bg-[#090d14]/95 p-3 shadow-2xl backdrop-blur-xl">
        <button type="button" onClick={resetDraft} disabled={!dirty||busy!==null} className="ip-focus-gold flex min-h-11 items-center gap-2 rounded-xl border border-white/[.09] px-4 text-xs font-black text-white/60 disabled:opacity-35"><RotateCcw size={14}/>Reset draft</button>
        {canEdit?<button type="button" onClick={()=>void saveTheme()} disabled={!dirty||busy!==null} className="ip-focus-gold flex min-h-11 items-center gap-2 rounded-xl border border-[#d7a94a]/25 bg-[#d7a94a]/[.08] px-4 text-xs font-black text-[#efc86f] disabled:opacity-35">{busy==="save"?<Loader2 size={14} className="animate-spin"/>:selected.isBuiltin?<Copy size={14}/>:<Save size={14}/>} {selected.isBuiltin?"Save as custom":"Save theme"}</button>:null}
        {service&&canAssign?<button type="button" onClick={()=>void applyTheme()} disabled={dirty||busy!==null||activeThemeId===selected.id} title={dirty?"Save or reset the draft before applying":"Apply persisted theme to the service"} className="ip-focus-gold flex min-h-11 items-center gap-2 rounded-xl bg-[#d7a94a] px-4 text-xs font-black text-[#17120a] disabled:opacity-35">{busy==="apply"?<Loader2 size={14} className="animate-spin"/>:<Check size={14}/>} Apply to service</button>:null}
        <div className="min-w-0 flex-1 text-xs text-white/50" aria-live="polite">{message ?? (dirty?"Previewing unsaved local changes. Live output is unchanged.":service?`Service: ${service.title}`:"No ready/live service selected.")}</div>
      </section>
    </div>
  </div>;
}

function EditorSection({ title,children }:{title:string;children:React.ReactNode}) { return <section className="rounded-2xl border border-white/[.08] bg-[#0b0f16] p-4"><h2 className="text-sm font-black">{title}</h2><div className="mt-3 space-y-3">{children}</div></section>; }
function Field({ label,children }:{label:string;children:React.ReactNode}) { return <label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-[.12em] text-white/45">{label}</span>{children}</label>; }
function Range({ label,value,min,max,step,disabled,onChange }:{label:string;value:number;min:number;max:number;step:number;disabled:boolean;onChange:(value:number)=>void}) { return <label className="block space-y-1.5"><span className="flex justify-between text-[10px] font-bold uppercase tracking-[.12em] text-white/45"><span>{label}</span><span>{value}</span></span><input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e)=>onChange(Number(e.target.value))} className="min-h-11 w-full"/></label>; }
