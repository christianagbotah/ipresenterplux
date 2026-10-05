"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mic2, UserRoundCheck } from "lucide-react";

type SpeakerProfile = {
  id: string;
  name: string;
  speakerId: string;
  active: boolean;
};

type Props = {
  serviceId: string;
  serviceStatus: string;
  profiles: SpeakerProfile[];
};

export function ActiveSpeakerControl({ serviceId, serviceStatus, profiles }: Props) {
  const router = useRouter();
  const initial = profiles.find((profile) => profile.active)?.id ?? "";
  const [selected, setSelected] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = serviceStatus === "ready" || serviceStatus === "live";

  async function updateSpeaker(value: string) {
    const previous = selected;
    setSelected(value);
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/services/${serviceId}/speaker`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voiceProfileId: value || null })
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Active speaker could not be updated");
      router.refresh();
    } catch (cause) {
      setSelected(previous);
      setError(cause instanceof Error ? cause.message : "Active speaker could not be updated");
    } finally {
      setSaving(false);
    }
  }

  const active = profiles.find((profile) => profile.id === selected);

  return (
    <div className="rounded-xl border border-white/[.06] bg-white/[.025] px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#d7a94a]/10 text-[#e7bd65]">
            <Mic2 size={15} />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold">Active speaker fallback</div>
            <div className="mt-0.5 text-[10px] text-white/30">
              Used only when ASR/diarization does not identify a speaker.
            </div>
          </div>
        </div>
        <div className="flex min-w-[220px] flex-1 items-center justify-end gap-2 sm:flex-none">
          <select
            value={selected}
            disabled={!enabled || saving}
            onChange={(event) => void updateSpeaker(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-white/[.08] bg-[#080b10] px-3 py-2 text-xs text-white/70 outline-none disabled:cursor-not-allowed disabled:opacity-40 sm:w-64"
            aria-label="Active speaker fallback"
          >
            <option value="">No manual speaker</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name} · {profile.speakerId}</option>
            ))}
          </select>
          {active ? <UserRoundCheck size={15} className="shrink-0 text-emerald-300" /> : null}
        </div>
      </div>
      {error ? <div className="mt-2 text-[10px] text-red-200">{error}</div> : null}
      {!profiles.length ? (
        <div className="mt-2 text-[10px] text-amber-100/45">
          No consented speaker profiles with speaker IDs are available. Add one in Settings → Voice Consent.
        </div>
      ) : null}
    </div>
  );
}
