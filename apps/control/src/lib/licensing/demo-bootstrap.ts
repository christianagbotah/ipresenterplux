import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

type QueryClient = Pick<PoolClient, "query">;

export const DEMO_FULL_FEATURES = {
  "core.presentation": true,
  "ai.director": true,
  "translations.text": true,
  "translations.audio": true,
  "streaming.web": true,
  "streaming.social": true
} as const;

export class DemoEntitlementBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoEntitlementBootstrapError";
  }
}

export async function ensureDemoFullEntitlement(client: QueryClient, options: { now?: Date } = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const organization = await client.query<{ id: string }>(
    "select id::text from organizations where slug='demo-church' limit 1 for update"
  );
  if (!organization.rows[0]) throw new DemoEntitlementBootstrapError("Built-in demo organization was not found");
  const organizationId = organization.rows[0].id;

  const existingPlan = await client.query<{ id: string }>("select id::text from subscription_plans where code='demo-full' limit 1");
  const createdPlan = !existingPlan.rowCount;
  const plan = await client.query<{ id: string }>(
    `insert into subscription_plans
      (code,name,enabled,billing_interval,billing_interval_count,default_device_seat_limit,features,numeric_limits,metadata,created_at,updated_at)
     values ('demo-full','Demo Full',true,'none',1,10,$1::jsonb,$2::jsonb,$3::jsonb,$4,$4)
     on conflict (code) do update set
       name=excluded.name,enabled=true,billing_interval='none',billing_interval_count=1,
       default_device_seat_limit=10,features=excluded.features,numeric_limits=excluded.numeric_limits,
       metadata=subscription_plans.metadata || excluded.metadata,updated_at=excluded.updated_at
     returning id::text`,
    [JSON.stringify(DEMO_FULL_FEATURES), JSON.stringify({ deviceSeats: 10 }), JSON.stringify({ demo: true, internal: true }), now]
  );
  const planId = plan.rows[0].id;

  const current = await client.query<{ id: string; plan_id: string }>(
    `select id::text,plan_id::text from organization_subscriptions
     where organization_id=$1 and status in ('trial','active','past_due','suspended')
     order by created_at desc,id desc limit 1 for update`,
    [organizationId]
  );
  if (current.rows[0]) {
    return { organizationId, planId, planCode: "demo-full", subscriptionId: current.rows[0].id, createdPlan, createdSubscription: false };
  }

  const subscriptionId = randomUUID();
  await client.query(
    `insert into organization_subscriptions
      (id,organization_id,plan_id,status,starts_at,device_seat_limit,metadata,created_at,updated_at)
     values ($1,$2,$3,'active',$4,10,$5::jsonb,$4,$4)`,
    [subscriptionId, organizationId, planId, now, JSON.stringify({ demoBootstrap: true })]
  );
  await client.query(
    `insert into audit_events(organization_id,actor_type,action,entity_type,entity_id,details,created_at)
     values ($1,'system','licensing.demo.bootstrap','organization_subscription',$2,$3::jsonb,$4)`,
    [organizationId, subscriptionId, JSON.stringify({ planCode: "demo-full", planId }), now]
  );
  return { organizationId, planId, planCode: "demo-full", subscriptionId, createdPlan, createdSubscription: true };
}
