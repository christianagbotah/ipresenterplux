"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Power } from "lucide-react";

export function OutputControls({
  id,
  enabled
}: {
  id: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  function toggle() {
    setError(false);
    startTransition(async () => {
      const response = await fetch("/api/v1/outputs/" + id + "/state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled })
      });

      if (!response.ok) {
        setError(true);
        return;
      }

      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending}
      title={error ? "Could not update this destination" : enabled ? "Disable destination" : "Enable destination"}
      aria-label={error ? "Could not update this destination" : enabled ? "Disable destination" : "Enable destination"}
      className={
        "flex h-9 w-9 items-center justify-center rounded-lg border transition ip-focus-gold disabled:cursor-wait disabled:opacity-40 " +
        (error
          ? "border-red-400/25 bg-red-400/10 text-red-300"
          : enabled
            ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
            : "border-white/[.08] bg-white/[.025] text-white/45 hover:bg-white/[.05] hover:text-white/75")
      }
    >
      <Power size={14} />
    </button>
  );
}
