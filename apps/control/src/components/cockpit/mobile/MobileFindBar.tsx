"use client";

import { Search } from "lucide-react";

const OPEN_EVENT = "ipresenterplux:command-open";

export function MobileFindBar() {
  return <button
    type="button"
    onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
    className="ip-focus-gold flex min-h-11 w-full items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.025] px-3 text-left text-xs text-white/55 transition hover:bg-white/[.05] hover:text-white/80"
    aria-label="What do you need next?"
  >
    <Search size={16} className="shrink-0 text-[#e2b85f]" aria-hidden="true" />
    <span className="min-w-0 flex-1 truncate">What do you need next?</span>
    <span className="shrink-0 text-[9px] font-black uppercase tracking-[.12em] text-white/30">Find</span>
  </button>;
}
