import { CalendarClock, CheckCircle2, KeyRound, Laptop, ShieldAlert } from "lucide-react";

type Activation = {
  id: string;
  installationId: string;
  deviceName: string;
  platform: string;
  appVersion: string;
  state: string;
  activatedAt: string;
  lastValidatedAt: string;
};

type SubscriptionOverview = {
  organizationName: string;
  subscription: null | {
    id: string;
    status: string;
    startsAt: string;
    renewsAt: string | null;
    expiresAt: string | null;
    graceUntil: string | null;
    plan: { code: string; name: string; features: Record<string, boolean>; numericLimits: Record<string, number> };
  };
  seats: { limit: number; used: number };
  activations: Activation[];
};

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Accra" }).format(new Date(value));
}

export function SubscriptionStatus({
  overview,
  canManage,
  deactivateAction
}: {
  overview: SubscriptionOverview;
  canManage: boolean;
  deactivateAction?: (formData: FormData) => Promise<void>;
}) {
  const subscription = overview.subscription;
  if (!subscription) {
    return (
      <section className="rounded-[24px] border border-amber-300/20 bg-amber-300/[.05] p-6">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 text-amber-300" size={20} />
          <div>
            <h2 className="font-black">No commercial subscription assigned</h2>
            <p className="mt-2 text-sm leading-6 text-white/60">Contact Lightworld Technologies to assign a plan before activating additional desktop installations.</p>
          </div>
        </div>
      </section>
    );
  }

  const availableSeats = Math.max(0, overview.seats.limit - overview.seats.used);
  return (
    <div className="space-y-5">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[20px] border border-white/[.08] bg-[#0d121a] p-5">
          <div className="text-[11px] font-bold uppercase tracking-[.16em] text-white/55">Plan</div>
          <div className="mt-2 text-lg font-black">{subscription.plan.name}</div>
          <div className="mt-1 text-xs text-white/55">{subscription.plan.code}</div>
        </div>
        <div className="rounded-[20px] border border-white/[.08] bg-[#0d121a] p-5">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.16em] text-white/55"><CheckCircle2 size={13} /> Status</div>
          <div className="mt-2 text-lg font-black capitalize">{subscription.status.replaceAll("_", " ")}</div>
        </div>
        <div className="rounded-[20px] border border-white/[.08] bg-[#0d121a] p-5">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.16em] text-white/55"><Laptop size={13} /> Device seats</div>
          <div className="mt-2 text-lg font-black">{overview.seats.used} / {overview.seats.limit}</div>
          <div className="mt-1 text-xs text-white/55">{availableSeats} seat{availableSeats === 1 ? "" : "s"} available</div>
        </div>
        <div className="rounded-[20px] border border-white/[.08] bg-[#0d121a] p-5">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.16em] text-white/55"><CalendarClock size={13} /> Expiry</div>
          <div className="mt-2 text-sm font-bold">{formatDate(subscription.expiresAt)}</div>
          <div className="mt-1 text-xs text-white/55">Grace: {formatDate(subscription.graceUntil)}</div>
        </div>
      </section>

      <section className="rounded-[24px] border border-white/[.08] bg-[#0d121a] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.16em] text-[#d7a94a]"><KeyRound size={13} /> Activated installations</div>
            <h2 className="mt-1 text-lg font-black">Church desktop seats</h2>
          </div>
          <div className="text-xs text-white/55">Last renewal target: {formatDate(subscription.renewsAt)}</div>
        </div>
        <div className="mt-5 divide-y divide-white/[.06] overflow-hidden rounded-2xl border border-white/[.06]">
          {overview.activations.length ? overview.activations.map((activation) => (
            <div key={activation.id} className="ip-ai-arrive flex flex-wrap items-center justify-between gap-4 bg-white/[.02] px-4 py-4">
              <div className="min-w-0">
                <div className="font-bold">{activation.deviceName}</div>
                <div className="mt-1 text-xs text-white/55">{activation.platform} · v{activation.appVersion} · {activation.state}</div>
                <div className="mt-1 text-[11px] text-white/50">Last validated {formatDate(activation.lastValidatedAt)}</div>
              </div>
              {canManage && activation.state === "active" && deactivateAction ? (
                <form action={deactivateAction}>
                  <input type="hidden" name="activationId" value={activation.id} />
                  <button type="submit" className="ip-focus-gold min-h-9 cursor-pointer rounded-xl border border-rose-300/20 bg-rose-300/[.06] px-3 py-2 text-xs font-bold text-rose-200 transition hover:bg-rose-300/[.1]">
                    Deactivate device
                  </button>
                </form>
              ) : null}
            </div>
          )) : (
            <div className="px-4 py-8 text-center text-sm text-white/55">No desktop activation has consumed a seat yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}
