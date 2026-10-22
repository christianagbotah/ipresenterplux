"use client";

import { Search } from "lucide-react";

export function UniversalFindTrigger() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("ipresenterplux:command-open"))}
      aria-label="What do you need next?"
      className="ip-focus-gold hidden min-h-11 min-w-0 flex-1 items-center justify-between gap-3 rounded-xl border border-white/[.08] bg-white/[.025] px-3 text-left text-xs text-white/50 transition hover:bg-white/[.05] hover:text-white/75 md:flex lg:max-w-md"
    >
      <span className="flex min-w-0 items-center gap-2"><Search size={15} className="shrink-0 text-[#e2b85f]"/><span className="truncate">What do you need next?</span></span>
      <kbd className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-xs text-white/35">⌘K</kbd>
    </button>
  );
}
