import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const route = fs.readFileSync(path.join(root, "src/app/api/v1/edge/pairing/route.ts"), "utf8");
const manager = fs.readFileSync(path.join(root, "src/components/edge/EdgeDeviceManager.tsx"), "utf8");

const failures = [];
const requireIn = (source, needle, message) => {
  if (!source.includes(needle)) failures.push(message);
};
requireIn(route, "reprovisionRevoked: z.boolean().optional().default(false)", "pairing API must require explicit revoked-device re-provision intent");
requireIn(route, 'existing.rows[0].status === "revoked" && !payload.reprovisionRevoked', "revoked devices must remain blocked unless the admin explicitly re-provisions them");
requireIn(route, 'reprovisioning = existing.rows[0].status === "revoked" && payload.reprovisionRevoked', "pairing must distinguish explicit re-provision from ordinary pairing");
requireIn(route, "edge.device.reprovisioned", "re-provisioning must be explicitly audited");
requireIn(route, "update edge_device_credentials set state='revoked'", "old credentials must remain revoked during re-provisioning");

requireIn(manager, "reprovisionRevoked", "device manager must track explicit re-provision mode");
requireIn(manager, "Re-provision", "revoked device row must expose an explicit Re-provision action");
requireIn(manager, "reprovisionRevoked, ttlMinutes: 15", "pairing request must send the explicit re-provision flag");

if (failures.length) {
  console.error("Edge re-provision contract failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Edge re-provision contract passed.");
