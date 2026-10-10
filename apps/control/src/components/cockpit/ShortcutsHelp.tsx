"use client";

import { useEffect, useState } from "react";
import { Keyboard, X } from "lucide-react";

// Keyboard shortcut help overlay. Press "?" (Shift+/) anywhere outside a text
// input to surface every cockpit keyboard path. Makes the live operation
// discoverable for volunteers without adding buttons or clutter. Closes on
// Escape or click-outside. Does NOT register any mutation shortcut — it only
// documents the existing, human-authorized paths (Take/Clear remain explicit
// and modifier-gated in ProgramPreviewStage; the command palette owns ⌘K).

const OPEN_EVENT = "ipresenterplux:shortcuts-open";

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      return Boolean(
        target.closest("input,textarea,select,[contenteditable='true'],[role='textbox']")
      );
    }
    function onKey(event: KeyboardEvent) {
      // Open on "?" (Shift+/ on US layouts) — bare, no modifier.
      if (event.key === "?" && !isTypingTarget(event.target)) {
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (event.key === "Escape" && open) {
        event.preventDefault();
        setOpen(false);
      }
    }
    function openFromEvent() { setOpen(true); }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, openFromEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, openFromEvent);
    };
  }, [open]);

  if (!open) return null;

  const groups: Array<{ heading: string; rows: Array<[string, string]> }> = [
    {
      heading: "Live operation",
      rows: [
        ["⌘ / Ctrl + Enter", "Take Preview to Program"],
        ["⌘ / Ctrl + Backspace", "Clear Program"],
        ["⌘ / Ctrl + K", "Open the AI Command palette"],
        ["F", "Toggle Focus Mode"],
        ["?", "Show this shortcut list"],
        ["Esc", "Close overlays / exit Focus"],
      ],
    },
    {
      heading: "Operator queue (Operator workspace)",
      rows: [
        ["↑ / ↓", "Move selection in the service queue"],
        ["P", "Preview the selected Scripture"],
      ],
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[180] flex items-start justify-center bg-black/65 px-3 pt-[10vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={() => setOpen(false)}
    >
      <section
        className="ip-focus-in w-full max-w-lg overflow-hidden rounded-2xl border border-white/[.1] bg-[#0a0f17] shadow-[0_30px_120px_rgba(0,0,0,.7)]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-white/[.07] px-4 py-4">
          <div className="flex items-center gap-2">
            <Keyboard size={17} className="text-[#e2b85f]" />
            <div>
              <div className="text-[11px] font-black uppercase tracking-[.2em] text-[#e2b85f]">Shortcuts</div>
              <h2 className="mt-0.5 text-lg font-black">Live operation keyboard map</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-white/55 transition hover:bg-white/[.05] hover:text-white ip-focus-gold"
            aria-label="Close shortcuts"
          >
            <X size={18} />
          </button>
        </header>
        <div className="space-y-5 p-4">
          {groups.map((group) => (
            <div key={group.heading}>
              <div className="text-[11px] font-bold uppercase tracking-[.14em] text-white/45">{group.heading}</div>
              <dl className="mt-2 space-y-1.5">
                {group.rows.map(([keys, label]) => (
                  <div key={keys} className="flex items-center justify-between gap-3 text-sm">
                    <dt className="text-white/70">{label}</dt>
                    <dd className="flex shrink-0 items-center gap-1">
                      {keys.split(" / ").map((part) => (
                        <kbd key={part} className="rounded border border-white/10 bg-white/[.05] px-1.5 py-0.5 font-mono text-[11px] text-white/75">
                          {part}
                        </kbd>
                      )).reduce<React.ReactNode[]>((acc, el, i) => acc.length === 0 ? [el] : [...acc, <span key={`s${i}`} className="text-white/30">/</span>, el], [])}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
          <p className="border-t border-white/[.07] pt-3 text-[11px] leading-5 text-white/45">
            Program mutation is always human-authorized. AI prepares content into Preview; only the operator can Take it to Program.
          </p>
        </div>
      </section>
    </div>
  );
}

export { OPEN_EVENT as SHORTCUTS_OPEN_EVENT };
