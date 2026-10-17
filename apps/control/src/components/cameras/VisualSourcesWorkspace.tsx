"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AppWindow,
  Camera,
  CircleAlert,
  CircleCheck,
  Monitor,
  Pencil,
  RefreshCw,
  ShieldAlert,
  Star,
  Unplug
} from "lucide-react";

type VisualKind = "camera" | "display" | "window";
type SourceStatus = "available" | "disconnected" | "permission_required" | "unsupported" | "busy" | "error";

type VisualSource = {
  id: string;
  organizationId: string;
  name: string;
  operatorLabel: string | null;
  displayName: string;
  kind: VisualKind;
  sourceType: string;
  sourceStatus: string;
  status: SourceStatus;
  captureStatus: string | null | undefined;
  captureStatusLabel: string;
  previewActive: boolean;
  programActive: boolean;
  width: number | null;
  height: number | null;
  fps: number | null;
  processName: string | null;
  displayPrimary: boolean | null;
  preferred: boolean;
  lastSeenAt: string | null;
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
  initialSources: VisualSource[];
  edgeDevices: EdgeDevice[];
  hasPairedEdge: boolean;
  staleAfterSeconds: number;
  canManage: boolean;
  canLiveControl: boolean;
};

const categories: Array<{ kind: VisualKind; label: string; icon: typeof Camera }> = [
  { kind: "camera", label: "Cameras", icon: Camera },
  { kind: "display", label: "Screens", icon: Monitor },
  { kind: "window", label: "Windows", icon: AppWindow }
];

function statusCopy(status: SourceStatus) {
  if (status === "available") return { label: "Available", icon: CircleCheck, className: "border-emerald-400/20 bg-emerald-400/[.08] text-emerald-200" };
  if (status === "permission_required") return { label: "Permission required", icon: ShieldAlert, className: "border-amber-300/20 bg-amber-300/[.08] text-amber-100" };
  if (status === "unsupported") return { label: "Unsupported", icon: CircleAlert, className: "border-red-300/20 bg-red-300/[.08] text-red-100" };
  if (status === "busy") return { label: "Busy", icon: CircleAlert, className: "border-amber-300/20 bg-amber-300/[.08] text-amber-100" };
  if (status === "error") return { label: "Capture error", icon: CircleAlert, className: "border-red-300/20 bg-red-300/[.08] text-red-100" };
  return { label: "Disconnected", icon: Unplug, className: "border-white/[.10] bg-white/[.035] text-white/55" };
}

function relativeTime(value: string | null) {
  if (!value) return "Never reported";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

function sourceIcon(kind: VisualKind) {
  if (kind === "display") return Monitor;
  if (kind === "window") return AppWindow;
  return Camera;
}

function formatSignal(source: VisualSource) {
  const size = source.width && source.height ? `${source.width}×${source.height}` : null;
  const fps = source.fps ? `${source.fps} fps` : null;
  return [size, fps].filter(Boolean).join(" · ") || "Format not reported";
}

export function VisualSourcesWorkspace({
  organizationId,
  organizationName,
  initialSources,
  edgeDevices,
  hasPairedEdge,
  staleAfterSeconds,
  canManage,
  canLiveControl: _canLiveControl
}: Props) {
  const [sources, setSources] = useState(initialSources);
  const [activeKind, setActiveKind] = useState<VisualKind>("camera");
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const visibleSources = useMemo(() => sources.filter((source) => source.kind === activeKind), [sources, activeKind]);
  const counts = useMemo(() => Object.fromEntries(categories.map(({ kind }) => [kind, sources.filter((source) => source.kind === kind).length])) as Record<VisualKind, number>, [sources]);

  async function savePreference(source: VisualSource, preferred = source.preferred) {
    if (!canManage || source.kind !== "camera") return;
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
        preferred: item.kind === "camera" && preferred ? item.id === source.id : item.id === source.id ? false : item.preferred,
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

  async function clearPreference(source: VisualSource) {
    if (!canManage || source.kind !== "camera") return;
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
      <a href="#visual-sources-content" className="ip-focus-gold sr-only z-[200] rounded-lg border border-[#d7a94a]/40 bg-[#0a0f17] px-4 py-2.5 text-sm font-bold text-[#efc86f] focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:shadow-2xl">
        Skip to Visual Sources content
      </a>
      <header className="sticky top-0 z-40 border-b border-white/[.07] bg-[#090c12]/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-[#d7a94a]"><Monitor size={14} />Visual Sources</div>
            <h1 className="mt-1 text-xl font-black tracking-tight sm:text-2xl">{organizationName}</h1>
            <p className="mt-1 text-xs text-white/45">Edge-owned camera, screen and window truth. Physical capture stays on the church production computer.</p>
          </div>
          <Link href="/settings/devices" className="ip-focus-gold inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/[.09] bg-white/[.03] px-4 text-sm font-bold text-white/70 transition hover:bg-white/[.06] hover:text-white"><RefreshCw size={16} />Manage Edge Devices</Link>
        </div>
      </header>

      <div id="visual-sources-content" tabIndex={-1} className="mx-auto max-w-[1600px] space-y-5 px-4 py-5 focus:outline-none sm:px-6 lg:px-8 lg:py-7">
        <section className="rounded-2xl border border-white/[.07] bg-white/[.02] p-2" aria-label="Visual source categories">
          <div className="grid gap-2 sm:grid-cols-3">
            {categories.map(({ kind, label: categoryLabel, icon: Icon }) => (
              <button key={kind} type="button" onClick={() => setActiveKind(kind)} className={`ip-focus-gold flex min-h-11 items-center justify-between gap-3 rounded-xl px-4 text-left text-xs font-black transition ${activeKind === kind ? "border border-[#d7a94a]/30 bg-[#d7a94a]/[.09] text-[#f1d595]" : "border border-white/[.06] bg-black/15 text-white/60 hover:bg-white/[.04]"}`} aria-pressed={activeKind === kind}>
                <span className="flex items-center gap-2"><Icon size={16} />{categoryLabel}</span><span>{counts[kind]}</span>
              </button>
            ))}
          </div>
        </section>

        {!hasPairedEdge ? (
          <section className="rounded-3xl border border-amber-300/20 bg-amber-300/[.05] p-6">
            <div className="flex items-start gap-4"><ShieldAlert size={24} className="mt-1 shrink-0 text-amber-200" /><div><h2 className="text-lg font-black text-amber-100">Pair a production computer first</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-white/50">Visual source discovery and capture truth come from the Windows/macOS Edge application. This browser never requests sanctuary camera, screen or window capture.</p><Link href="/settings/devices" className="ip-focus-gold mt-4 inline-flex min-h-11 cursor-pointer items-center rounded-xl bg-[#d7a94a] px-4 text-xs font-black text-[#17120a] hover:brightness-110">Manage Edge Devices</Link></div></div>
          </section>
        ) : null}

        <section className="rounded-3xl border border-white/[.07] bg-[#0c1017]/80 p-4 sm:p-5 lg:p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div><div className="text-xs font-bold uppercase tracking-[.16em] text-[#d7a94a]">Edge-confirmed source truth</div><h2 className="mt-1 text-xl font-black tracking-tight">{categories.find((item) => item.kind === activeKind)?.label}</h2><p className="mt-1 text-sm text-white/45">Confirmed route badges disappear when source telemetry is stale. Sources become disconnected after {staleAfterSeconds}s without a fresh report.</p></div>
            <div className="text-xs text-white/40">{edgeDevices.length} paired/non-revoked Edge device{edgeDevices.length === 1 ? "" : "s"}</div>
          </div>

          {message ? <div className="mt-4 rounded-xl border border-[#d7a94a]/15 bg-[#d7a94a]/[.06] px-4 py-3 text-sm text-[#f2dca9]">{message}</div> : null}

          <div className="mt-5 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {visibleSources.map((source) => {
              const state = statusCopy(source.status);
              const StatusIcon = state.icon;
              const SourceIcon = sourceIcon(source.kind);
              const isEditing = editing === source.id;
              return (
                <article key={source.id} className="flex min-h-72 min-w-0 flex-col rounded-2xl border border-white/[.07] bg-white/[.025] p-4">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[.07] bg-black/20 text-[#d7a94a]"><SourceIcon size={18} /></div><div className="min-w-0"><div className="break-words text-base font-black leading-5">{source.displayName}</div><div className="mt-1 text-xs uppercase tracking-[.12em] text-white/40">{source.kind === "camera" ? "Camera" : source.kind === "display" ? "Screen" : source.kind === "window" ? "Window" : source.sourceType}</div></div></div>
                    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-black uppercase tracking-[.06em] ${state.className}`}><StatusIcon size={12} />{state.label}</span>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {source.previewActive ? <span className="rounded-full border border-sky-300/20 bg-sky-300/[.08] px-2.5 py-1 text-xs font-black uppercase tracking-[.06em] text-sky-100">Preview · confirmed</span> : null}
                    {source.programActive ? <span className="rounded-full border border-red-300/20 bg-red-300/[.08] px-2.5 py-1 text-xs font-black uppercase tracking-[.06em] text-red-100">Program · confirmed</span> : null}
                  </div>

                  <dl className="mt-4 grid gap-2 text-xs text-white/55">
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3"><dt>Reporting Edge</dt><dd className="break-words text-right font-semibold text-white/70">{source.reportingDevice?.name || "Not linked"}</dd></div>
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3"><dt>Capture status</dt><dd className="break-words text-right font-semibold text-white/70">{source.captureStatusLabel}</dd></div>
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3"><dt>Format</dt><dd className="break-words text-right font-semibold text-white/70">{formatSignal(source)}</dd></div>
                    {source.kind === "window" && source.processName ? <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3"><dt>Application</dt><dd className="break-words text-right font-semibold text-white/70">{source.processName}</dd></div> : null}
                    {source.kind === "display" && source.displayPrimary ? <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3"><dt>Display</dt><dd className="text-right font-semibold text-white/70">Primary screen</dd></div> : null}
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3"><dt>Last report</dt><dd className="break-words text-right font-semibold text-white/70">{relativeTime(source.lastSeenAt)}</dd></div>
                    {source.kind === "camera" ? <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3"><dt>Preference</dt><dd className={source.preferred ? "text-right font-bold text-[#e8c878]" : "text-right font-semibold text-white/55"}>{source.preferred ? "Preferred source" : "Standard"}</dd></div> : null}
                  </dl>

                  {source.kind === "camera" && isEditing && canManage ? (
                    <div className="mt-4 rounded-xl border border-white/[.08] bg-black/20 p-3"><label className="text-xs font-bold uppercase tracking-[.12em] text-white/45">Operator label</label><input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={160} className="ip-focus-gold mt-2 min-h-11 w-full rounded-lg border border-white/[.08] bg-white/[.04] px-3 text-sm text-white outline-none focus:border-[#d7a94a]/50" placeholder={source.name} /><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => savePreference(source)} disabled={busy === source.id} className="ip-focus-gold min-h-11 cursor-pointer rounded-lg bg-[#d7a94a] px-3 text-xs font-black text-[#17120a] disabled:cursor-not-allowed disabled:opacity-40">Save label</button><button type="button" onClick={() => clearPreference(source)} disabled={busy === source.id} className="ip-focus-gold min-h-11 cursor-pointer rounded-lg border border-white/[.08] px-3 text-xs font-bold text-white/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">Clear preference</button></div></div>
                  ) : null}

                  {source.kind === "camera" && canManage ? (
                    <div className="mt-auto flex flex-wrap gap-2 pt-4">
                      <button type="button" onClick={() => { setEditing(isEditing ? null : source.id); setLabel(source.operatorLabel || ""); }} className="ip-focus-gold inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-white/[.08] px-3 text-xs font-bold text-white/65 hover:bg-white/[.05] hover:text-white"><Pencil size={13} />{isEditing ? "Close" : "Label"}</button>
                      <button type="button" onClick={() => savePreference(source, !source.preferred)} disabled={busy === source.id} className="ip-focus-gold inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-white/[.08] px-3 text-xs font-bold text-white/65 hover:bg-white/[.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"><Star size={13} />{source.preferred ? "Remove preferred" : "Make preferred"}</button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>

          {visibleSources.length === 0 && hasPairedEdge ? (
            <div className="mt-5 rounded-2xl border border-dashed border-white/[.09] px-6 py-14 text-center"><Monitor size={28} className="mx-auto text-white/20" /><div className="mt-3 text-sm font-bold">No {categories.find((item) => item.kind === activeKind)?.label.toLowerCase()} reported yet</div><p className="mx-auto mt-1 max-w-xl text-xs leading-5 text-white/40">Open the Edge application on the church production computer and rescan local sources. This page only reflects what Edge reports.</p></div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
