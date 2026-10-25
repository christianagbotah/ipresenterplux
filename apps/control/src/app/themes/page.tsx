import { redirect } from "next/navigation";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { getCurrentServiceForUser } from "@/lib/current-service";
import { ensureBuiltinPresentationThemes, listPresentationThemeImageAssets, listPresentationThemes } from "@/lib/presentation-themes";
import { LIVE_OPERATOR_ROLES, THEME_ADMIN_ROLES } from "@/lib/rbac";
import { StudioSidebar } from "@/components/navigation/StudioSidebar";
import { StudioMobileNav } from "@/components/navigation/StudioMobileNav";
import { ThemeStudio } from "@/components/themes/ThemeStudio";

export const dynamic="force-dynamic";

export default async function ThemesPage() {
  const session=await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");
  const context=await getCurrentServiceForUser(session.user.id);
  if (!context) return <main className="min-h-screen p-8 text-white/60">No church organization is assigned to this account.</main>;
  if (!context.capabilities.canMedia) return <main className="min-h-screen p-8 text-white/60">Theme Studio requires presentation access on the current subscription.</main>;
  await ensureBuiltinPresentationThemes(db,context.organizationId,null);
  const themes=await listPresentationThemes(db,session.user.id,context.organizationId);
  const imageAssets=await listPresentationThemeImageAssets(db,session.user.id,context.organizationId);
  const service=context.service ? await db.query<{ active_theme_id:string|null }>(`select active_theme_id::text from services where id=$1::uuid and organization_id=$2::uuid limit 1`,[context.service.id,context.organizationId]) : null;
  const roles=context.roles;
  const canEdit=roles.some((role)=>THEME_ADMIN_ROLES.includes(role as never));
  const canAssign=roles.some((role)=>LIVE_OPERATOR_ROLES.includes(role as never));
  return <main className="min-h-screen bg-[#070a0f] text-white">
    <StudioMobileNav capabilities={context.navigationCapabilities}/>
    <div className="min-h-screen md:grid md:grid-cols-[86px_1fr] xl:grid-cols-[240px_1fr]">
      <StudioSidebar capabilities={context.navigationCapabilities}/>
      <section className="min-w-0 pb-24 md:pb-8">
        <header className="sticky top-0 z-30 border-b border-white/[.07] bg-[#05080d]/92 px-4 py-4 backdrop-blur-xl lg:px-6"><div className="text-xs font-black uppercase tracking-[.16em] text-[#e3b75c]">Presentation design</div><h1 className="mt-1 text-xl font-black">Theme Studio</h1><p className="mt-1 text-xs text-white/45">Reusable church-owned looks for Scripture, lyrics, announcements and lower thirds.</p></header>
        <div className="p-3 sm:p-4 lg:p-6"><ThemeStudio organizationId={context.organizationId} initialThemes={themes} imageAssets={imageAssets} service={context.service?{id:context.service.id,title:context.service.title,activeThemeId:service?.rows[0]?.active_theme_id??null}:null} canEdit={canEdit} canAssign={canAssign}/></div>
      </section>
    </div>
  </main>;
}
