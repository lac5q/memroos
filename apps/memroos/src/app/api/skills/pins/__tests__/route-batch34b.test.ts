// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const TMP_ROOT = path.join(os.tmpdir(), `skill-pins-b34b-${randomUUID()}`);
const LOOPBACK = "http://localhost";

function jsonPost(body: unknown) {
  return new Request(`${LOOPBACK}/api/skills/pins`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  process.env.SQLITE_DB_PATH = path.join(TMP_ROOT, `${randomUUID()}.db`);
  vi.resetModules();
});

afterEach(async () => {
  try {
    const { closeDb } = await import("@/lib/db");
    closeDb();
  } catch {
    /* ignore */
  }
  delete process.env.SQLITE_DB_PATH;
  vi.resetModules();
  vi.restoreAllMocks();
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

async function insertDispatchableSkill(db: import("better-sqlite3").Database, name: string) {
  const hash = "a".repeat(64);
  const id = Number(
    db
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
         version, preconditions, allowed_tools, verification_checks, rollback_behavior,
         raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
         evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'memroos', 'low', 'enabled', '1.0.0', '', '', '', '', 'body', 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(name, new Date().toISOString(), hash).lastInsertRowid,
  );
  return { id, hash };
}

describe("/api/skills/pins batch34b", () => {
  it("GET clamps invalid pagination and applies agent_id filter", async () => {
    const { getDb } = await import("@/lib/db");
    const { initSchema } = await import("@/lib/db-schema");
    const db = getDb();
    initSchema(db);
    const agent = `agent-b34b-${randomUUID().slice(0, 6)}`;
    const skillName = `skill-b34b-${randomUUID().slice(0, 6)}`;
    const { id, hash } = await insertDispatchableSkill(db, skillName);
    db.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES (?, 'A', 'agent', 'memroos', 'local')`,
    ).run(agent);
    const gov = await import("@/lib/skills/skill-sync-governance");
    gov.createOrUpdateAgentVersionPin(db, {
      agent_id: agent,
      skill_name: skillName,
      skill_id: id,
      current_version: "1.0.0",
      current_content_hash: hash,
      actor: "operator",
    });

    const { GET } = await import("../route");
    const defaults = await GET(
      new Request(`${LOOPBACK}/api/skills/pins?limit=not-a-number&offset=-3`),
    );
    expect(defaults.status).toBe(200);
    const defaultBody = await defaults.json();
    expect(defaultBody.limit).toBe(50);
    expect(defaultBody.offset).toBe(0);

    const filtered = await GET(
      new Request(`${LOOPBACK}/api/skills/pins?agent_id=${encodeURIComponent(agent)}&skill_name=${encodeURIComponent(skillName)}&limit=5`),
    );
    const filteredBody = await filtered.json();
    expect(filteredBody.items).toHaveLength(1);
    expect(filteredBody.filters).toEqual({ agent_id: agent, skill_name: skillName });
  });

  it("POST forwards optimistic concurrency fields and numeric skill_id strings", async () => {
    const { getDb } = await import("@/lib/db");
    const { initSchema } = await import("@/lib/db-schema");
    const db = getDb();
    initSchema(db);
    const agent = `agent-pin-b34b-${randomUUID().slice(0, 6)}`;
    const skillName = `skill-pin-b34b-${randomUUID().slice(0, 6)}`;
    const { id, hash } = await insertDispatchableSkill(db, skillName);
    db.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES (?, 'A', 'agent', 'memroos', 'local')`,
    ).run(agent);

    const { POST } = await import("../route");
    const res = await POST(
      jsonPost({
        agent_id: agent,
        skill_name: skillName,
        skill_id: String(id),
        current_version: "1.0.0",
        current_content_hash: hash,
        actor: "operator-b34b",
        expected_current_updated_at: "2020-01-01T00:00:00.000Z",
        idempotency_key: `idem-${randomUUID()}`,
      }),
    );
    expect([200, 409]).toContain(res.status);
    const body = await res.json();
    expect(body.ok).toBe(res.status === 200);
  });

  it("POST maps SyncGovernanceError conflicts to 409 and generic failures to 400/500", async () => {
    const governance = await import("@/lib/skills/skill-sync-governance");
    const { POST } = await import("../route");
    const base = {
      agent_id: "agent-b34b",
      skill_name: "skill-b34b",
      current_version: "1.0.0",
      current_content_hash: "b".repeat(64),
      actor: "operator",
    };

    vi.spyOn(governance, "createOrUpdateAgentVersionPin").mockImplementationOnce(() => {
      throw new governance.SyncGovernanceError("Stale concurrent pin update for agent='a' skill='s'");
    });
    const conflict = await POST(jsonPost(base));
    expect(conflict.status).toBe(409);

    vi.spyOn(governance, "createOrUpdateAgentVersionPin").mockImplementationOnce(() => {
      throw new governance.SyncGovernanceError("skill_name must be a non-empty string");
    });
    const validation = await POST(jsonPost(base));
    expect(validation.status).toBe(400);

    vi.spyOn(governance, "createOrUpdateAgentVersionPin").mockImplementationOnce(() => {
      throw "pin blew up";
    });
    const unexpected = await POST(jsonPost(base));
    expect(unexpected.status).toBe(500);
    expect((await unexpected.json()).error).toMatch(/pin blew up/i);
  });
});
