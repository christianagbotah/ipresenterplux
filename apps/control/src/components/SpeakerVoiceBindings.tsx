"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AudioWaveform, ShieldCheck } from "lucide-react";

type DetectedSpeaker = {
  speakerId: string;
  lastSeenAt: string;
  voiceProfileId: string | null;
  voiceName: string | null;
};

type VoiceProfile = {
  id: string;
  name: string;
  provider: string;
};

type Props = {
  serviceId: string;
  serviceStatus: string;
  speakers: DetectedSpeaker[];
  profiles: VoiceProfile[];
};

export function SpeakerVoiceBindings({ serviceId, serviceStatus, speakers, profiles }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Record<string, string>>(
    Object.fromEntries(speakers.map((speaker) => [speaker.speakerId, speaker.voiceProfileId ?? ""]))
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const enabled = serviceStatus === "ready" || serviceStatus === "live";

  async function updateBinding(speakerId: string, voiceProfileId: string) {
    const previous = selected[speakerId] ?? "";
    setSelected((current) => ({ ...current, [speakerId]: voiceProfileId }));
    setBusy(speakerId);
    setError(null);
    try {
      const response = await fetch(`/api/v1/services/${serviceId}/speaker-bindings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ speakerId, voiceProfileId: voiceProfileId || null })
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Speaker voice binding could not be updated");
      router.refresh();
    } catch (cause) {
      setSelected((current) => ({ ...current, [speakerId]: previous }));
      setError(cause instanceof Error ? cause.message : "Speaker voice binding could not be updated");
    } finally {
      setBusy(null);
    }
  }

  if (!speakers.length) {
    return (
      <div className="rounded-xl border border-white/[.06] bg-white/[.025] px-3 py-3">
        <div className="flex items-center gap-2 text-xs font-bold text-white/85"><AudioWaveform size={15} className="text-[#d7a94a]" /> Detected speaker voices</div>
        <div className="mt-1 text-[11px] leading-4 text-white/50">No diarized speaker label has been observed in this service yet. Bindings appear only after ASR returns a service-scoped speaker ID.</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/[.06] bg-white/[.025] px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#d7a94a]/10 text-[#e7bd65]"><AudioWaveform size={15} /></div>
          <div>
            <div className="text-xs font-bold text-white/85">Detected speaker voice bindings</div>
            <div className="mt-0.5 text-[11px] text-white/50">Anonymous labels are valid only for this service. Unbound speakers always use the generic voice.</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-emerald-200/80"><ShieldCheck size={12} /> consented provider voices only</div>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {speakers.map((speaker) => {
          const value = selected[speaker.speakerId] ?? "";
          return (
            <div key={speaker.speakerId} className="ip-ai-arrive rounded-lg border border-white/[.06] bg-black/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-white/80">{speaker.speakerId}</div>
                  <div className="mt-1 text-[11px] text-white/45">Last heard {new Date(speaker.lastSeenAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
                </div>
                <select
                  value={value}
                  disabled={!enabled || busy === speaker.speakerId}
                  onChange={(event) => void updateBinding(speaker.speakerId, event.target.value)}
                  className="min-w-[200px] rounded-lg border border-white/[.08] bg-[#080b10] px-3 py-2 text-xs text-white/75 outline-none transition ip-focus-gold disabled:opacity-45"
                  aria-label={`Synthetic voice for ${speaker.speakerId}`}
                >
                  <option value="">Generic voice</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>{profile.name} · {profile.provider}</option>
                  ))}
                </select>
              </div>
              {speaker.voiceName && value ? <div className="mt-2 text-[11px] text-emerald-200/75">Bound in this service to {speaker.voiceName}</div> : null}
            </div>
          );
        })}
      </div>
      {error ? <div className="mt-2 text-[11px] text-red-200">{error}</div> : null}
      {!profiles.length ? <div className="mt-2 text-[11px] text-amber-100/70">No consented provider voice is available. Configure one under Settings → Voice Consent.</div> : null}
    </div>
  );
}
