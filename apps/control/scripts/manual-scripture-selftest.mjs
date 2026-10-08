import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const controlRoot = path.resolve(import.meta.dirname, "..");
const migrationPath = path.join(controlRoot, "db/036_manual_scripture_workspace.sql");
const servicePath = path.join(controlRoot, "src/lib/manual-scripture.ts");
const routePath = path.join(controlRoot, "src/app/api/v1/scriptures/manual/route.ts");

assert.ok(existsSync(migrationPath), "manual Scripture migration 036 must exist");
assert.ok(existsSync(servicePath), "manual-scripture.ts must exist");
assert.ok(existsSync(routePath), "manual Scripture API route must exist");

const migration = readFileSync(migrationPath, "utf8");
assert.match(migration, /detection_method IN \('unknown','reference','context','quote','manual'\)/, "migration must preserve provenance values and add manual");

const { createManualScriptureDetection, ManualScriptureError } = await import(
  pathToFileURL(servicePath).href + `?selftest=${Date.now()}`
);

const versions = [{ id: "WEBP", abbreviation: "WEBP" }];
const books = [{ version_id: "WEBP", book_code: "JHN", canonical_name: "John" }];
const verses = [{ version_id: "WEBP", book_code: "JHN", chapter: 3, verse: 16, text: "For God so loved the world." }];

class FakeManualClient {
  constructor(status = "ready") {
    this.status = status;
    this.detections = [];
    this.audit = [];
    this.insertCount = 0;
  }

  async query(sql, values = []) {
    const q = String(sql).replace(/\s+/g, " ").trim().toLowerCase();

    if (q.includes("from services") && q.includes("for update")) {
      return {
        rowCount: 1,
        rows: [{ id: values[0], organization_id: "00000000-0000-4000-8000-000000000001", status: this.status }]
      };
    }
    if (q.includes("from bible_versions")) {
      const rows = versions.filter((row) => row.id.toUpperCase() === String(values[0]).toUpperCase());
      return { rowCount: rows.length, rows };
    }
    if (q.includes("from bible_books")) {
      const candidate = String(values[1]).toLowerCase();
      const rows = books.filter((row) => row.version_id === values[0] && (row.canonical_name.toLowerCase() === candidate || row.book_code.toLowerCase() === candidate));
      return { rowCount: rows.length, rows };
    }
    if (q.includes("from bible_verses")) {
      const rows = verses
        .filter((row) => row.version_id === values[0] && row.book_code === values[1] && row.chapter === values[2] && row.verse >= values[3] && row.verse <= values[4])
        .map(({ verse, text }) => ({ verse, text }));
      return { rowCount: rows.length, rows };
    }
    if (q.includes("from scripture_detections") && q.includes("detection_method='manual'") && q.includes("state='detected'")) {
      const found = this.detections.find((row) =>
        row.service_id === values[0] && row.bible_version === values[1] && row.book === values[2] &&
        row.chapter === values[3] && row.verse_start === values[4] && row.verse_end === values[5] && row.state === "detected"
      );
      return { rowCount: found ? 1 : 0, rows: found ? [found] : [] };
    }
    if (q.startsWith("insert into scripture_detections")) {
      this.insertCount += 1;
      assert.match(q, /'manual'/, "manual insert must record manual provenance");
      assert.match(q, /'detected'/, "manual selection must enter detected state only");
      const row = {
        id: `00000000-0000-4000-8000-${String(this.insertCount).padStart(12, "0")}`,
        service_id: values[0],
        scripture_reference: values[1],
        book: values[2],
        chapter: values[3],
        verse_start: values[4],
        verse_end: values[5],
        bible_version: values[6],
        state: "detected"
      };
      this.detections.push(row);
      return { rowCount: 1, rows: [row] };
    }
    if (q.startsWith("insert into audit_events")) {
      this.audit.push(values);
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`Unhandled manual Scripture query: ${q}`);
  }
}

const SERVICE_ID = "00000000-0000-4000-8000-000000000003";
const ACTOR_ID = "00000000-0000-4000-8000-000000000010";
const client = new FakeManualClient("ready");
const created = await createManualScriptureDetection(client, {
  serviceId: SERVICE_ID,
  reference: "John 3:16",
  version: "WEBP",
  actorId: ACTOR_ID
});
assert.equal(created.state, "detected");
assert.equal(created.reference, "John 3:16");
assert.equal(created.passageText, "For God so loved the world.");
assert.equal(created.reused, false);
assert.equal(client.insertCount, 1);
assert.equal(client.audit.length, 1);

const reused = await createManualScriptureDetection(client, {
  serviceId: SERVICE_ID,
  reference: "John 3:16",
  version: "WEBP",
  actorId: ACTOR_ID
});
assert.equal(reused.id, created.id, "same detected manual passage should be reused");
assert.equal(reused.reused, true);
assert.equal(client.insertCount, 1, "idempotent repeat must not insert another detected row");
assert.equal(client.audit.length, 2, "repeat selection is still audited");

const ended = new FakeManualClient("ended");
await assert.rejects(
  () => createManualScriptureDetection(ended, { serviceId: SERVICE_ID, reference: "John 3:16", version: "WEBP", actorId: ACTOR_ID }),
  (error) => error instanceof ManualScriptureError && error.code === "service_not_ready" && error.status === 409
);
assert.equal(ended.insertCount, 0);

const malformed = new FakeManualClient("ready");
await assert.rejects(
  () => createManualScriptureDetection(malformed, { serviceId: SERVICE_ID, reference: "John 3:0", version: "WEBP", actorId: ACTOR_ID }),
  (error) => error instanceof ManualScriptureError && error.code === "scripture_reference_invalid" && error.status === 422
);
assert.equal(malformed.insertCount, 0);

const route = readFileSync(routePath, "utf8");
assert.match(route, /auth\(\)/, "manual route must authenticate");
assert.match(route, /forcePasswordChange/, "manual route must enforce forced password change");
assert.match(route, /LIVE_OPERATOR_ROLES/, "manual route must require live-operator RBAC");
assert.match(route, /userHasAnyRole\(/, "manual route must verify organization-scoped role membership");
assert.match(route, /status:\s*403/, "manual route must deny unauthorized/cross-organization control");
assert.match(route, /publishServiceEvent\([^,]+,\s*["']scripture\.detected["']/, "manual creation must publish scripture.detected after commit");
assert.doesNotMatch(route, /program\.show|preview\.prepare/, "manual selection route must not bypass explicit Preview/Program state transitions");

console.log(JSON.stringify({ ok: true, idempotent: true, provenance: "manual", initialState: "detected", rbac: "LIVE_OPERATOR_ROLES" }));
