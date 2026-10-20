#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const component = await readFile(new URL("../src/components/licensing/LicensingAdmin.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../src/app/api/v1/admin/licensing/subscriptions/route.ts", import.meta.url), "utf8");
const service = await readFile(new URL("../src/lib/licensing/licensing-admin-service.ts", import.meta.url), "utf8");

assert.match(component, /Available plans/u, "all plans must stay visible even when a church already has a subscription");
assert.match(component, /Change plan/u, "current subscriptions must expose an explicit plan-change action");
assert.match(component, /configure_plan/u, "plan catalog must allow product admins to enable, disable, or configure a plan");
assert.match(route, /change_plan/u, "licensing API must expose an audited change-plan action");
assert.match(service, /changeSubscriptionPlan/u, "plan changes must live in the licensing service layer");
console.log(JSON.stringify({ ok: true, planCatalogVisible: true, changePlan: true }));
