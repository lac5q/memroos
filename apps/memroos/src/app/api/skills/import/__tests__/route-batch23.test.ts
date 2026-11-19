// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `skill-import-b23-${crypto.randomUUID()}`);
const signingKey = path.join(process.cwd(), "data", "skill-signing-key.json");
const LOOPBACK = "http://localhost";

beforeEach(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  process.env.MEMROOS_ROOT = TMP_ROOT;
  process.env.SQLITE_DB_PATH = path.join(TMP_ROOT, `db-${crypto.randomUUID()}.db`);
  process.env.MEMROOS_OPERATOR_API_KEY = "right-key";
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.MEMROOS_ROOT;
  delete process.env.SQLITE_DB_PATH;
  delete process.env.MEMROOS_OPERATOR_API_KEY;
  if (fs.existsSync(signingKey)) fs.unlinkSync(signingKey);
  try {
    const dbModule = await import("@/lib/db");
    dbModule.closeDb();
  } catch {
    /* ignore */
  }
  vi.resetModules();
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

async function initDb() {
  const { getDb } = await import("@/lib/db");
  const { initSchema } = await import("@/lib/db-schema");
  const db = getDb();
  initSchema(db);
  return db;
}

describe("/api/skills/import batch23", () => {
  it("GET parses verification_checks JSON arrays and POST returns 500 on database errors", async () => {
    const db = await initDb();
    db.prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, signature, signed_by, signed_at, trust_level,
        public_key_fingerprint
      ) VALUES (
        'import-b23', 'desc', 'ops', 'claude', 'low', 'enabled',
        '1.0.0', 'none', 'read_file', ?, 'revert',
        'body', 100, '[]', 'ops', ?, 'check', ?, NULL, NULL, NULL, 'unsigned', NULL
      )`
    ).run(JSON.stringify(["check-a", "check-b"]), new Date().toISOString(), "0".repeat(64));

    const route = await import("../route");
    const list = await route.GET(new Request(`${LOOPBACK}/api/skills/import`));
    const listBody = await list.json();
    expect(listBody.items[0].verification_checks_list).toEqual(["check-a", "check-b"]);

    vi.doMock("@/lib/db", () => ({
      getDb: () => ({
        prepare: () => {
          throw new Error("import db batch23");
        },
      }),
      closeDb: () => {},
    }));
    vi.resetModules();
    const routeBroken = await import("../route");
    const fail = await routeBroken.POST(
      new Request(`${LOOPBACK}/api/skills/import`, {
        method: "POST",
        headers: {
          authorization: "Bearer right-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          source_harness: "claude",
          content: "---\nname: x\n---\n",
          imported_by: "ops",
        }),
      })
    );
    expect(fail.status).toBe(500);
    expect(await fail.json()).toMatchObject({ error: expect.stringContaining("import db batch23") });
    vi.doUnmock("@/lib/db");
  });
});
