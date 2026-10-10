"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { Check, Copy, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

const subscribeToOrigin = () => () => {};

export function AudienceAccessCard({ serviceId }: { serviceId: string }) {
  const origin = useSyncExternalStore(
    subscribeToOrigin,
    () => window.location.origin,
    () => ""
  );
  const [copied, setCopied] = useState(false);

  const path = `/live?service=${encodeURIComponent(serviceId)}`;
  const audienceUrl = useMemo(() => (origin ? origin + path : path), [origin, path]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(audienceUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="ip-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/[.07] px-4 py-4">
        <div>
          <div className="text-sm font-bold">Audience Join</div>
          <div className="text-[11px] text-white/55">Scan once to open this service on iPhone, iPad, Android or web.</div>
        </div>
        <QrCode size={17} className="text-[#e5b85c]" />
      </div>

      <div className="grid items-center gap-5 p-4 md:grid-cols-[170px_1fr]">
        <div className="mx-auto rounded-2xl bg-white p-3 shadow-[0_16px_40px_rgba(0,0,0,.25)]">
          <QRCodeSVG
            value={audienceUrl}
            size={146}
            level="M"
            bgColor="#ffffff"
            fgColor="#080b10"
            marginSize={0}
            title="iPresenterPlux audience join QR code"
          />
        </div>

        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[.14em] text-white/55">Service link</div>
          <div className="mt-2 break-all rounded-xl border border-white/[.06] bg-black/20 px-3 py-3 text-xs leading-5 text-white/75">
            {audienceUrl}
          </div>
          <button
            type="button"
            onClick={copyLink}
            className="ip-focus-gold min-h-10 mt-3 flex items-center gap-2 rounded-xl border border-[#d7a94a]/25 bg-[#d7a94a]/10 px-3 text-xs font-bold text-[#edc568] transition hover:bg-[#d7a94a]/15"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy audience link"}
          </button>
          <p className="mt-3 text-[11px] leading-5 text-white/55">
            The link exposes only the public live-service experience. Control Room and operator APIs remain authenticated separately.
          </p>
        </div>
      </div>
    </section>
  );
}
