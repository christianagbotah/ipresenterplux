export async function grantAudioEntitlement(client, organizationId, fixtureCode) {
  const current = await client.query(
    `select os.id::text as subscription_id,sp.id::text as plan_id
     from organization_subscriptions os
     join subscription_plans sp on sp.id=os.plan_id
     where os.organization_id=$1::uuid
       and os.status in ('trial','active','past_due','suspended')
     order by os.created_at desc,os.id desc
     limit 1`,
    [organizationId]
  );

  if (current.rows[0]) {
    await client.query(
      `update subscription_plans
       set enabled=true,
           features=coalesce(features,'{}'::jsonb) || '{"translations.audio":true}'::jsonb,
           updated_at=clock_timestamp()
       where id=$1::uuid`,
      [current.rows[0].plan_id]
    );
    await client.query(
      `update organization_subscriptions
       set status='active',
           starts_at=clock_timestamp()-interval '1 day',
           expires_at=clock_timestamp()+interval '1 day',
           grace_until=clock_timestamp()+interval '8 days',
           updated_at=clock_timestamp()
       where id=$1::uuid`,
      [current.rows[0].subscription_id]
    );
    return current.rows[0].subscription_id;
  }

  const plan = await client.query(
    `insert into subscription_plans(code,name,enabled,features,numeric_limits)
     values ($1,$2,true,$3::jsonb,'{}'::jsonb)
     returning id::text`,
    [fixtureCode, `${fixtureCode} plan`, JSON.stringify({ "translations.audio": true })]
  );
  const subscription = await client.query(
    `insert into organization_subscriptions
      (organization_id,plan_id,status,starts_at,expires_at,grace_until)
     values ($1,$2,'active',clock_timestamp()-interval '1 day',
             clock_timestamp()+interval '1 day',clock_timestamp()+interval '8 days')
     returning id::text`,
    [organizationId, plan.rows[0].id]
  );
  return subscription.rows[0].id;
}
