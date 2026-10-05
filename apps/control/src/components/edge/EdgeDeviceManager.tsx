"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Clipboard,
  Clock3,
  Laptop,
  MonitorUp,
  Plus,
  RefreshCw,
  ShieldX,
  Wifi,
  WifiOff,
  X,
  type LucideIcon
} from "lucide-react";

type Campus = { id: string; name: string };
type Device = {
  id: string;
  name: string;
  platform: string;
  status: string;
  campusId: string | null;
  campusName: string | null;
  softwareVersion: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  credentialState: string | null;
  credentialExpiresAt: string | null;
  pairingExpiresAt: string | null;
  capabilities: Record<string, string>;
  lastHealth: {
    status?: string;
    observedAt?: string;
    cpuPercent?: number;
    memoryPercent?: number;
    uplinkMbps?: number | null;
  } | null;
  activeServiceId: string | null;
  activeServiceTitle: string | null;
  recentCommand: {
    type: string;
    state: string;
    issuedAt: string | null;
    completedAt: string | null;
    resultingState: string | null;
    errorCode: string | null;
  } | null;
};

type PairingResult = { deviceId: string; pairingCode: string; expiresAt: string };

type Props = {
  organizationId: string;
  organizationName: string;
  campuses: Campus[];
  devices: Device[];
  canManage: boolean;
};

function liveState(device: Device) {
  if (device.status === "revoked") return { label: "Revoked", className: "text-red-300 bg-red-400/10 border-red-400/20", online: false };
  if (device.status === "pending") return { label: "Pending", className: "text-amber-200 bg-amber-400/10 border-amber-400/20", online: false };
  if (!device.lastSeenAt) return { label: "Offline", className: "text-white/40 bg-white/[.04] border-white/[.08]", online: false };
  const age = Date.now() - new Date(device.lastSeenAt).getTime();
  if (age <= 60_000) return { label: "Online", className: "text-emerald-300 bg-emerald-400/10 border-emerald-400/20", online: true };
  if (age <= 5 * 60_000) return { label: "Stale", className: "text-amber-200 bg-amber-400/10 border-amber-400/20", online: false };
  return { label: "Offline", className: "text-white/40 bg-white/[.04] border-white/[.08]", online: false };
}

function timeLabel(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function commandStateClass(state: string) {
  if (state === "succeeded") return "border-emerald-400/20 bg-emerald-400/10 text-emerald-200";
  if (state === "failed" || state === "expired") return "border-red-400/20 bg-red-400/10 text-red-200";
  if (state === "delivered") return "border-sky-400/20 bg-sky-400/10 text-sky-200";
  return "border-amber-400/20 bg-amber-400/10 text-amber-100";
}

function metric(value: number | null | undefined, suffix = "%") {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(value >= 10 ? 0 : 1)}${suffix}` : "—";
}

export function EdgeDeviceManager({ organizationId, organizationName, campuses, devices, canManage }: Props) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState<"windows" | "macos">("windows");
  const [campusId, setCampusId] = useState(campuses[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<PairingResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<Device | null>(null);

  useEffect(() => {
    if (!devices.length) return;
    const timer = window.setInterval(() => router.refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [devices.length, router]);

  const counts = useMemo(() => {
    const online = devices.filter((device) => liveState(device).online).length;
    const pending = devices.filter((device) => device.status === "pending").length;
    const revoked = devices.filter((device) => device.status === "revoked").length;
    return { online, pending, revoked };
  }, [devices]);

  function openNew() {
    setName("");
    setPlatform("windows");
    setCampusId(campuses[0]?.id ?? "");
    setError(null);
    setPairing(null);
    setFormOpen(true);
  }

  function openRepair(device: Device) {
    setName(device.name);
    setPlatform(device.platform === "macos" ? "macos" : "windows");
    setCampusId(device.campusId ?? "");
    setError(null);
    setPairing(null);
    setFormOpen(true);
  }

  async function generatePairing() {
    setBusy(true);
    setError(null);
    setPairing(null);
    try {
      const response = await fetch("/api/v1/edge/pairing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, campusId: campusId || null, name, platform, ttlMinutes: 15 })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not create pairing code");
      setPairing({ deviceId: body.deviceId, pairingCode: body.pairingCode, expiresAt: body.expiresAt });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create pairing code");
    } finally {
      setBusy(false);
    }
  }

  async function revokeDevice() {
    if (!revokeTarget) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/edge/devices/${revokeTarget.id}/revoke`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not revoke device");
      setRevokeTarget(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke device");
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    if (!pairing) return;
    await navigator.clipboard.writeText(pairing.pairingCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  const summaryCards: Array<[string, number, LucideIcon]> = [
    ["Online now", counts.online, Wifi],
    ["Awaiting pairing", counts.pending, Clock3],
    ["Revoked", counts.revoked, ShieldX]
  ];

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-3">
        {summaryCards.map(([label, value, Icon]) => (
          <div key={String(label)} className="ip-card flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[.04] text-[#d7a94a]"><Icon size={18} /></div>
            <div><div className="text-2xl font-black">{String(value)}</div><div className="text-xs text-white/35">{String(label)}</div></div>
          </div>
        ))}
      </section>

      <section className="ip-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[.07] px-4 py-4 sm:px-5">
          <div>
            <div className="text-sm font-bold">Church Edge computers</div>
            <div className="mt-1 text-xs text-white/35">{devices.length} registered for {organizationName}</div>
          </div>
          {canManage ? (
            <button onClick={openNew} className="flex items-center gap-2 rounded-xl bg-[#d7a94a] px-4 py-2.5 text-xs font-black text-[#171109] transition hover:bg-[#e6ba5e]">
              <Plus size={15} /> Pair a device
            </button>
          ) : null}
        </div>

        {devices.length ? (
          <div className="divide-y divide-white/[.06]">
            {devices.map((device) => {
              const state = liveState(device);
              return (
                <div key={device.id} className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(220px,1.4fr)_1fr_1fr_auto] lg:items-center">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[.07] bg-white/[.035] text-white/55">
                      {state.online ? <MonitorUp size={19} /> : <Laptop size={19} />}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold">{device.name}</div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-[.12em] text-white/30">
                        <span>{device.platform === "macos" ? "macOS" : "Windows"}</span><span>·</span><span>{device.campusName ?? "Organization-wide"}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.12em] ${state.className}`}>
                      {state.online ? <Wifi size={11} /> : <WifiOff size={11} />}{state.label}
                    </span>
                    <div className="mt-2 text-[11px] text-white/30">Last seen {timeLabel(device.lastSeenAt)}</div>
                  </div>

                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between gap-4"><span className="text-white/30">Agent</span><span className="font-semibold text-white/60">{device.softwareVersion ?? "Not enrolled"}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-white/30">Credential</span><span className="font-semibold capitalize text-white/60">{device.credentialState ?? "none"}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-white/30">Service</span><span className="max-w-[180px] truncate font-semibold text-white/60">{device.activeServiceTitle ?? "Unassigned"}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-white/30">Expires</span><span className="font-semibold text-white/60">{timeLabel(device.credentialExpiresAt)}</span></div>
                    {device.pairingExpiresAt ? <div className="text-[10px] text-amber-200/70">Pairing code pending until {timeLabel(device.pairingExpiresAt)}</div> : null}
                  </div>

                  {canManage && device.status !== "revoked" ? (
                    <div className="flex gap-2 lg:justify-end">
                      <button onClick={() => openRepair(device)} className="flex items-center gap-1.5 rounded-lg border border-white/[.08] bg-white/[.03] px-3 py-2 text-xs font-semibold text-white/50 hover:bg-white/[.06] hover:text-white/80">
                        <RefreshCw size={13} /> Re-pair
                      </button>
                      <button onClick={() => setRevokeTarget(device)} className="flex items-center gap-1.5 rounded-lg border border-red-400/15 bg-red-400/[.05] px-3 py-2 text-xs font-semibold text-red-200/70 hover:bg-red-400/10 hover:text-red-100">
                        <ShieldX size={13} /> Revoke
                      </button>
                    </div>
                  ) : null}

                  <div className="rounded-xl border border-white/[.06] bg-black/15 p-3 lg:col-span-4">
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px]">
                      <span className="font-bold uppercase tracking-[.12em] text-white/28">Diagnostics</span>
                      <span className="text-white/38">CPU <b className="ml-1 text-white/65">{metric(device.lastHealth?.cpuPercent)}</b></span>
                      <span className="text-white/38">Memory <b className="ml-1 text-white/65">{metric(device.lastHealth?.memoryPercent)}</b></span>
                      <span className="text-white/38">Uplink <b className="ml-1 text-white/65">{metric(device.lastHealth?.uplinkMbps, " Mbps")}</b></span>
                      <span className="text-white/38">Capabilities <b className="ml-1 text-white/65">{Object.keys(device.capabilities).length}</b></span>
                      {device.lastHealth?.observedAt ? <span className="text-white/28">sampled {timeLabel(device.lastHealth.observedAt)}</span> : null}
                    </div>
                    {device.recentCommand ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-white/[.05] pt-2 text-[11px]">
                        <span className="text-white/30">Last command</span>
                        <code className="font-semibold text-white/65">{device.recentCommand.type}</code>
                        <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[.1em] ${commandStateClass(device.recentCommand.state)}`}>{device.recentCommand.state}</span>
                        {device.recentCommand.resultingState ? <span className="text-white/38">{device.recentCommand.resultingState}</span> : null}
                        {device.recentCommand.errorCode ? <span className="text-red-200/65">{device.recentCommand.errorCode}</span> : null}
                        <span className="ml-auto text-white/25">{timeLabel(device.recentCommand.completedAt ?? device.recentCommand.issuedAt)}</span>
                      </div>
                    ) : (
                      <div className="mt-2 border-t border-white/[.05] pt-2 text-[11px] text-white/25">No control commands have been issued to this device.</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-6 py-16 text-center">
            <MonitorUp className="mx-auto text-white/20" />
            <div className="mt-4 text-sm font-bold text-white/65">No Edge devices yet</div>
            <div className="mt-2 text-xs leading-5 text-white/30">Pair the presentation computer in the church auditorium to start audio, camera and local-output integration.</div>
          </div>
        )}
      </section>

      {error && !formOpen && !revokeTarget ? <div className="rounded-xl border border-red-400/15 bg-red-400/[.06] px-4 py-3 text-sm text-red-200">{error}</div> : null}

      {formOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-[22px] border border-white/[.09] bg-[#0c1119] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[.07] px-5 py-4">
              <div><div className="text-sm font-black">Pair Church Edge</div><div className="mt-1 text-[11px] text-white/35">One-time code · 15 minute validity</div></div>
              <button onClick={() => setFormOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[.04] text-white/45 hover:text-white"><X size={15} /></button>
            </div>

            <div className="space-y-4 p-5">
              {!pairing ? (
                <>
                  <div>
                    <label className="mb-2 block text-xs font-semibold text-white/45">Computer name</label>
                    <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Main Auditorium PC" className="h-11 w-full rounded-xl border border-white/[.08] bg-white/[.035] px-3 text-sm outline-none focus:border-[#d7a94a]/40" />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><label className="mb-2 block text-xs font-semibold text-white/45">Platform</label><select value={platform} onChange={(event) => setPlatform(event.target.value as "windows" | "macos")} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#111722] px-3 text-sm outline-none"><option value="windows">Windows</option><option value="macos">macOS</option></select></div>
                    <div><label className="mb-2 block text-xs font-semibold text-white/45">Campus</label><select value={campusId} onChange={(event) => setCampusId(event.target.value)} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#111722] px-3 text-sm outline-none"><option value="">Organization-wide</option>{campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}</select></div>
                  </div>
                  {error ? <div className="rounded-xl border border-red-400/15 bg-red-400/[.06] px-3 py-2.5 text-xs text-red-200">{error}</div> : null}
                  <button disabled={busy || name.trim().length < 2} onClick={generatePairing} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#d7a94a] text-sm font-black text-[#171109] disabled:opacity-40"><MonitorUp size={15} />{busy ? "Generating…" : "Generate pairing code"}</button>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-[#d7a94a]/20 bg-[#d7a94a]/[.07] p-5 text-center">
                    <div className="text-[10px] font-bold uppercase tracking-[.2em] text-[#d7a94a]">One-time pairing code</div>
                    <div className="mt-3 font-mono text-3xl font-black tracking-[.13em] text-[#f3ce74]">{pairing.pairingCode}</div>
                    <div className="mt-3 text-xs text-white/35">Expires {timeLabel(pairing.expiresAt)}</div>
                    <button onClick={copyCode} className="mx-auto mt-4 flex items-center gap-2 rounded-lg border border-white/[.08] bg-white/[.04] px-3 py-2 text-xs font-bold text-white/60 hover:text-white">{copied ? <Check size={13} /> : <Clipboard size={13} />}{copied ? "Copied" : "Copy code"}</button>
                  </div>
                  <div className="rounded-xl border border-white/[.06] bg-black/20 p-4 text-xs leading-6 text-white/45">
                    Open iPresenterPlux Edge on <b className="text-white/70">{name}</b>, enter this code, and keep the Control URL set to this iPresenterPlux server. The long-lived credential returned after pairing is stored only in the computer&apos;s OS credential vault.
                  </div>
                  <button onClick={() => setFormOpen(false)} className="h-11 w-full rounded-xl border border-white/[.08] bg-white/[.04] text-sm font-bold text-white/65 hover:bg-white/[.07]">Done</button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {revokeTarget ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[22px] border border-red-400/15 bg-[#0c1119] p-5 shadow-2xl">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-400/10 text-red-300"><ShieldX size={19} /></div>
            <h2 className="mt-4 text-lg font-black">Revoke {revokeTarget.name}?</h2>
            <p className="mt-2 text-sm leading-6 text-white/40">This immediately invalidates its active and grace credentials and cancels pending pairing codes. Re-enabling a hard-revoked device requires an administrator workflow.</p>
            {error ? <div className="mt-3 rounded-xl border border-red-400/15 bg-red-400/[.06] px-3 py-2 text-xs text-red-200">{error}</div> : null}
            <div className="mt-5 flex gap-2">
              <button onClick={() => { setRevokeTarget(null); setError(null); }} className="h-10 flex-1 rounded-xl border border-white/[.08] bg-white/[.03] text-xs font-bold text-white/55">Cancel</button>
              <button disabled={busy} onClick={revokeDevice} className="h-10 flex-1 rounded-xl bg-red-500/90 text-xs font-black text-white disabled:opacity-50">{busy ? "Revoking…" : "Revoke device"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
