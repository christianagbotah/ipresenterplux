"use client";

import { useSyncExternalStore } from "react";
import { Sparkles, Zap } from "lucide-react";

// Manual reduce-motion preference for booth machines where the OS
// prefers-reduced-motion pref isn't set. Persists to localStorage
// ('ipresenterplux:reduce-motion' = '1'|'0'), applies/removes the
// .ip-reduce-motion class on <html>, and is mirrored before first paint
// by the early inline script in layout.tsx so there's no flash.
//
// Uses useSyncExternalStore so the checkbox never flashes the wrong state
// on mount and stays correct if the pref changes in another tab.
//
// This is a personal operator preference, not a role-gated admin control —
// visible to every signed-in user on the Settings page. It only governs
// the state-clarifying ip-* animations; it never changes server authority,
// capability, or any live-production safety path.

const KEY = "ipresenterplux:reduce-motion";
const CHANGE_EVENT = "ipresenterplux:reduce-motion-changed";

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

function getSnapshot(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

// SSR snapshot — assume off; the early inline script in layout.tsx applies
// the class before paint on the client, so there's no flash.
function getServerSnapshot(): boolean {
  return false;
}

export function MotionPreferences() {
  const enabled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function commit(next: boolean) {
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // ignore storage failures (private mode etc.) — the in-memory class still applies
    }
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("ip-reduce-motion", next);
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return (
    <section className="ip-ai-arrive rounded-[22px] border border-white/[.08] bg-[#0d121a] p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#d7a94a]/15 bg-[#d7a94a]/[.07] text-[#efc76e]">
          {enabled ? <Sparkles size={19} /> : <Zap size={19} />}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-black">Motion</h2>
          <p className="mt-2 text-sm leading-6 text-white/55">
            iPresenterPlux uses small, calm animations to clarify live state — a Program heartbeat, Preview preparation, AI recommendation arrival. Turn this on to disable them on this booth machine. Your OS preference is also respected automatically.
          </p>
          <label className="mt-4 flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-white/[.08] bg-black/20 p-4">
            <span>
              <span className="block text-sm font-bold text-white/85">Reduce motion</span>
              <span className="mt-1 block text-xs leading-5 text-white/50">
                {enabled ? "On — state-clarifying animations are disabled." : "Off — animations play (your OS preference may still disable them)."}
              </span>
            </span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => commit(event.target.checked)}
              className="h-5 w-5 cursor-pointer accent-[#d7a94a]"
              aria-label="Reduce motion on this machine"
            />
          </label>
        </div>
      </div>
    </section>
  );
}
