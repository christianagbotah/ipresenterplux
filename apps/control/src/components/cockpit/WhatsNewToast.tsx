"use client";

import { useSyncExternalStore } from "react";
import { Sparkles, X } from "lucide-react";

// First-visit "What's new" toast for the cockpit. Surfaces the keyboard
// shortcut suite (F/D/A/P/⌘K/?) on first load, persists dismissal in
// localStorage, re-appears when WHATS_NEW_VERSION bumps. Calm, dismissible,
// never blocks live operation. Purely presentational.

const KEY = "ipresenterplux:whats-new-seen";
// Bump this when shipping a new set of improvements to re-surface the toast
// for operators who already dismissed the previous version.
const WHATS_NEW_VERSION = "2026-10-10-shortcuts";
const CHANGE_EVENT = "ipresenterplux:whats-new-changed";

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
    return localStorage.getItem(KEY) === WHATS_NEW_VERSION;
  } catch {
    return false;
  }
}

function getServerSnapshot(): boolean {
  return true; // assume seen on SSR; the toast only shows client-side
}

export function WhatsNewToast() {
  const seen = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function dismiss() {
    try {
      localStorage.setItem(KEY, WHATS_NEW_VERSION);
    } catch {
      // ignore storage failures
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  if (seen) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="ip-ai-arrive fixed bottom-3 left-3 z-[60] w-[calc(100vw-1.5rem)] max-w-sm overflow-hidden rounded-2xl border border-[#d7a94a]/25 bg-[#0c1017]/97 shadow-[0_20px_60px_rgba(0,0,0,.5)] backdrop-blur-xl sm:w-96"
    >
      <div className="flex items-start gap-3 border-b border-white/[.07] px-4 py-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#d7a94a]/10 text-[#efc86f]">
          <Sparkles size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-black uppercase tracking-[.16em] text-[#e2b85f]">What&apos;s new</div>
          <div className="mt-0.5 text-sm font-bold text-white/90">Keyboard shortcuts for the live cockpit</div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white/45 transition hover:bg-white/[.05] hover:text-white/80 ip-focus-gold"
          aria-label="Dismiss what's new"
        >
          <X size={15} />
        </button>
      </div>
      <div className="space-y-2 px-4 py-3">
        <p className="text-xs leading-5 text-white/60">
          The cockpit now has a full keyboard shortcut suite. Press <kbd className="rounded border border-white/10 bg-white/[.04] px-1 font-mono text-[10px] text-white/70">?</kbd> anytime to see them all:
        </p>
        <dl className="space-y-1 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-white/55">Toggle Focus Mode</dt>
            <dd><kbd className="rounded border border-white/10 bg-white/[.04] px-1.5 py-0.5 font-mono text-white/70">F</kbd></dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-white/55">Cycle cockpit depth</dt>
            <dd><kbd className="rounded border border-white/10 bg-white/[.04] px-1.5 py-0.5 font-mono text-white/70">D</kbd></dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-white/55">Open Attention</dt>
            <dd><kbd className="rounded border border-white/10 bg-white/[.04] px-1.5 py-0.5 font-mono text-white/70">A</kbd></dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-white/55">AI Command palette</dt>
            <dd><kbd className="rounded border border-white/10 bg-white/[.04] px-1.5 py-0.5 font-mono text-white/70">⌘K</kbd></dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-white/55">Take to Program</dt>
            <dd><kbd className="rounded border border-white/10 bg-white/[.04] px-1.5 py-0.5 font-mono text-white/70">⌘↵</kbd></dd>
          </div>
        </dl>
      </div>
      <div className="border-t border-white/[.07] px-4 py-2.5">
        <button
          type="button"
          onClick={dismiss}
          className="ip-focus-gold w-full rounded-lg bg-[#d7a94a] px-3 py-2 text-xs font-bold text-[#171107] transition hover:brightness-110"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
