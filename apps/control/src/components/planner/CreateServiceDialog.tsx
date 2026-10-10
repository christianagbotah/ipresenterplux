"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Loader2, Plus, X } from "lucide-react";

type CampusOption = { id: string; name: string };
type BibleVersionOption = { id: string; name: string; abbreviation: string };

type Props = {
  organizationId: string;
  campuses: CampusOption[];
  bibleVersions: BibleVersionOption[];
  canPlanServices: boolean;
};

const serviceTypes = [
  ["sunday_service", "Sunday service"],
  ["midweek_service", "Midweek service"],
  ["prayer_meeting", "Prayer meeting"],
  ["conference", "Conference / convention"],
  ["special_event", "Special event"]
] as const;

export function CreateServiceDialog({ organizationId, campuses, bibleVersions, canPlanServices }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [serviceType, setServiceType] = useState("sunday_service");
  const [campusId, setCampusId] = useState(campuses[0]?.id ?? "");
  const [scheduledStart, setScheduledStart] = useState("");
  const [activeBibleVersion, setActiveBibleVersion] = useState(bibleVersions[0]?.id ?? "");

  const canSubmit = useMemo(
    () => canPlanServices && title.trim().length > 0 && activeBibleVersion.length > 0 && !saving,
    [activeBibleVersion, canPlanServices, saving, title]
  );

  if (!canPlanServices) return null;

  async function createService(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/planner/services", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId,
          title: title.trim(),
          serviceType,
          campusId: campusId || null,
          scheduledStart: scheduledStart ? new Date(scheduledStart).toISOString() : null,
          activeBibleVersion
        })
      });
      const payload = await response.json().catch(() => null) as { service?: { id?: string }; error?: string } | null;
      if (!response.ok) {
        const expectedClientFailure = [400, 403, 409].includes(response.status);
        setError(expectedClientFailure ? (payload?.error ?? "The service could not be created.") : "The service planner is temporarily unavailable.");
        return;
      }
      const serviceId = payload?.service?.id;
      if (!serviceId) {
        setError("The service was created but no service id was returned. Refresh the planner before continuing.");
        return;
      }
      setOpen(false);
      router.push(`/planner/${serviceId}`);
      router.refresh();
    } catch {
      setError("Could not reach the planner service. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setError(null); setOpen(true); }}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#d7a94a] px-4 py-2.5 text-sm font-extrabold text-[#15110a] shadow-[0_12px_36px_rgba(215,169,74,.16)] transition hover:bg-[#e4b85c] ip-focus-gold"
      >
        <Plus size={17} />
        New service
      </button>

      {open ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="create-service-title">
        <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border border-white/[.09] bg-[#0c1017] shadow-2xl sm:max-w-2xl sm:rounded-3xl ip-scrollbar-thin">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/[.07] bg-[#0c1017]/95 px-5 py-5 backdrop-blur-xl sm:px-6">
              <div>
                <div className="flex items-center gap-2 text-[#f2c765]"><CalendarPlus size={18} /><span className="text-[11px] font-bold uppercase tracking-[.18em]">Service Planner</span></div>
                <h2 id="create-service-title" className="mt-2 text-xl font-black tracking-tight">Create a service plan</h2>
                <p className="mt-1 text-sm text-white/55">Start in Draft. Add the rundown, validate readiness, then assign it to an Edge device.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-white/[.08] p-2.5 text-white/55 transition hover:bg-white/[.05] hover:text-white ip-focus-gold" aria-label="Close create service dialog"><X size={17} /></button>
            </div>

            <form onSubmit={createService} className="space-y-5 p-5 sm:p-6">
              <label className="block">
                <span className="mb-2 block text-[11px] font-bold uppercase tracking-[.12em] text-white/50">Service title</span>
                <input
                  name="title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={160}
                  autoFocus
                  placeholder="Sunday Worship Service"
                  className="min-h-12 w-full rounded-xl border border-white/[.09] bg-black/25 px-4 text-sm text-white outline-none transition placeholder:text-white/40 ip-focus-gold"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-[11px] font-bold uppercase tracking-[.12em] text-white/50">Service type</span>
                  <select name="serviceType" value={serviceType} onChange={(event) => setServiceType(event.target.value)} className="min-h-12 w-full rounded-xl border border-white/[.09] bg-[#0a0d12] px-4 text-sm text-white outline-none transition ip-focus-gold">
                    {serviceTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-[11px] font-bold uppercase tracking-[.12em] text-white/50">Campus</span>
                  <select name="campusId" value={campusId} onChange={(event) => setCampusId(event.target.value)} className="min-h-12 w-full rounded-xl border border-white/[.09] bg-[#0a0d12] px-4 text-sm text-white outline-none transition ip-focus-gold">
                    <option value="">All campuses</option>
                    {campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}
                  </select>
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-[11px] font-bold uppercase tracking-[.12em] text-white/50">Scheduled start</span>
                  <input name="scheduledStart" type="datetime-local" value={scheduledStart} onChange={(event) => setScheduledStart(event.target.value)} className="min-h-12 w-full rounded-xl border border-white/[.09] bg-black/25 px-4 text-sm text-white outline-none transition ip-focus-gold" />
                </label>

                <label className="block">
                  <span className="mb-2 block text-[11px] font-bold uppercase tracking-[.12em] text-white/50">Bible version</span>
                  <select name="activeBibleVersion" value={activeBibleVersion} onChange={(event) => setActiveBibleVersion(event.target.value)} className="min-h-12 w-full rounded-xl border border-white/[.09] bg-[#0a0d12] px-4 text-sm text-white outline-none transition ip-focus-gold">
                    {bibleVersions.map((version) => <option key={version.id} value={version.id}>{version.abbreviation} · {version.name}</option>)}
                  </select>
                </label>
              </div>

              {error ? <div className="ip-attention-enter rounded-xl border border-red-400/20 bg-red-400/[.07] px-4 py-3 text-sm leading-5 text-red-100">{error}</div> : null}

              <div className="flex flex-col-reverse gap-2 border-t border-white/[.07] pt-5 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-xl border border-white/[.09] px-4 text-sm font-semibold text-white/65 transition hover:bg-white/[.04] hover:text-white ip-focus-gold">Cancel</button>
                <button disabled={!canSubmit} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#d7a94a] px-5 text-sm font-extrabold text-[#15110a] transition enabled:hover:bg-[#e4b85c] ip-focus-gold disabled:cursor-not-allowed disabled:opacity-40">
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <CalendarPlus size={16} />}
                  {saving ? "Creating…" : "Create service plan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
