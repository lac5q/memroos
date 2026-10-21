// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const TMP_ROOT = path.join(os.tmpdir(), `batch14b-skills-${crypto.randomUUID()}`);

const FULL_SKILL_MD = `---
name: batch14b-skill
description: batch14b
owner: ops
source_harness: claude
risk_tier: low
dispatch_status: enabled
---

## Preconditions
- none

## Allowed Tools
- read_file

## Verification Checks
- check

## Rollback
- revert

## Evidence Examples
- check
`;

function makePost(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function makeGet(url: string): Request {
  return new Request(url, { method: "GET" });
}

beforeEach(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  process.env["MEMROOS_ROOT"] = TMP_ROOT;
  process.env["SQLITE_DB_PATH"] = path.join(TMP_ROOT, `db-${crypto.randomUUID()}.db`);
  vi.resetModules();
});

afterEach(async () => {
  delete process.env["MEMROOS_ROOT"];
  delete process.env["SQLITE_DB_PATH"];
  delete process.env["MEMROOS_OPERATOR_API_KEY"];
  delete process.env["MEMROOS_SKILL_SIGNING_KEY"];
  try {
    const dbModule = await import("@/lib/db");
    dbModule.closeDb();
  } catch {
    /* ignore */
  }
  vi.resetModules();
  vi.doUnmock("@/lib/skills/skill-signing");
  vi.doUnmock("@/lib/audit/skill-chain");
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

async function loadDb() {
  const { getDb } = await import("@/lib/db");
  const db = getDb();
  initSchema(db);
  return db;
}

describe("batch14b — /api/skills/import", () => {
  it("400 when body is not an object", async () => {
    process.env["MEMROOS_OPERATOR_API_KEY"] = "import-key";
    await loadDb();
    const route = await import("../skills/import/route");
    const res = await route.POST(
      makePost("http://localhost/api/skills/import", ["array"], {
        authorization: "Bearer import-key",
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/object/i);
  });

  it("uses HMAC signing when Ed25519 keypair is unavailable", async () => {
    process.env["MEMROOS_OPERATOR_API_KEY"] = "import-key";
    process.env["MEMROOS_SKILL_SIGNING_KEY"] = "hmac-test-key";
    vi.doMock("@/lib/skills/skill-signing", async () => {
      const actual = await vi.importActual<typeof import("@/lib/skills/skill-signing")>(
        "@/lib/skills/skill-signing"
      );
      return {
        ...actual,
        loadOrCreateOperatorKeyPair: () => {
          throw new Error("no key file");
        },
      };
    });
    await loadDb();
    const route = await import("../skills/import/route");
    const res = await route.POST(
      makePost(
        "http://localhost/api/skills/import",
        { content: FULL_SKILL_MD, source_harness: "claude" },
        { authorization: "Bearer import-key" }
      )
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.signed_by).toBeTruthy();
    expect(json.trust_level).toBe("signed");
  });

  it("GET tolerates invalid verification_checks JSON", async () => {
    const db = await loadDb();
    db.prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, signature, signed_by, signed_at, trust_level,
        public_key_fingerprint
      ) VALUES (
        'bad-verify', 'd', 'ops', 'claude', 'low', 'quarantined',
        '1.0.0', 'none', 'read_file', 'not-json', 'revert',
        'body', 100, '[]', 'operator', ?, 'check', 'abc', NULL, NULL, NULL, 'unsigned', NULL
      )`
    ).run(new Date().toISOString());

    const route = await import("../skills/import/route");
    const json = await (await route.GET(makeGet("http://localhost/api/skills/import?limit=5"))).json();
    const item = json.items.find((it: { name: string }) => it.name === "bad-verify");
    expect(item.verification_checks_list).toEqual([]);
  });
});

describe("batch14b — /api/skills/proposals", () => {
  it("GET filters by skill_name", async () => {
    process.env["MEMROOS_OPERATOR_API_KEY"] = "sync-key";
    const route = await import("../skills/proposals/route");
    const db = await loadDb();
    const hash = crypto.createHash("sha256").update("alpha").digest("hex");
    await route.POST(
      makePost(
        "http://localhost/api/skills/proposals",
        {
          source_harness: "claude",
          skill_name: "alpha-skill",
          detected_content_hash: hash,
          proposed_by: "scanner",
        },
        { authorization: "Bearer sync-key" }
      )
    );
    const listed = await (
      await route.GET(makeGet("http://localhost/api/skills/proposals?skill_name=alpha-skill"))
    ).json();
    expect(listed.items.every((p: { skill_name: string }) => p.skill_name === "alpha-skill")).toBe(true);
    expect(db.prepare("SELECT COUNT(*) AS c FROM skill_import_proposals").get()).toBeTruthy();
  });

  it("POST rejects empty version strings", async () => {
    process.env["MEMROOS_OPERATOR_API_KEY"] = "sync-key";
    const route = await import("../skills/proposals/route");
    await loadDb();
    const res = await route.POST(
      makePost(
        "http://localhost/api/skills/proposals",
        {
          source_harness: "claude",
          skill_name: "v-skill",
          version: "   ",
          detected_content_hash: "a".repeat(64),
          proposed_by: "scanner",
        },
        { authorization: "Bearer sync-key" }
      )
    );
    expect(res.status).toBe(400);
  });

  it("POST rejects non-object diff_payload", async () => {
    process.env["MEMROOS_OPERATOR_API_KEY"] = "sync-key";
    const route = await import("../skills/proposals/route");
    await loadDb();
    const res = await route.POST(
      makePost(
        "http://localhost/api/skills/proposals",
        {
          source_harness: "claude",
          skill_name: "diff-skill",
          detected_content_hash: "b".repeat(64),
          proposed_by: "scanner",
          diff_payload: ["not", "object"],
        },
        { authorization: "Bearer sync-key" }
      )
    );
    expect(res.status).toBe(400);
  });
});

describe("batch14b — /api/skills/sign", () => {
  it("404 when source_harness filter does not match registry row", async () => {
    process.env["MEMROOS_OPERATOR_API_KEY"] = "secret-key";
    const dbPath = path.join(TMP_ROOT, "sign.db");
    fs.writeFileSync(dbPath, "");
    process.env["SQLITE_DB_PATH"] = dbPath;
    vi.resetModules();
    const db = new Database(dbPath);
    initSchema(db);
    db.prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, signature, signed_by, signed_at, trust_level,
        public_key_fingerprint
      ) VALUES (
        'harness-skill', 'd', 'ops', 'claude', 'low', 'enabled',
        '1.0.0', 'none', 'read_file', '[]', 'revert',
        ?, 100, '[]', 'operator', ?, 'check', 'abc', NULL, NULL, NULL, 'unsigned', NULL
      )`
    ).run(FULL_SKILL_MD, new Date().toISOString());
    db.close();

    const signRoute = await import("../skills/sign/route");
    const res = await signRoute.POST(
      makePost(
        "http://localhost/api/skills/sign",
        { skill_name: "harness-skill", source_harness: "codex" },
        { authorization: "Bearer secret-key" }
      )
    );
    expect(res.status).toBe(404);
  });

  it("422 when registry row has no raw_body", async () => {
    process.env["MEMROOS_OPERATOR_API_KEY"] = "secret-key";
    const dbPath = path.join(TMP_ROOT, "sign-empty-body.db");
    fs.writeFileSync(dbPath, "");
    process.env["SQLITE_DB_PATH"] = dbPath;
    vi.resetModules();
    const db = new Database(dbPath);
    initSchema(db);
    db.prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, signature, signed_by, signed_at, trust_level,
        public_key_fingerprint
      ) VALUES (
        'empty-body', 'd', 'ops', 'claude', 'low', 'enabled',
        '1.0.0', 'none', 'read_file', '[]', 'revert',
        '', 100, '[]', 'operator', ?, 'check', 'abc', NULL, NULL, NULL, 'unsigned', NULL
      )`
    ).run(new Date().toISOString());
    db.close();

    const signRoute = await import("../skills/sign/route");
    const res = await signRoute.POST(
      makePost(
        "http://localhost/api/skills/sign",
        { skill_name: "empty-body" },
        { authorization: "Bearer secret-key" }
      )
    );
    expect(res.status).toBe(422);
  });

  it("falls back to plain audit insert when skill audit chain builder throws", async () => {
    process.env["MEMROOS_OPERATOR_API_KEY"] = "secret-key";
    const dbPath = path.join(TMP_ROOT, "sign-audit-fallback.db");
    fs.writeFileSync(dbPath, "");
    process.env["SQLITE_DB_PATH"] = dbPath;
    vi.resetModules();
    vi.doMock("@/lib/audit/skill-chain", () => ({
      buildSkillAuditEntry: () => {
        throw new Error("chain unavailable");
      },
    }));
    const db = new Database(dbPath);
    initSchema(db);
    db.prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, signature, signed_by, signed_at, trust_level,
        public_key_fingerprint
      ) VALUES (
        'audit-fallback', 'd', 'ops', 'claude', 'low', 'enabled',
        '1.0.0', 'none', 'read_file', '[]', 'revert',
        ?, 100, '[]', 'operator', ?, 'check', 'abc', NULL, NULL, NULL, 'unsigned', NULL
      )`
    ).run(FULL_SKILL_MD, new Date().toISOString());
    db.close();

    const signRoute = await import("../skills/sign/route");
    const res = await signRoute.POST(
      makePost(
        "http://localhost/api/skills/sign",
        { skill_name: "audit-fallback" },
        { authorization: "Bearer secret-key" }
      )
    );
    expect(res.status).toBe(200);
    const reopened = new Database(dbPath);
    const auditCount = reopened
      .prepare(`SELECT COUNT(*) AS c FROM audit_entries WHERE event_type = 'skill.signed'`)
      .get() as { c: number };
    reopened.close();
    expect(auditCount.c).toBeGreaterThan(0);
  });
});

describe("batch14b — /api/skills/quarantine/reject", () => {
  it("404 when no quarantine record exists", async () => {
    process.env["MEMROOS_OPERATOR_API_KEY"] = "right-key";
    await loadDb();
    const route = await import("../skills/quarantine/reject/route");
    const res = await route.POST(
      makePost(
        "http://localhost/api/skills/quarantine/reject",
        { skill_id: 99999, operator: "bob", reason: "missing" },
        { authorization: "Bearer right-key" }
      )
    );
    expect(res.status).toBe(404);
  });

  it("400 for invalid skill_id", async () => {
    process.env["MEMROOS_OPERATOR_API_KEY"] = "right-key";
    await loadDb();
    const route = await import("../skills/quarantine/reject/route");
    const res = await route.POST(
      makePost(
        "http://localhost/api/skills/quarantine/reject",
        { skill_id: "nope", operator: "bob", reason: "bad id" },
        { authorization: "Bearer right-key" }
      )
    );
    expect(res.status).toBe(400);
  });
});
