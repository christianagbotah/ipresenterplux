"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Radio, ShieldCheck } from "lucide-react";

type Mode = "manual" | "auto_preview" | "auto_live";

type ServiceProps = {
  scope: "service";
  serviceId: string;
  serviceStatus: string;
  mode: Mode;
  armed: boolean;
  referenceThreshold: number;
  quoteThreshold: number;
  organizationAutoLiveEnabled: boolean;
  suspendedReason?: string | null;
  hasActiveEdge?: boolean;
  canControl: boolean;
  compact?: boolean;
};

type OrganizationProps = {
  scope: "organization";
  organizationId: string;
  enabled: boolean;
  canManage: boolean;
};

type Props = ServiceProps | OrganizationProps;

type ApiPayload = { ok?: boolean; error?: string; settings?: Record<string, unknown> };

function ArmedBadge({ onDisarm, busy, canControl }: { onDisarm: () => void; busy: boolean; canControl: boolean }) {
  return <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-400/30 bg-red-400/[.09] px-3 py-2">
    <span className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[.14em] text-red-100"><Radio size={13} className="text-red-300" /> AUTO SCRIPTURE LIVE ARMED</span>
    {canControl ? <button type="button" onClick={onDisarm} disabled={busy} className="ip-focus-gold min-h-9 rounded-lg border border-red-300/25 bg-black/20 px-3 text-xs font-black text-red-100 transition hover:bg-red-300/10 disabled:opacity-40">Disarm</button> : null}
  </div>;
}

function ServiceAutomationControl(props: ServiceProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(props.mode);
  const [armed, setArmed] = useState(props.armed);
  const [referenceThreshold, setReferenceThreshold] = useState(props.referenceThreshold);
  const [quoteThreshold, setQuoteThreshold] = useState(props.quoteThreshold);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function update(nextMode: Mode, nextArmed: boolean) {
    if (!props.canControl || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/services/${props.serviceId}/scripture-automation`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: nextMode, armed: nextArmed, referenceThreshold, quoteThreshold })
      });
      const payload = await response.json().catch(() => null) as ApiPayload | null;
      if (!response.ok) throw new Error(payload?.error ?? "Scripture automation could not be updated");
      setMode(nextMode);
      setArmed(nextArmed);
      setMessage(nextArmed ? "Auto Scripture Live is armed for this live service." : "Scripture automation policy updated.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Scripture automation could not be updated");
    } finally {
      setBusy(false);
    }
  }

  function selectMode(nextMode: Mode) {
    void update(nextMode, false);
  }

  const armBlockReason = !props.organizationAutoLiveEnabled
    ? "Organization permission is off"
    : props.serviceStatus !== "live"
      ? "Service must be live"
      : props.hasActiveEdge === false
        ? "Active Edge required"
        : !props.canControl
          ? "Live operator permission required"
          : null;

  if (props.compact) {
    return armed ? <ArmedBadge onDisarm={() => void update(mode, false)} busy={busy} canControl={props.canControl} /> : null;
  }

  const modes: Array<{ id: Mode; label: string; detail: string }> = [
    { id: "manual", label: "Manual", detail: "Detections stay in Next until an operator prepares them." },
    { id: "auto_preview", label: "Auto Preview", detail: "Eligible detections prepare Preview; Program still waits for TAKE." },
    { id: "auto_live", label: "Auto Scripture Live", detail: "Eligible Scripture may reach Program only after a separate arm action." }
  ];

  return <section className="rounded-2xl border border-white/[.08] bg-[#0b0f16] p-4 sm:p-5" data-scripture-automation-control>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2 text-[#e5b95e]"><ShieldCheck size={15} /><span className="text-[11px] font-black uppercase tracking-[.14em]">Scripture automation</span></div>
        <h2 className="mt-2 text-base font-black">Choose how detected Scripture is prepared</h2>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-white/50">Manual is the safe default. Selecting Auto Scripture Live never arms it by itself.</p>
      </div>
      {armed ? <ArmedBadge onDisarm={() => void update(mode, false)} busy={busy} canControl={props.canControl} /> : null}
    </div>

    <div className="mt-4 grid gap-2 lg:grid-cols-3">
      {modes.map((item) => <button key={item.id} type="button" onClick={() => selectMode(item.id)} disabled={!props.canControl || busy} className={`ip-focus-gold min-h-20 rounded-xl border p-3 text-left transition disabled:opacity-40 ${mode === item.id ? "border-[#d7a94a]/45 bg-[#d7a94a]/[.09]" : "border-white/[.07] bg-white/[.02] hover:bg-white/[.045]"}`}>
        <span className="block text-sm font-black text-white/85">{item.label}</span><span className="mt-1 block text-[11px] leading-4 text-white/50">{item.detail}</span>
      </button>)}
    </div>

    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
      <label className="space-y-1.5"><span className="text-[11px] font-bold uppercase tracking-[.12em] text-white/45">Reference confidence</span><input type="number" min={98} max={100} step="0.01" value={referenceThreshold} onChange={(event) => setReferenceThreshold(Math.max(98, Number(event.target.value) || 98))} disabled={armed || !props.canControl} className="min-h-10 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-sm text-white disabled:opacity-40" /></label>
      <label className="space-y-1.5"><span className="text-[11px] font-bold uppercase tracking-[.12em] text-white/45">Quote confidence</span><input type="number" min={96} max={100} step="0.01" value={quoteThreshold} onChange={(event) => setQuoteThreshold(Math.max(96, Number(event.target.value) || 96))} disabled={armed || !props.canControl} className="min-h-10 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-sm text-white disabled:opacity-40" /></label>
      <button type="button" onClick={() => void update(mode, false)} disabled={armed || !props.canControl || busy} className="ip-focus-gold min-h-10 self-end rounded-xl border border-white/[.09] bg-white/[.035] px-4 text-xs font-black text-white/65 hover:bg-white/[.06] disabled:opacity-40">Save thresholds</button>
    </div>

    {mode === "auto_live" && !armed ? <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[.06] p-3">
      <div className="flex items-start gap-2"><AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-300"/><div><p className="text-xs font-black text-amber-100">Arming is a separate live-service action</p><p className="mt-1 text-[11px] leading-5 text-white/55">{armBlockReason ?? "Eligible high-confidence Scripture can go directly to Program while armed. You can disarm with one action at any time."}</p></div></div>
      <button type="button" onClick={() => void update("auto_live", true)} disabled={Boolean(armBlockReason) || busy} className="ip-focus-gold mt-3 min-h-10 rounded-xl bg-[#d7a94a] px-4 text-xs font-black text-[#17120a] disabled:opacity-35">{busy ? <span className="inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin"/> Working…</span> : "Arm Auto Scripture Live"}</button>
    </div> : null}

    {props.suspendedReason && !armed ? <p className="mt-3 text-[11px] text-amber-200/75">Last suspension: {props.suspendedReason.replaceAll("_", " ")}</p> : null}
    {message ? <p className="mt-3 text-xs text-white/60" aria-live="polite">{message}</p> : null}
  </section>;
}

function OrganizationAutomationControl(props: OrganizationProps) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(props.enabled);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function setPermission(next: boolean) {
    if (!props.canManage || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/settings/scripture-automation?organizationId=${encodeURIComponent(props.organizationId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoScriptureLiveEnabled: next })
      });
      const payload = await response.json().catch(() => null) as ApiPayload | null;
      if (!response.ok) throw new Error(payload?.error ?? "Organization permission could not be updated");
      setEnabled(next);
      setMessage(next ? "Organization permission enabled. Each live service must still be armed separately." : "Organization permission disabled and active service arming was cleared.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Organization permission could not be updated");
    } finally {
      setBusy(false);
    }
  }

  return <section className="rounded-2xl border border-white/[.08] bg-[#0d121a] p-5">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><div className="text-[11px] font-black uppercase tracking-[.14em] text-[#d7a94a]">Organization permission</div><h2 className="mt-2 text-lg font-black">Auto Scripture Live</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">This permission only makes the feature available. It does not arm any service. A live operator must arm each live service deliberately.</p></div><span className={`rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-[.12em] ${enabled ? "border-emerald-400/25 bg-emerald-400/[.08] text-emerald-200" : "border-white/[.08] bg-white/[.03] text-white/50"}`}>{enabled ? "Permitted" : "Off"}</span></div>
    <button type="button" onClick={() => void setPermission(!enabled)} disabled={!props.canManage || busy} className="ip-focus-gold mt-5 min-h-10 rounded-xl border border-[#d7a94a]/25 bg-[#d7a94a]/[.08] px-4 text-xs font-black text-[#efc86f] disabled:opacity-40">{busy ? "Updating…" : enabled ? "Disable Auto Scripture Live" : "Enable Auto Scripture Live"}</button>
    {message ? <p className="mt-3 text-xs text-white/60" aria-live="polite">{message}</p> : null}
  </section>;
}

export function ScriptureAutomationControl(props: Props) {
  return props.scope === "service" ? <ServiceAutomationControl {...props} /> : <OrganizationAutomationControl {...props} />;
}
