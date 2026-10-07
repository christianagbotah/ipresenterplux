#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

const read = async (relativePath) =>
  fs.readFile(path.join(repoRoot, relativePath), "utf8");

const workflow = await read(".github/workflows/deploy.yml");
const deployer = await read("ops/deploy/ipresenterplux-deploy.sh");
const service = await read("ops/deploy/ipresenterplux-deploy.service");
const timer = await read("ops/deploy/ipresenterplux-deploy.timer");

assert.match(workflow, /name:\s*Deployment Handoff/);
assert.match(workflow, /branches:\s*\[main\]/);
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
assert.match(workflow, /\/home\/lightworld\/webapps\/ipresenterplux/);
assert.match(workflow, /VPS-side Git pull deployer/i);
assert.doesNotMatch(workflow, /ssh-action|ssh-private-key|SSH_PRIVATE_KEY|appleboy\/ssh-action/i);

assert.match(deployer, /APP=.*\/home\/lightworld\/webapps\/ipresenterplux/);
assert.match(deployer, /APP_USER=.*lightworld/);
assert.match(deployer, /git\s+fetch\s+--prune\s+origin\s+main/);
assert.match(deployer, /git\s+merge\s+--ff-only/);
assert.match(deployer, /tracked working tree changes exist/i);
assert.match(deployer, /runuser\s+-u\s+"?\$APP_USER"?/);
assert.match(deployer, /pnpm\s+--dir\s+apps\/control\s+install\s+--frozen-lockfile/);
assert.match(deployer, /pnpm\s+--dir\s+apps\/control\s+db:migrate/);
assert.match(deployer, /pnpm\s+--dir\s+apps\/control\s+build/);
assert.match(deployer, /systemctl\s+restart\s+"?\$SERVICE"?/);
assert.match(deployer, /127\.0\.0\.1:3011\/api\/v1\/health/);
assert.match(deployer, /ipresenterplux\.lightworldtech\.com\/api\/v1\/health/);
assert.match(deployer, /ROLLBACK:/);
assert.match(deployer, /last_successful_sha/);
assert.match(deployer, /flock\s+-n/);
assert.doesNotMatch(deployer, /apps\/edge-agent.*(build|publish)|dotnet\s+(build|publish)/i);

// Root owns the one-shot deploy unit only so it can restart the existing system service;
// repository, dependency, migration and build work must be dropped to the app user.
assert.match(service, /User=root/);
assert.match(service, /ExecStart=\/home\/lightworld\/bin\/ipresenterplux-deploy\.sh/);
assert.match(timer, /OnCalendar=\*-\*-\* \*:\*:00/);
assert.match(timer, /Unit=ipresenterplux-deploy\.service/);

console.log("Deployment contract self-test passed (handoff, least-privilege poller, health, rollback, no SSH/Edge build). ");
