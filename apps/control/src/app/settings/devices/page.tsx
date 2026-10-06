import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, MonitorCog, ShieldCheck } from "lucide-react";
import { auth } from "@auth";
import { query } from "@/lib/db";
import { DEVICE_ADMIN_ROLES } from "@/lib/rbac";
import { EdgeDeviceManager } from "@/components/edge/EdgeDeviceManager";

export const dynamic = "force-dynamic";

type MembershipRow = {
  id: string;
  name: string;
  roles: string[];
};

type CampusRow = { id: string; name: string };

type DeviceRow = {
  id: string;
  name: string;
  platform: string;
  status: string;
  campus_id: string | null;
  campus_name: string | null;
  software_version: string | null;
  last_seen_at: string | null;
  created_at: string;
  credential_state: string | null;
  credential_expires_at: string | null;
  pairing_expires_at: string | null;
  capabilities: Record<string, string>;
  last_health: {
    status?: string;
    observedAt?: string;
    cpuPercent?: number;
    memoryPercent?: number;
    uplinkMbps?: number | null;
  } | null;
  active_service_id: string | null;
  active_service_title: string | null;
  command_type: string | null;
  command_state: string | null;
  command_issued_at: string | null;
  command_completed_at: string | null;
  command_resulting_state: string | null;
  command_error_code: string | null;
};

export default async function EdgeDevicesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");

  const memberships = await query<MembershipRow>(
    `select o.id::text,o.name,array_agg(uor.role_id order by uor.role_id)::text[] as roles
     from user_organization_roles uor
     join organizations o on o.id=uor.organization_id
     where uor.user_id=$1
     group by o.id,o.name
     order by o.name
     limit 1`,
    [session.user.id]
  );
  const organization = memberships.rows[0];
  if (!organization) {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <div className="ip-card max-w-lg p-8 text-center">
          <MonitorCog className="mx-auto text-[#d7a94a]" />
          <h1 className="mt-4 text-xl font-black">No organization assigned</h1>
          <p className="mt-2 text-sm leading-6 text-white/40">Your operator account is not attached to a church organization yet.</p>
        </div>
      </main>
    );
  }

  const canManage = organization.roles.some((role) => DEVICE_ADMIN_ROLES.includes(role as never));
  if (!canManage) redirect("/");

  const [campuses, devices] = await Promise.all([
    query<CampusRow>(
      "select id::text,name from campuses where organization_id=$1 order by name",
      [organization.id]
    ),
    query<DeviceRow>(
      `select d.id::text,d.name,d.platform,d.status,d.campus_id::text,c.name as campus_name,
              d.software_version,d.last_seen_at::text,d.created_at::text,
              cred.state as credential_state,cred.expires_at::text as credential_expires_at,
              pairing.expires_at::text as pairing_expires_at,
              d.capabilities,d.metadata->'lastHealth' as last_health,
              d.active_service_id::text,s.title as active_service_title,
              cmd.command_type,cmd.state as command_state,cmd.issued_at::text as command_issued_at,
              cmd.completed_at::text as command_completed_at,cmd.resulting_state as command_resulting_state,
              cmd.error_code as command_error_code
       from edge_devices d
       left join campuses c on c.id=d.campus_id
       left join services s on s.id=d.active_service_id
       left join lateral (
         select state,expires_at
         from edge_device_credentials ec
         where ec.edge_device_id=d.id and ec.state in ('active','rotation_required')
         order by ec.issued_at desc
         limit 1
       ) cred on true
       left join lateral (
         select expires_at
         from device_pairing_codes p
         where p.edge_device_id=d.id and p.consumed_at is null and p.expires_at > now()
         order by p.created_at desc
         limit 1
       ) pairing on true
       left join lateral (
         select command_type,state,issued_at,completed_at,resulting_state,error_code
         from edge_control_commands ecc
         where ecc.edge_device_id=d.id
         order by ecc.issued_at desc,ecc.id desc
         limit 1
       ) cmd on true
       where d.organization_id=$1
       order by case d.status when 'active' then 0 when 'pending' then 1 when 'offline' then 2 else 3 end,
                d.name`,
      [organization.id]
    )
  ]);

  return (
    <main className="min-h-screen px-4 py-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link
              href="/settings"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[.08] bg-white/[.03] text-white/50 transition hover:bg-white/[.06] hover:text-white"
              aria-label="Back to Control Room"
            >
              <ArrowLeft size={17} />
            </Link>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[.18em] text-[#d7a94a]">Settings · Church Edge</div>
              <h1 className="mt-1 text-2xl font-black tracking-tight">Edge Devices</h1>
              <p className="mt-1 text-sm text-white/35">Pair church PCs and Macs with {organization.name}.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-white/[.07] bg-white/[.025] px-3 py-2 text-xs text-white/45">
            <ShieldCheck size={14} className="text-emerald-300" />
            Credentials remain in OS-protected vaults
          </div>
        </header>

        <EdgeDeviceManager
          organizationId={organization.id}
          organizationName={organization.name}
          campuses={campuses.rows}
          devices={devices.rows.map((device) => ({
            id: device.id,
            name: device.name,
            platform: device.platform,
            status: device.status,
            campusId: device.campus_id,
            campusName: device.campus_name,
            softwareVersion: device.software_version,
            lastSeenAt: device.last_seen_at,
            createdAt: device.created_at,
            credentialState: device.credential_state,
            credentialExpiresAt: device.credential_expires_at,
            pairingExpiresAt: device.pairing_expires_at,
            capabilities: device.capabilities ?? {},
            lastHealth: device.last_health,
            activeServiceId: device.active_service_id,
            activeServiceTitle: device.active_service_title,
            recentCommand: device.command_type ? {
              type: device.command_type,
              state: device.command_state ?? "unknown",
              issuedAt: device.command_issued_at,
              completedAt: device.command_completed_at,
              resultingState: device.command_resulting_state,
              errorCode: device.command_error_code
            } : null
          }))}
          canManage={canManage}
        />
      </div>
    </main>
  );
}
