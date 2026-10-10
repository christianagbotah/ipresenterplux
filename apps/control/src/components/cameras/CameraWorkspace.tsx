"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Camera, CircleAlert, CircleCheck, ExternalLink, Pencil, RefreshCw, ShieldAlert, Star, Unplug } from "lucide-react";

type SourceStatus = "available" | "disconnected" | "permission_required" | "unsupported";

type CameraSource = {
  id: string;
  organizationId: string;
  name: string;
  operatorLabel: string | null;
  displayName: string;
  sourceType: string;
  sourceStatus: string;
  status: SourceStatus;
  preferred: boolean;
  lastSeenAt: string | null;
  previewUrl: string | null;
  reportingDevice: {
    id: string;
    name: string | null;
    platform: string | null;
    status: string | null;
    lastSeenAt: string | null;
  } | null;
};

type EdgeDevice = {
  id: string;
  name: string;
  platform: string;
  status: string;
  lastSeenAt: string | null;
};

type Props = {
  organizationId: string;
  organizationName: string;
  initialSources: CameraSource[];
  edgeDevices: EdgeDevice[];
  hasPairedEdge: boolean;
  staleAfterSeconds: number;
  canManage: boolean;
};

function statusCopy(status: SourceStatus) {
  if (status === "available") return { label: "Available", icon: CircleCheck, className: "border-emerald-400/20 bg-emerald-400/[.08] text-emerald-200" };
  if (status === "permission_required") return { label: "Permission required", icon: ShieldAlert, className: "border-amber-300/20 bg-amber-300/[.08] text-amber-100" };
  if (status === "unsupported") return { label: "Unsupported", icon: CircleAlert, className: "border-red-300/20 bg-red-300/[.08] text-red-100" };
  return { label: "Disconnected", icon: Unplug, className: "border-white/[.10] bg-white/[.035] text-white/55" };
}

function relativeTime(value: string | null) {
  if (!value) return "Never reported";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

export function CameraWorkspace({
  organizationId,
  organizationName,
  initialSources,
  edgeDevices,
  hasPairedEdge,
  staleAfterSeconds,
  canManage
}: Props) {
  const [sources, setSources] = useState(initialSources);
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const counts = useMemo(() => ({
    available: sources.filter((source) => source.status === "available").length,
    attention: sources.filter((source) => source.status !== "available").length,
    preferred: sources.filter((source) => source.preferred).length
  }), [sources]);

  async function savePreference(source: CameraSource, preferred = source.preferred) {
    if (!canManage) return;
    setBusy(source.id);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/cameras/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          mediaSourceId: source.id,
          operatorLabel: editing === source.id ? label.trim() || null : source.operatorLabel,
          preferred
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not save camera preference");
      setSources((current) => current.map((item) => ({
        ...item,
        preferred: preferred ? item.id === source.id : item.id === source.id ? false : item.preferred,
        operatorLabel: item.id === source.id ? payload.preference.operatorLabel : item.operatorLabel,
        displayName: item.id === source.id ? payload.preference.operatorLabel || item.name : item.displayName
      })));
      setEditing(null);
      setMessage(`${source.name} preference saved.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save camera preference");
    } finally {
      setBusy(null);
    }
  }

  async function clearPreference(source: CameraSource) {
    if (!canManage) return;
    setBusy(source.id);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/cameras/preferences", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, mediaSourceId: source.id })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not clear camera preference");
      setSources((current) => current.map((item) => item.id === source.id
        ? { ...item, preferred: false, operatorLabel: null, displayName: item.name }
        : item));
      setEditing(null);
      setMessage(`${source.name} preference cleared.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not clear camera preference");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#080b10] text-white">
      <a
        href="#cameras-content"
        className="ip-focus-gold sr-only z-[200] rounded-lg border border-[#d7a94a]/40 bg-[#0a0f17] px-4 py-2.5 text-sm font-bold text-[#efc86f] focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:shadow-2xl"
      >
        Skip to Cameras content
      </a>
      <header className="sticky top-0 z-40 border-b border-white/[.07] bg-[#090c12]/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.18em] text-[#d7a94a]"><Camera size={14} />Cameras</div>
            <h1 className="mt-1 text-xl font-black tracking-tight sm:text-2xl">{organizationName}</h1>
            <p className="mt-1 text-xs text-white/35">Edge-owned capture truth · permissions · routing preference · no browser capture simulation</p>
          </div>
          <Link href="/settings/devices" className="ip-focus-gold inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/[.09] bg-white/[.03] px-4 text-sm font-bold text-white/70 transition hover:bg-white/[.06] hover:text-white"><RefreshCw size={16} />Manage Edge Devices</Link>
        </div>
      </header>

      <div id="cameras-content" tabIndex={-1} className="mx-auto max-w-[1600px] space-y-5 px-4 py-5 focus:outline-none sm:px-6 lg:px-8 lg:py-7">
        <section className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-white/[.07] bg-white/[.02] px-4 py-3 text-xs">
          <span className="flex items-center gap-2 font-bold text-white/70"><Camera size={14} className="text-[#d7a94a]" />{counts.available} available</span>
          <span className="text-white/20">·</span>
          <span className={counts.attention ? "font-bold text-amber-200" : "font-semibold text-emerald-200/80"}>{counts.attention ? `${counts.attention} need attention` : "all sources healthy"}</span>
          <span className="text-white/20">·</span>
          <span className="font-semibold text-white/55">{counts.preferred} preferred</span>
          <span className="ml-auto text-[11px] text-white/40">Edge-reported capture truth · no browser capture</span>
        </section>

        {!hasPairedEdge && (
          <section className="rounded-3xl border border-amber-300/20 bg-amber-300/[.05] p-6">
            <div className="flex items-start gap-4"><ShieldAlert size={24} className="mt-1 shrink-0 text-amber-200" /><div><h2 className="text-lg font-black text-amber-100">Pair a production computer first</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-white/45">Camera discovery and permission truth come from the Windows/macOS Edge application at the church. This browser does not request sanctuary camera access.</p><Link href="/settings/devices" className="ip-focus-gold mt-4 inline-flex min-h-10 cursor-pointer items-center rounded-xl bg-[#d7a94a] px-4 text-xs font-black text-[#17120a] hover:brightness-110">Manage Edge Devices</Link></div></div>
          </section>
        )}

        <section className="rounded-3xl border border-white/[.07] bg-[#0c1017]/80 p-4 sm:p-5 lg:p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div><div className="text-[11px] font-bold uppercase tracking-[.16em] text-[#d7a94a]">Edge camera sources</div><h2 className="mt-1 text-xl font-black tracking-tight">Capture readiness</h2><p className="mt-1 text-sm text-white/38">Sources become disconnected after {staleAfterSeconds}s without fresh telemetry.</p></div>
            <div className="text-xs text-white/30">{edgeDevices.length} paired/non-revoked Edge device{edgeDevices.length === 1 ? "" : "s"}</div>
          </div>

          {message && <div className="mt-4 rounded-xl border border-[#d7a94a]/15 bg-[#d7a94a]/[.06] px-4 py-3 text-sm text-[#f2dca9]">{message}</div>}

          <div className="mt-5 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {sources.map((source) => {
              const state = statusCopy(source.status);
              const StatusIcon = state.icon;
              const isEditing = editing === source.id;
              return (
                <article key={source.id} className="flex min-h-64 flex-col rounded-2xl border border-white/[.07] bg-white/[.025] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[.07] bg-black/20 text-[#d7a94a]"><Camera size={18} /></div><div className="min-w-0"><div className="truncate text-base font-black">{source.displayName}</div><div className="mt-1 truncate text-[10px] uppercase tracking-[.12em] text-white/30">{source.sourceType.replaceAll("_", " ")}</div></div></div>
                    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[.09em] ${state.className}`}><StatusIcon size={12} />{state.label}</span>
                  </div>

                  <div className="mt-4 grid gap-2 text-xs text-white/55">
                    <div className="flex items-center justify-between gap-3"><span>Reporting Edge</span><span className="truncate font-semibold text-white/65">{source.reportingDevice?.name || "Not linked"}</span></div>
                    <div className="flex items-center justify-between gap-3"><span>Edge platform</span><span className="font-semibold text-white/65">{source.reportingDevice?.platform || "—"}</span></div>
                    <div className="flex items-center justify-between gap-3"><span>Last source report</span><span className="text-right font-semibold text-white/65">{relativeTime(source.lastSeenAt)}</span></div>
                    <div className="flex items-center justify-between gap-3"><span>Routing</span><span className={source.preferred ? "font-bold text-[#e8c878]" : "font-semibold text-white/50"}>{source.preferred ? "Preferred source" : "Standard"}</span></div>
                  </div>

                  {isEditing && canManage && (
                    <div className="mt-4 rounded-xl border border-white/[.08] bg-black/20 p-3"><label className="text-[10px] font-bold uppercase tracking-[.12em] text-white/35">Operator label</label><input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={160} className="ip-focus-gold mt-2 min-h-10 w-full rounded-lg border border-white/[.08] bg-white/[.04] px-3 text-sm text-white outline-none focus:border-[#d7a94a]/50" placeholder={source.name} /><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => savePreference(source)} disabled={busy === source.id} className="ip-focus-gold min-h-9 cursor-pointer rounded-lg bg-[#d7a94a] px-3 text-xs font-black text-[#17120a] disabled:cursor-not-allowed disabled:opacity-40">Save label</button><button type="button" onClick={() => clearPreference(source)} disabled={busy === source.id} className="ip-focus-gold min-h-9 cursor-pointer rounded-lg border border-white/[.08] px-3 text-xs font-bold text-white/55 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">Clear preference</button></div></div>
                  )}

                  <div className="mt-auto flex flex-wrap gap-2 pt-4">
                    {source.previewUrl && <a href={source.previewUrl} target="_blank" rel="noreferrer" className="ip-focus-gold inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-emerald-300/15 bg-emerald-300/[.06] px-3 text-xs font-bold text-emerald-100 hover:bg-emerald-300/[.10]"><ExternalLink size={13} />Open Edge preview</a>}
                    {canManage && <button type="button" onClick={() => { setEditing(isEditing ? null : source.id); setLabel(source.operatorLabel || ""); }} className="ip-focus-gold inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-white/[.08] px-3 text-xs font-bold text-white/60 hover:bg-white/[.05] hover:text-white"><Pencil size={13} />{isEditing ? "Close" : "Label"}</button>}
                    {canManage && <button type="button" onClick={() => savePreference(source, !source.preferred)} disabled={busy === source.id} className="ip-focus-gold inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-white/[.08] px-3 text-xs font-bold text-white/60 hover:bg-white/[.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"><Star size={13} />{source.preferred ? "Remove preferred" : "Make preferred"}</button>}
                  </div>
                </article>
              );
            })}
          </div>

          {sources.length === 0 && hasPairedEdge && (
            <div className="mt-5 rounded-2xl border border-dashed border-white/[.09] px-6 py-14 text-center"><Camera size={28} className="mx-auto text-white/15" /><div className="mt-3 text-sm font-bold">No camera sources reported yet</div><p className="mx-auto mt-1 max-w-xl text-xs leading-5 text-white/35">Open the Edge application on the church production computer and verify camera permissions/capture support. Sources will appear here only after Edge reports them.</p><Link href="/settings/devices" className="ip-focus-gold mt-4 inline-flex cursor-pointer rounded text-xs font-bold text-[#d7a94a] hover:underline">Manage Edge Devices →</Link></div>
          )}
        </section>
      </div>
    </main>
  );
}
