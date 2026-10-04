import { LogOut } from "lucide-react";
import { signOut } from "@auth";

export function LogoutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <button
        type="submit"
        className="flex items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.03] px-3 py-2 text-xs font-semibold text-white/50 transition hover:bg-white/[.06] hover:text-white/80"
      >
        <LogOut size={14} />
        Sign out
      </button>
    </form>
  );
}
