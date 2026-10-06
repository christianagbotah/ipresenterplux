#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const page = await fs.readFile(new URL("../src/app/login/page.tsx", import.meta.url), "utf8");
const form = await fs.readFile(new URL("../src/app/login/LoginForm.tsx", import.meta.url), "utf8");

assert.match(page, /IPRESENTERPLUX_ENABLE_DEMO_ACCOUNTS/, "login page must gate demo credentials behind a server-side environment flag");
assert.match(page, /demoAccounts/, "login page must load the demo catalog");
assert.match(page, /<LoginForm[^>]*demoAccounts=/s, "login page must pass the gated demo catalog into the client form");

assert.match(form, /Demo account/i, "login form must visibly label the demo account selector");
assert.match(form, /<select/, "login form must render a dropdown for demo roles");
assert.match(form, /resolveDemoAccount/, "login form must resolve selections through the bounded helper");
assert.match(form, /value=\{email\}/, "email input must be controlled so demo selection can fill it");
assert.match(form, /value=\{password\}/, "password input must be controlled so demo selection can fill it");
assert.match(form, /futureModule/, "future-module demo roles must be visibly distinguishable");
assert.match(form, /onChange=.*setEmail/s, "manual email entry must remain available");
assert.match(form, /onChange=.*setPassword/s, "manual password entry must remain available");

console.log(JSON.stringify({ ok: true, gated: true, dropdown: true, manualLoginPreserved: true }));
