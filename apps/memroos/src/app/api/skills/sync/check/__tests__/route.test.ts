// @vitest-environment node
/**
 * Route tests for POST /api/skills/sync/check
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const TMP_ROOT = path.join(
  os.tmpdir(),
  `skill-sync-check-route-${crypto.randomUUID()}`
);

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
  try {
    const dbModule = await import("@/lib/db");
    dbModule.closeDb();
  } catch {
    /* ignore */
  }
  vi.resetModules();
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

async function loadDb() {
  const { getDb } = await import("@/lib/db");
  const { initSchema } = await import("@/lib/db-schema");
  const db = getDb();
  initSchema(db);
  return db;
}

async function loadRoute() {
  return import("../route");
}

function makeHarnessRoots() {
  const roots = {
    claude: path.join(TMP_ROOT, "claude"),
    codex: path.join(TMP_ROOT, "codex"),
    hermes: path.join(TMP_ROOT, "hermes"),
    opencode: path.join(TMP_ROOT, "opencode"),
  };
  for (const dir of Object.values(roots)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return roots;
}

function writeSkillMd(root: string, filename: string, body: string) {
  fs.writeFileSync(path.join(root, filename), body, "utf8");
}

function makePost(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/skills/sync/check", () => {
  it("400 on invalid JSON body", async () => {
    process.env["MEMROOS_OPERATOR_API_KEY"] = "right-key";
    await loadDb();
    const route = await loadRoute();
    const res = await route.POST(
      new Request("https://example.com/api/skills/sync/check", {
        method: "POST",
        headers: { authorization: "Bearer right-key", "content-type": "application/json" },
        body: "{",
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Invalid JSON/i);
  });

  it("400 when body is not an object", async () => {
    process.env["MEMROOS_OPERATOR_API_KEY"] = "right-key";
    await loadDb();
    const route = await loadRoute();
    const res = await route.POST(
      makePost("https://example.com/api/skills/sync/check", "not-an-object", {
        authorization: "Bearer right-key",
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Body must be an object/i);
  });

  it("401 without operator key on non-loopback host", async () => {
    delete process.env["MEMROOS_OPERATOR_API_KEY"];
    await loadDb();
    const route = await loadRoute();
    const roots = makeHarnessRoots();
    const res = await route.POST(
      makePost("https://example.com/api/skills/sync/check", { roots })
    );
    expect(res.status).toBe(401);
  });

  it("403 with wrong operator key", async () => {
    process.env["MEMROOS_OPERATOR_API_KEY"] = "right-key";
    await loadDb();
    const route = await loadRoute();
    const roots = makeHarnessRoots();
    const res = await route.POST(
      makePost(
        "https://example.com/api/skills/sync/check",
        { roots },
        { authorization: "Bearer wrong-key" }
      )
    );
    expect(res.status).toBe(403);
  });

  it("400 when roots object is missing", async () => {
    process.env["MEMROOS_OPERATOR_API_KEY"] = "right-key";
    await loadDb();
    const route = await loadRoute();
    const res = await route.POST(
      makePost(
        "https://example.com/api/skills/sync/check",
        {},
        { authorization: "Bearer right-key" }
      )
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/roots is required/i);
  });

  it("400 when a harness root path is empty", async () => {
    process.env["MEMROOS_OPERATOR_API_KEY"] = "right-key";
    await loadDb();
    const route = await loadRoute();
    const roots = makeHarnessRoots();
    roots.claude = "";
    const res = await route.POST(
      makePost(
        "https://example.com/api/skills/sync/check",
        { roots },
        { authorization: "Bearer right-key" }
      )
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/roots\.claude/i);
  });

  it("400 when proposed_by is not a string", async () => {
    process.env["MEMROOS_OPERATOR_API_KEY"] = "right-key";
    await loadDb();
    const route = await loadRoute();
    const roots = makeHarnessRoots();
    const res = await route.POST(
      makePost(
        "https://example.com/api/skills/sync/check",
        { roots, proposed_by: 123 },
        { authorization: "Bearer right-key" }
      )
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/proposed_by must be a string/i);
  });

  it("200 scans harness dirs and creates drift proposals", async () => {
    process.env["MEMROOS_OPERATOR_API_KEY"] = "right-key";
    const db = await loadDb();
    const roots = makeHarnessRoots();

    const skillBody = `---
name: drift-check-skill
version: 2.0.0
---
## Preconditions
none
`;
    writeSkillMd(roots.claude, "drift-check-skill.md", skillBody);

    db.prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, signature, signed_by, signed_at, trust_level,
        public_key_fingerprint
      ) VALUES (
        'drift-check-skill', 'old', 'ops', 'claude', 'low', 'enabled',
        '1.0.0', 'none', 'read_file', 'verify', 'revert',
        'old body', 100, '[]', 'operator', ?, 'check', ?, NULL, NULL, NULL, 'unsigned', NULL
      )`
    ).run(new Date().toISOString(), "0".repeat(64));

    const route = await loadRoute();
    const res = await route.POST(
      makePost(
        "https://example.com/api/skills/sync/check",
        { roots, proposed_by: "test-scanner" },
        { authorization: "Bearer right-key" }
      )
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.detected).toBeGreaterThanOrEqual(1);
    expect(json.created).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(json.errors)).toBe(true);

    const pending = db
      .prepare(
        `SELECT pending_proposal_id, pending_proposed_by
           FROM skill_sync_state
          WHERE skill_name = 'drift-check-skill' AND source_harness = 'claude'`
      )
      .get() as { pending_proposal_id: string | null; pending_proposed_by: string | null };
    expect(pending.pending_proposal_id).toBeTruthy();
    expect(pending.pending_proposed_by).toBe("test-scanner");
  });

  it("200 reports unchanged when registry matches filesystem", async () => {
    process.env["MEMROOS_OPERATOR_API_KEY"] = "right-key";
    const db = await loadDb();
    const roots = makeHarnessRoots();
    const skillBody = `---
name: unchanged-skill
version: 1.0.0
---
same content
`;
    writeSkillMd(roots.codex, "unchanged-skill.md", skillBody);
    const hash = crypto.createHash("sha256").update(skillBody, "utf8").digest("hex");

    db.prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, signature, signed_by, signed_at, trust_level,
        public_key_fingerprint
      ) VALUES (
        'unchanged-skill', 'desc', 'ops', 'codex', 'low', 'enabled',
        '1.0.0', 'none', 'read_file', 'verify', 'revert',
        ?, 100, '[]', 'operator', ?, 'check', ?, NULL, NULL, NULL, 'unsigned', NULL
      )`
    ).run(skillBody, new Date().toISOString(), hash);

    const route = await loadRoute();
    const res = await route.POST(
      makePost(
        "https://example.com/api/skills/sync/check",
        { roots },
        { authorization: "Bearer right-key" }
      )
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.unchanged).toBeGreaterThanOrEqual(1);
    expect(json.created).toBe(0);
  });
});
