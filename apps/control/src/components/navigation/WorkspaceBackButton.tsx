"use client";

import { ArrowLeft } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

const HIDDEN_PATHS = new Set(["/", "/login", "/live"]);
const LOCAL_BACK_PATHS = new Set(["/admin/licensing", "/media/import", "/planner", "/settings", "/streaming"]);
const LOCAL_BACK_PREFIXES = ["/planner/", "/settings/"];

export function WorkspaceBackButton() {
  const pathname = usePathname();
  const router = useRouter();
  if (!pathname || HIDDEN_PATHS.has(pathname) || LOCAL_BACK_PATHS.has(pathname) || LOCAL_BACK_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null;

  function goBack() {
    let sameOriginReferrer = false;
    try {
      sameOriginReferrer = Boolean(document.referrer) && new URL(document.referrer).origin === window.location.origin;
    } catch {
      sameOriginReferrer = false;
    }
    if (window.history.length > 1 && sameOriginReferrer) {
      router.back();
      return;
    }
    router.push("/");
  }

  return (
    <button
      type="button"
      onClick={goBack}
      aria-label="Back"
      title="Back"
      className="ip-focus-gold fixed bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] left-3 z-[70] inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-white/[.1] bg-[#0b1017]/92 px-3.5 text-xs font-black text-white/78 shadow-[0_12px_38px_rgba(0,0,0,.34)] backdrop-blur-xl transition hover:border-[#d7a94a]/35 hover:bg-[#121925] hover:text-white md:bottom-5 md:left-5"
    >
      <ArrowLeft size={15} /> Back
    </button>
  );
}
