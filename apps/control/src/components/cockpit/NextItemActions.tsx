"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Eye, Pin, PinOff, Sparkles, X } from "lucide-react";
import type { CockpitNextItem } from "@/lib/cockpit/contracts";

function hrefFor(item: CockpitNextItem, serviceId: string) {
  if (item.targetType === "scripture_detection") return "/scripture";
  if (item.targetType === "camera_source") return "/cameras";
  return `/planner/${serviceId}`;
}

export function NextItemActions({ item, organizationId, serviceId, canControl }: {
  item: CockpitNextItem;
  organizationId: string;
  serviceId: string;
  canControl: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  async function updatePin(pinned: boolean) {
    const response = await fetch("/api/v1/cockpit/pins", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, serviceId, targetType: item.targetType, targetId: item.targetId, title: item.title, payload: { source: item.source }, pinned })
    });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Could not update priority");
  }

  function run(operation: () => Promise<void>, success: string) {
    setMessage(null);
    startTransition(async () => {
      try { await operation(); setMessage(success); router.refresh(); }
      catch (error) { setMessage(error instanceof Error ? error.message : "Action failed"); }
    });
  }

  function preview() {
    if (item.targetType !== "scripture_detection") return;
    run(async () => {
      const response = await fetch(`/api/v1/scriptures/${item.targetId}/state`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: "preview" })
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Preview failed");
      if (item.source === "recommendation") {
        const rec = await fetch(`/api/v1/cockpit/recommendations/${item.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "prepared", previewResultType: "scripture_detection", previewResultId: item.targetId })
        });
        if (!rec.ok) throw new Error((await rec.json().catch(() => null))?.error ?? "Recommendation state could not be confirmed");
      }
    }, "Prepared in Preview");
  }

  function dismiss() {
    if (item.source !== "recommendation") return;
    run(async () => {
      const response = await fetch(`/api/v1/cockpit/recommendations/${item.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: "dismissed" })
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Dismiss failed");
    }, "Dismissed");
  }

  const button = "inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/[.08] px-2.5 text-[10px] font-bold text-white/48 transition hover:bg-white/[.05] hover:text-white/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e2b85f] disabled:cursor-not-allowed disabled:opacity-35";
  return <div className="mt-2 flex flex-wrap items-center gap-1.5">
    <Link href={hrefFor(item, serviceId)} className={button}>Open</Link>
    {canControl && item.actions.includes("preview") ? <button type="button" disabled={pending} onClick={preview} className={button}><Eye size={12}/>Preview</button> : null}
    {canControl && item.actions.includes("pin") ? <button type="button" disabled={pending} onClick={() => run(() => updatePin(item.source !== "pinned"), item.source === "pinned" ? "Unpinned" : "Pinned")} className={button}>{item.source === "pinned" ? <PinOff size={12}/> : <Pin size={12}/>} {item.source === "pinned" ? "Unpin" : "Pin"}</button> : null}
    {canControl && item.actions.includes("use_instead") && item.source !== "pinned" ? <button type="button" disabled={pending} onClick={() => run(() => updatePin(true), "Moved to the top of Next")} className={button}><Sparkles size={12}/>Use next</button> : null}
    {canControl && item.actions.includes("dismiss") ? <button type="button" disabled={pending} onClick={dismiss} className={button}><X size={12}/>Dismiss</button> : null}
    {message ? <span role="status" aria-live="polite" className="w-full pt-1 text-[10px] text-white/38">{message}</span> : null}
  </div>;
}
