#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildLoginRedirect } from "../auth.config.ts";

const prior = process.env.IPRESENTERPLUX_PUBLIC_BASE_URL;
try {
  process.env.IPRESENTERPLUX_PUBLIC_BASE_URL = "https://ipresenterplux.lightworldtech.com";
  const redirect = buildLoginRedirect(new URL("https://localhost:3011/archive/abc?q=sermon"));
  assert.equal(redirect.origin, "https://ipresenterplux.lightworldtech.com");
  assert.equal(redirect.pathname, "/login");
  assert.equal(redirect.searchParams.get("callbackUrl"), "/archive/abc?q=sermon");
  assert.doesNotMatch(redirect.href, /localhost|127\.0\.0\.1/i, "public login redirect must not expose internal hostnames");

  process.env.IPRESENTERPLUX_PUBLIC_BASE_URL = "not-a-url";
  const local = buildLoginRedirect(new URL("http://localhost:3011/settings"));
  assert.equal(local.origin, "http://localhost:3011", "invalid configured base must fall back to request origin for local development");
  assert.equal(local.searchParams.get("callbackUrl"), "/settings");

  console.log(JSON.stringify({ok:true,publicOrigin:true,relativeCallback:true,internalHostHidden:true,devFallback:true}));
} finally {
  if (prior === undefined) delete process.env.IPRESENTERPLUX_PUBLIC_BASE_URL;
  else process.env.IPRESENTERPLUX_PUBLIC_BASE_URL = prior;
}
