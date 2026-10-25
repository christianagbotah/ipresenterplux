"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ArrowUpRight, BookOpen, BrainCircuit, Check, Loader2, RefreshCcw, Save, ServerCog } from "lucide-react";
import type { ServicePreparationContext } from "@/lib/service-intelligence/contracts";
import type { PlannerWorkspaceItem, PlannerWorkspaceService } from "./planner-workspace-types";

export type PreparationApplyPayload={item?:PlannerWorkspaceItem;revision?:string;service?:PlannerWorkspaceService;edgeAssignment?:{count:number}};
type Props={serviceId:string;revision:string;canEdit:boolean;initialPreparation:ServicePreparationContext;onApplied:(payload:PreparationApplyPayload)=>void};

type PrepResponse={ok?:boolean;error?:string;preparation?:ServicePreparationContext;note?:{id:string};revision?:string};
type ApplyResponse=PreparationApplyPayload & {ok?:boolean;error?:string;code?:string};

export function ServicePreparationPanel({serviceId,revision,canEdit,initialPreparation,onApplied}:Props){
  const [preparation,setPreparation]=useState(initialPreparation);
  const existing=preparation.notes.find(note=>note.noteType==="sermon_notes")??preparation.notes[0]??null;
  const [noteId,setNoteId]=useState<string|null>(existing?.id??null);
  const [noteTitle,setNoteTitle]=useState(existing?.title??"Sermon notes");
  const [noteContent,setNoteContent]=useState(existing?.content??"");
  const [message,setMessage]=useState<string|null>(null);
  const [pending,startTransition]=useTransition();

  async function refreshPreparation(){
    const response=await fetch(`/api/v1/planner/services/${serviceId}/preparation`,{cache:"no-store"});
    const payload=await response.json().catch(()=>null) as PrepResponse|null;
    if(!response.ok||!payload?.ok||!payload.preparation) throw new Error(payload?.error??"Preparation intelligence could not be refreshed.");
    setPreparation(payload.preparation);
    return payload.preparation;
  }
  function refresh(){ setMessage(null); startTransition(async()=>{try{await refreshPreparation();setMessage("Preparation intelligence refreshed.");}catch(error){setMessage(error instanceof Error?error.message:"Refresh failed.");}}); }
  function saveNote(){
    if(!canEdit||!noteContent.trim()) return; setMessage(null);
    startTransition(async()=>{try{
      const response=await fetch(`/api/v1/planner/services/${serviceId}/preparation`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({noteId:noteId??undefined,noteType:"sermon_notes",title:noteTitle,content:noteContent})});
      const payload=await response.json().catch(()=>null) as PrepResponse|null; if(!response.ok||!payload?.ok) throw new Error(payload?.error??"Sermon notes could not be saved.");
      if(payload.note?.id) setNoteId(payload.note.id); await refreshPreparation(); setMessage("Sermon notes saved and preparation intelligence refreshed.");
    }catch(error){setMessage(error instanceof Error?error.message:"Sermon notes could not be saved.");}});
  }
  function applySuggestion(suggestionId:string){
    if(!canEdit) return; setMessage(null);
    startTransition(async()=>{try{
      const response=await fetch(`/api/v1/planner/services/${serviceId}/preparation/apply`,{method:"POST",headers:{"content-type":"application/json","If-Match":`"${revision}"`},body:JSON.stringify({suggestionId})});
      const payload=await response.json().catch(()=>null) as ApplyResponse|null; if(!response.ok||!payload?.ok) throw new Error(payload?.error??"Suggestion could not be added to the plan.");
      onApplied(payload); await refreshPreparation(); setMessage("Added to the service plan.");
    }catch(error){setMessage(error instanceof Error?error.message:"Suggestion could not be added to the plan.");}});
  }

  const readiness=preparation.readiness;
  return <section className="mb-4 overflow-hidden rounded-2xl border border-[#e3b75c]/15 bg-[linear-gradient(135deg,rgba(215,169,74,.055),rgba(255,255,255,.015))]">
    <div className="flex flex-col gap-3 border-b border-white/[.07] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e3b75c]/10 text-[#f0ca80]"><BrainCircuit size={19}/></div><div><div className="text-sm font-black text-white/90">Prepare with service intelligence</div><div className="mt-1 text-xs leading-5 text-white/48">Sermon notes, reusable content and recent service memory become suggestions. Nothing changes the rundown until you choose Add to plan.</div></div></div>
      <button type="button" onClick={refresh} disabled={pending} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-white/[.09] px-3.5 text-xs font-bold text-white/65 transition hover:bg-white/[.05] ip-focus-gold disabled:opacity-40">{pending?<Loader2 size={14} className="animate-spin"/>:<RefreshCcw size={14}/>}Refresh intelligence</button>
    </div>
    <div className="grid gap-3 p-4 xl:grid-cols-[minmax(280px,.8fr)_minmax(0,1.5fr)]">
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-[11px]">
          <div className="rounded-xl border border-white/[.06] bg-black/15 p-2.5"><div className="text-white/35">Outputs</div><div className="mt-1 font-black text-white/70">{readiness.outputs.healthy}/{readiness.outputs.enabled} ready</div></div>
          <div className="rounded-xl border border-white/[.06] bg-black/15 p-2.5"><div className="text-white/35">Languages</div><div className="mt-1 font-black text-white/70">{readiness.languages.enabled} enabled</div></div>
          <div className="rounded-xl border border-white/[.06] bg-black/15 p-2.5"><div className="text-white/35">Edge</div><div className={"mt-1 font-black "+(readiness.edge.freshness==="current"?"text-emerald-300":"text-amber-300")}>{readiness.edge.freshness}</div></div>
        </div>
        <div className="rounded-xl border border-white/[.07] bg-black/15 p-3">
          <div className="flex items-center gap-2 text-xs font-black text-white/75"><BookOpen size={14} className="text-[#e5b95e]"/>Sermon notes</div>
          <input value={noteTitle} onChange={e=>setNoteTitle(e.target.value)} disabled={!canEdit||pending} maxLength={160} className="mt-3 min-h-11 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-sm text-white outline-none ip-focus-gold disabled:opacity-50" placeholder="Note title"/>
          <textarea value={noteContent} onChange={e=>setNoteContent(e.target.value)} disabled={!canEdit||pending} maxLength={100000} rows={6} className="mt-2 w-full resize-y rounded-xl border border-white/[.08] bg-black/20 px-3 py-2.5 text-sm leading-5 text-white outline-none ip-focus-gold disabled:opacity-50" placeholder="Paste sermon notes, Bible references, closing cues or service emphasis…"/>
          <button type="button" onClick={saveNote} disabled={!canEdit||pending||!noteContent.trim()} className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-white/[.07] px-3 text-xs font-extrabold text-white/75 transition hover:bg-white/[.11] ip-focus-gold disabled:opacity-35"><Save size={14}/>Save notes</button>
        </div>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between gap-2"><div className="text-[11px] font-black uppercase tracking-[.16em] text-white/38">Evidence-backed suggestions</div><span className="text-[11px] text-white/28">{preparation.suggestions.length} found</span></div>
        <div className="grid gap-2 lg:grid-cols-2">
          {preparation.suggestions.length?preparation.suggestions.slice(0,10).map(suggestion=><article key={suggestion.id} className="rounded-xl border border-white/[.07] bg-black/15 p-3">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-sm font-black text-white/80">{suggestion.title}</div><div className="mt-1 text-[11px] leading-4 text-white/40">{suggestion.reason}</div></div><span className="shrink-0 rounded-full bg-white/[.05] px-2 py-1 text-[11px] font-bold text-white/45">{suggestion.confidence}%</span></div>
            <div className="mt-2 line-clamp-2 text-[11px] leading-4 text-white/30">{suggestion.evidence}</div>
            <div className="mt-3 flex gap-2">{suggestion.plannerCandidate?<button type="button" onClick={()=>applySuggestion(suggestion.id)} disabled={!canEdit||pending} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#e3b75c] px-3 text-xs font-black text-[#171107] transition hover:brightness-110 ip-focus-gold disabled:opacity-35"><Check size={14}/>Add to plan</button>:null}{suggestion.navigationTarget?<Link href={suggestion.navigationTarget} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-white/[.08] px-3 text-xs font-bold text-white/55 transition hover:bg-white/[.05] ip-focus-gold">Open <ArrowUpRight size={13}/></Link>:null}</div>
          </article>):<div className="rounded-xl border border-dashed border-white/[.08] p-6 text-center text-sm text-white/35"><ServerCog size={18} className="mx-auto mb-2"/>Add sermon notes or reusable library content to get preparation suggestions.</div>}
        </div>
      </div>
    </div>
    {message?<div role="status" aria-live="polite" className="border-t border-white/[.06] px-4 py-2.5 text-xs text-white/55">{message}</div>:null}
  </section>;
}
