#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root=path.resolve(import.meta.dirname,"..");
const repo=path.resolve(root,"../..");
const workflow=readFileSync(path.join(repo,".github/workflows/control-ci.yml"),"utf8");
const packageJson=JSON.parse(readFileSync(path.join(root,"package.json"),"utf8"));
const requiredSteps=[
  ["Songs and Media workspace self-test","pnpm test:media-workspace"],
  ["Cameras workspace self-test","pnpm test:camera-workspace"],
  ["AI Director workspace self-test","pnpm test:ai-director"],
  ["Service Archive workspace self-test","pnpm test:archive"],
  ["Studio route gating self-test","pnpm test:studio-route-gating"],
  ["Studio navigation route self-test","pnpm test:studio-navigation"]
];
for(const [name,command] of requiredSteps){
  assert.ok(workflow.includes(`- name: ${name}`),`CI must include ${name}`);
  assert.ok(workflow.includes(`run: ${command}`),`CI must run ${command}`);
}
assert.equal(typeof packageJson.scripts["test:studio-route-manifest"],"string","route-manifest script must be registered");
assert.match(workflow,/Production build[\s\S]*Validate Studio route manifest[\s\S]*pnpm test:studio-route-manifest/u,"route manifest must be validated after production build");

const pageContracts=[
  ["media/page.tsx",["auth()","getCurrentServiceForUser","MediaWorkspace"]],
  ["cameras/page.tsx",["auth()","getCurrentServiceForUser","CameraWorkspace"]],
  ["ai-director/page.tsx",["auth()","getCurrentServiceForUser","AIDirectorWorkspace"]],
  ["archive/page.tsx",["auth()","getCurrentServiceForUser","ArchiveList"]],
  ["archive/[id]/page.tsx",["auth()","getArchivedService","ArchiveServiceDetail"]]
];
for(const [relative,tokens] of pageContracts){
  const file=path.join(root,"src/app",relative);
  assert.ok(existsSync(file),`${relative} must exist`);
  const source=readFileSync(file,"utf8");
  assert.doesNotMatch(source,/StudioReadinessPage/u,`${relative} must be a real workspace, not readiness placeholder`);
  for(const token of tokens) assert.ok(source.includes(token),`${relative} must include ${token}`);
}

console.log(JSON.stringify({ok:true,workspaceGates:4,sharedGates:2,postBuildManifestRequired:true,authorizedUiContracts:5}));
