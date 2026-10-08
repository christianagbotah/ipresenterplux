import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const read = (relative) => readFile(path.join(repoRoot, relative), "utf8");

const privatePemHeader = "-----BEGIN " + "PRIVATE KEY-----";
const fullKey = /IPLX-(?:[A-HJ-NP-Z2-9]{4}-){4}[A-HJ-NP-Z2-9]{4}/g;
const productionRoots = [
  "apps/control/src",
  "apps/edge-agent/src",
  "config",
  "ops",
  ".github/workflows"
];

async function walk(relative) {
  const root = path.join(repoRoot, relative);
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const childRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await walk(childRelative));
    else if (entry.isFile()) files.push(childRelative);
  }
  return files;
}

const productionFiles = (await Promise.all(productionRoots.map(walk))).flat();
for (const relative of productionFiles) {
  let text;
  try { text = await read(relative); } catch { continue; }
  assert.equal(text.includes(privatePemHeader), false, `${relative} embeds private signing material`);
  assert.equal(text.includes("NEXT_PUBLIC_IPRESENTERPLUX_ENTITLEMENT_PRIVATE_KEY_PEM"), false, `${relative} exposes the private signing key to browser code`);
  for (const match of text.matchAll(fullKey)) {
    assert.equal(match[0], "IPLX-XXXX-XXXX-XXXX-XXXX-XXXX", `${relative} contains a full product-key value`);
  }
}

const desktopSettings = await read("apps/edge-agent/src/iPresenterPlux.Edge.Desktop/DesktopSettings.cs");
for (const forbidden of ["ActivationToken", "ProductKey", "EntitlementEnvelope", "PrivateKey"]) {
  assert.equal(desktopSettings.includes(forbidden), false, `DesktopSettings must not persist ${forbidden}`);
}

const entitlementStore = await read("apps/edge-agent/src/iPresenterPlux.Edge.Desktop/DesktopEntitlementStore.cs");
assert.match(entitlementStore, /WindowsCredentialManagerEntitlementVault/);
assert.match(entitlementStore, /MacOSKeychainEntitlementVault/);

const publicKeyCatalog = await read("apps/edge-agent/src/iPresenterPlux.Edge.Desktop/EntitlementPublicKeyCatalog.cs");
assert.match(publicKeyCatalog, /IPRESENTERPLUX_ENTITLEMENT_PUBLIC_KEYS_JSON/);
assert.equal(publicKeyCatalog.includes("PRIVATE_KEY"), false);

const mainWindow = await read("apps/edge-agent/src/iPresenterPlux.Edge.Desktop/MainWindow.cs");
assert.match(mainWindow, /_productKey\.Text\s*=\s*string\.Empty/);
assert.match(mainWindow, /DesktopEntitlementStore\.CreateDefault/);

const controlCi = await read(".github/workflows/control-ci.yml");
assert.match(controlCi, /Licensing release-security self-test/);
assert.match(controlCi, /test:licensing-release-security/);

const edgeCi = await read(".github/workflows/edge-agent-ci.yml");
assert.match(edgeCi, /Scan Windows licensing package/);
assert.match(edgeCi, /Scan macOS licensing package/);
assert.match(edgeCi, /licensing-package-scan\.py/);

const packageScannerPath = path.join(repoRoot, "apps/edge-agent/scripts/licensing-package-scan.py");
const packageScanner = await read("apps/edge-agent/scripts/licensing-package-scan.py");
assert.match(packageScanner, /BEGIN PRIVATE KEY/);
assert.match(packageScanner, /IPLX-/);
assert.match(packageScanner, /settings\.json/);

const scanRoot = await mkdtemp(path.join(os.tmpdir(), "ipresenterplux-license-scan-"));
try {
  const safe = path.join(scanRoot, "safe");
  const privateLeak = path.join(scanRoot, "private");
  const keyLeak = path.join(scanRoot, "product-key");
  const settingsLeak = path.join(scanRoot, "settings");
  for (const directory of [safe, privateLeak, keyLeak, settingsLeak]) {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(directory, { recursive: true }));
  }
  await writeFile(path.join(safe, "settings.json"), JSON.stringify({ controlPlaneUrl: "https://control.example" }));
  assert.equal(spawnSync("python3", [packageScannerPath, safe]).status, 0, "safe package must pass secret scan");

  await writeFile(path.join(privateLeak, "payload.txt"), privatePemHeader + "\nnot-a-real-key");
  assert.notEqual(spawnSync("python3", [packageScannerPath, privateLeak]).status, 0, "private key material must fail package scan");

  await writeFile(path.join(keyLeak, "payload.txt"), "IPLX-ABCD-EFGH-JKMN-PQRS-TUVW");
  assert.notEqual(spawnSync("python3", [packageScannerPath, keyLeak]).status, 0, "full product key must fail package scan");

  await writeFile(path.join(settingsLeak, "settings.json"), JSON.stringify({ activationToken: "must-not-ship" }));
  assert.notEqual(spawnSync("python3", [packageScannerPath, settingsLeak]).status, 0, "secret-bearing settings must fail package scan");
} finally {
  await rm(scanRoot, { recursive: true, force: true });
}

const operations = await read("docs/operations/licensing-key-management.md");
assert.match(operations, /IPRESENTERPLUX_ENTITLEMENT_PRIVATE_KEY_PEM/);
assert.match(operations, /IPRESENTERPLUX_ENTITLEMENT_PUBLIC_KEYS_JSON/);
assert.match(operations, /never/i);

console.log(JSON.stringify({
  ok: true,
  productionFilesScanned: productionFiles.length,
  privateSigningMaterialEmbedded: false,
  fullProductionKeysEmbedded: false,
  desktopSettingsSecretFree: true,
  packageScansRequired: ["windows", "macos"]
}));
