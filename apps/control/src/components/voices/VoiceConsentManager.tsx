"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, CheckCircle2, FileCheck2, Mic2, Plus, ShieldAlert } from "lucide-react";

type VoiceProfile = {
  id: string;
  displayName: string;
  sourceSpeakerId: string | null;
  consentStatus: "pending" | "consented" | "revoked";
  consentMethod: "written" | "recorded_verbal" | "self_service" | null;
  consentReference: string | null;
  consentedAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  provider: string | null;
  providerVoiceId: string | null;
  createdAt: string;
};

type Props = {
  organizationId: string;
  organizationName: string;
  profiles: VoiceProfile[];
};

type BusyState = { id: string; action: string } | null;

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : date.toLocaleString();
}

function statusMeta(status: VoiceProfile["consentStatus"]) {
  if (status === "consented") return { label: "Consented", tone: "text-emerald-300 border-emerald-300/20 bg-emerald-300/[.08]" };
  if (status === "revoked") return { label: "Revoked", tone: "text-red-200 border-red-300/20 bg-red-300/[.07]" };
  return { label: "Pending", tone: "text-amber-200 border-amber-300/20 bg-amber-300/[.07]" };
}

export function VoiceConsentManager({ organizationId, organizationName, profiles }: Props) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [sourceSpeakerId, setSourceSpeakerId] = useState("");
  const [consentMethod, setConsentMethod] = useState<Record<string, "written" | "recorded_verbal">>({});
  const [consentReference, setConsentReference] = useState<Record<string, string>>({});
  const [revokeReason, setRevokeReason] = useState<Record<string, string>>({});
  const [providerVoiceId, setProviderVoiceId] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<BusyState>(null);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => ({
    pending: profiles.filter((item) => item.consentStatus === "pending").length,
    consented: profiles.filter((item) => item.consentStatus === "consented").length,
    revoked: profiles.filter((item) => item.consentStatus === "revoked").length
  }), [profiles]);

  async function createProfile(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy({ id: "new", action: "create" });
    try {
      const response = await fetch("/api/v1/voices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          displayName,
          sourceSpeakerId: sourceSpeakerId.trim() || null
        })
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error || "Voice profile could not be created");
      setDisplayName("");
      setSourceSpeakerId("");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Voice profile could not be created");
    } finally {
      setBusy(null);
    }
  }

  async function recordConsent(profile: VoiceProfile) {
    const reference = consentReference[profile.id]?.trim() ?? "";
    if (reference.length < 3) {
      setError("Enter a consent reference before recording consent.");
      return;
    }
    setError(null);
    setBusy({ id: profile.id, action: "consent" });
    try {
      const response = await fetch(`/api/v1/voices/${profile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "record_consent",
          organizationId,
          method: consentMethod[profile.id] ?? "written",
          reference
        })
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error || "Consent could not be recorded");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Consent could not be recorded");
    } finally {
      setBusy(null);
    }
  }

  async function bindProviderVoice(profile: VoiceProfile) {
    const voiceId = providerVoiceId[profile.id]?.trim() ?? "";
    if (voiceId.length < 3) {
      setError("Enter the provider voice ID that was enrolled outside iPresenterPlux.");
      return;
    }
    setError(null);
    setBusy({ id: profile.id, action: "bind" });
    try {
      const response = await fetch(`/api/v1/voices/${profile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bind_provider",
          organizationId,
          provider: "google",
          providerVoiceId: voiceId
        })
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error || "Provider voice could not be bound");
      setProviderVoiceId((current) => ({ ...current, [profile.id]: "" }));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Provider voice could not be bound");
    } finally {
      setBusy(null);
    }
  }

  async function unbindProviderVoice(profile: VoiceProfile) {
    setError(null);
    setBusy({ id: profile.id, action: "unbind" });
    try {
      const response = await fetch(`/api/v1/voices/${profile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unbind_provider", organizationId })
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error || "Provider voice could not be unbound");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Provider voice could not be unbound");
    } finally {
      setBusy(null);
    }
  }

  async function revokeConsent(profile: VoiceProfile) {
    const reason = revokeReason[profile.id]?.trim() ?? "";
    if (reason.length < 3) {
      setError("Enter a revocation reason before revoking consent.");
      return;
    }
    setError(null);
    setBusy({ id: profile.id, action: "revoke" });
    try {
      const response = await fetch(`/api/v1/voices/${profile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", organizationId, reason })
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error || "Consent could not be revoked");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Consent could not be revoked");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-3">
        {[
          ["Pending", counts.pending],
          ["Consented", counts.consented],
          ["Revoked", counts.revoked]
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border border-white/[.07] bg-white/[.025] p-4">
            <div className="text-[11px] font-bold uppercase tracking-[.14em] text-white/50">{label}</div>
            <div className="mt-2 text-2xl font-black">{value}</div>
          </div>
        ))}
      </section>

      <section className="rounded-[22px] border border-[#d7a94a]/16 bg-[#d7a94a]/[.045] p-5">
        <div className="flex gap-3">
          <ShieldAlert className="mt-0.5 shrink-0 text-[#efc76e]" size={18} />
          <div>
            <h2 className="text-sm font-black">Explicit consent is mandatory</h2>
            <p className="mt-1 max-w-4xl text-xs leading-5 text-white/60">
              Only record consent after the speaker has explicitly agreed to synthetic or personalized voice use. Revocation is immediate and makes previously generated personalized audio unavailable to audience playback.
            </p>
          </div>
        </div>
      </section>

      <form onSubmit={createProfile} className="rounded-[22px] border border-white/[.08] bg-[#0d121a] p-5">
        <div className="flex items-center gap-2">
          <Plus size={16} className="text-[#d7a94a]" />
          <h2 className="text-sm font-black">Create pending speaker profile</h2>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-[.12em] text-white/50">Speaker name</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required minLength={2} maxLength={120} className="mt-2 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 py-2.5 text-sm outline-none transition ip-focus-gold" placeholder="Pastor / interpreter name" />
          </label>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-[.12em] text-white/50">Manual fallback tag · optional</span>
            <input value={sourceSpeakerId} onChange={(event) => setSourceSpeakerId(event.target.value)} maxLength={120} className="mt-2 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 py-2.5 text-sm outline-none transition ip-focus-gold" placeholder="Stable operator tag, e.g. pastor-main" />
          </label>
          <button disabled={busy?.id === "new"} className="rounded-xl bg-[#d7a94a] px-4 py-2.5 text-xs font-black text-black transition hover:brightness-110 ip-focus-gold disabled:opacity-45">
            {busy?.id === "new" ? "Creating…" : "Create pending profile"}
          </button>
        </div>
      </form>

      {error ? <div className="rounded-xl border border-red-300/15 bg-red-300/[.06] px-4 py-3 text-xs text-red-100">{error}</div> : null}

      <section className="overflow-hidden rounded-[22px] border border-white/[.08] bg-[#0d121a]">
        <div className="border-b border-white/[.06] px-5 py-4">
          <h2 className="text-sm font-black text-white/90">{organizationName} · voice profiles</h2>
          <p className="mt-1 text-xs text-white/50">Provider enrollment stays separate from consent. Consent alone does not create or activate a cloned voice.</p>
        </div>
        <div className="ip-scrollbar-thin divide-y divide-white/[.06]">
          {profiles.length === 0 ? (
            <div className="p-8 text-center text-sm text-white/50">No voice profiles have been created.</div>
          ) : profiles.map((profile) => {
            const meta = statusMeta(profile.consentStatus);
            const waiting = busy?.id === profile.id;
            return (
              <article key={profile.id} className="ip-ai-arrive p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Mic2 size={15} className="text-[#d7a94a]" />
                      <h3 className="text-sm font-black text-white/90">{profile.displayName}</h3>
                      <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-[.12em] ${meta.tone}`}>{meta.label}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/45">
                      <span>Created {formatDate(profile.createdAt)}</span>
                      {profile.sourceSpeakerId ? <span>Speaker ID {profile.sourceSpeakerId}</span> : null}
                      {profile.provider ? <span>Provider {profile.provider}</span> : null}
                    </div>
                  </div>
                </div>

                {profile.consentStatus === "pending" ? (
                  <div className="mt-4 grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_auto] lg:items-end">
                    <label>
                      <span className="text-[11px] uppercase tracking-[.12em] text-white/50">Consent method</span>
                      <select value={consentMethod[profile.id] ?? "written"} onChange={(event) => setConsentMethod((current) => ({ ...current, [profile.id]: event.target.value as "written" | "recorded_verbal" }))} className="mt-2 w-full rounded-xl border border-white/[.08] bg-[#080b10] px-3 py-2.5 text-sm outline-none transition ip-focus-gold">
                        <option value="written">Written consent</option>
                        <option value="recorded_verbal">Recorded verbal consent</option>
                      </select>
                    </label>
                    <label>
                      <span className="text-[11px] uppercase tracking-[.12em] text-white/50">Consent reference</span>
                      <input value={consentReference[profile.id] ?? ""} onChange={(event) => setConsentReference((current) => ({ ...current, [profile.id]: event.target.value }))} maxLength={240} className="mt-2 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 py-2.5 text-sm outline-none transition placeholder:text-white/40 ip-focus-gold" placeholder="Signed form ID / recording reference" />
                    </label>
                    <button type="button" disabled={waiting} onClick={() => void recordConsent(profile)} className="flex items-center justify-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-300/[.08] px-4 py-2.5 text-xs font-bold text-emerald-200 transition hover:bg-emerald-300/[.13] ip-focus-gold disabled:opacity-45"><FileCheck2 size={14} /> Record consent</button>
                  </div>
                ) : null}

                {profile.consentStatus === "consented" ? (
                  <div className="mt-4 grid gap-4 xl:grid-cols-3">
                    <div className="rounded-xl border border-emerald-300/12 bg-emerald-300/[.04] p-4 text-xs leading-5 text-white/65">
                      <div className="flex items-center gap-2 font-bold text-emerald-200"><CheckCircle2 size={14} /> Consent active</div>
                      <div className="mt-2">Method: {profile.consentMethod?.replaceAll("_", " ")}</div>
                      <div>Reference: {profile.consentReference}</div>
                      <div>Recorded: {formatDate(profile.consentedAt)}</div>
                      <div className="mt-2 text-white/45">Manual fallback tag: {profile.sourceSpeakerId ?? "not configured"}</div>
                    </div>
                    <div className="rounded-xl border border-[#d7a94a]/14 bg-[#d7a94a]/[.035] p-4">
                      <div className="text-xs font-bold text-[#efc76e]">Personalized provider voice</div>
                      {profile.providerVoiceId ? (
                        <>
                          <div className="mt-2 break-all text-[11px] leading-5 text-white/65">{profile.provider ?? "provider"} · {profile.providerVoiceId}</div>
                          <button type="button" disabled={waiting} onClick={() => void unbindProviderVoice(profile)} className="mt-3 rounded-lg border border-white/[.08] bg-white/[.035] px-3 py-2 text-[11px] font-bold text-white/70 transition hover:bg-white/[.06] ip-focus-gold disabled:opacity-45">Unbind voice</button>
                        </>
                      ) : (
                        <>
                          <div className="mt-2 text-[11px] leading-5 text-white/55">Bind only a voice ID already enrolled with Google under this person&apos;s explicit consent. Detected ASR speaker labels are assigned separately per live service in the Control Room.</div>
                          <div className="mt-3 flex gap-2">
                            <input value={providerVoiceId[profile.id] ?? ""} onChange={(event) => setProviderVoiceId((current) => ({ ...current, [profile.id]: event.target.value }))} maxLength={128} className="min-w-0 flex-1 rounded-xl border border-white/[.08] bg-black/20 px-3 py-2.5 text-sm outline-none transition placeholder:text-white/40 ip-focus-gold" placeholder="Google provider voice ID" />
                            <button type="button" disabled={waiting} onClick={() => void bindProviderVoice(profile)} className="rounded-xl border border-[#d7a94a]/20 bg-[#d7a94a]/10 px-3 text-[11px] font-bold text-[#efc76e] transition hover:bg-[#d7a94a]/[.16] ip-focus-gold disabled:opacity-45">Bind</button>
                          </div>
                        </>
                      )}
                    </div>
                    <div className="rounded-xl border border-red-300/12 bg-red-300/[.035] p-4">
                      <div className="flex items-center gap-2 text-xs font-bold text-red-100"><Ban size={14} /> Revoke consent</div>
                      <div className="mt-3 flex gap-2">
                        <input value={revokeReason[profile.id] ?? ""} onChange={(event) => setRevokeReason((current) => ({ ...current, [profile.id]: event.target.value }))} maxLength={240} className="min-w-0 flex-1 rounded-xl border border-white/[.08] bg-black/20 px-3 py-2.5 text-sm outline-none transition placeholder:text-white/40 ip-focus-gold" placeholder="Reason for revocation" />
                        <button type="button" disabled={waiting} onClick={() => void revokeConsent(profile)} className="rounded-xl border border-red-300/20 bg-red-300/[.08] px-4 text-xs font-bold text-red-100 transition hover:bg-red-300/[.13] ip-focus-gold disabled:opacity-45">Revoke</button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {profile.consentStatus === "revoked" ? (
                  <div className="mt-4 rounded-xl border border-red-300/12 bg-red-300/[.035] p-4 text-xs leading-5 text-white/65">
                    <div className="font-bold text-red-100">Consent revoked · {formatDate(profile.revokedAt)}</div>
                    <div className="mt-1">Reason: {profile.revocationReason}</div>
                    <div className="mt-2 text-white/45">This profile is immutable. Create a new pending profile if the speaker later wishes to grant new consent.</div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
