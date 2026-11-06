// @vitest-environment node
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { getSkillDependencyView } from "../skill-dependencies";

describe("skill-dependencies batch22b — capabilities, marketplace, dispatch", () => {
  it("includes capability and marketplace provenance plus dispatch receipts", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `dep-b22b-${crypto.randomUUID().slice(0, 6)}`;
    const body = `body-${crypto.randomUUID().slice(0, 6)}`;
    const skillId = Number(
      db
        .prepare(
          `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
            version, preconditions, allowed_tools, verification_checks, rollback_behavior,
            raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
            evidence_examples, content_hash, trust_level)
           VALUES (?, '', 'ops', 'memroos', 'low', 'enabled', '2.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
        )
        .run(name, body, new Date().toISOString(), crypto.createHash("sha256").update(body).digest("hex"))
        .lastInsertRowid,
    );
    db.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES ('agent-cap-b22b', 'Cap', 'agent', 'memroos', 'local')`,
    ).run();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO agent_capabilities (agent_id, capability_id, name, description, tags, created_at, updated_at)
       VALUES ('agent-cap-b22b', ?, ?, 'cap desc', '[]', ?, ?)`,
    ).run(name, name, now, now);
    db.prepare(
      `INSERT INTO skill_marketplace (id, skill_id, name, description, author, tags, version, changelog, rating, review_count, download_count, category, published_at, updated_at, deprecated)
       VALUES (?, ?, ?, 'd', 'a', '[]', '2.0.0', 'c', 0, 0, 0, 'general', ?, ?, 0)`,
    ).run(`market-${crypto.randomUUID()}`, String(skillId), name, now, now);
    const view = getSkillDependencyView(db, skillId);
    expect(view.trusted.some((row) => row.provenance === "marketplace")).toBe(true);
    expect(view.observed.some((row) => row.provenance === "capability")).toBe(true);
    db.close();
  });

  it("loadTrustPins falls back to skill_name when skill_id pins are absent", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `pin-name-b22b-${crypto.randomUUID().slice(0, 6)}`;
    const body = "pin body";
    const skillId = Number(
      db
        .prepare(
          `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
            version, preconditions, allowed_tools, verification_checks, rollback_behavior,
            raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
            evidence_examples, content_hash, trust_level)
           VALUES (?, '', 'ops', 'memroos', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
        )
        .run(name, body, new Date().toISOString(), crypto.createHash("sha256").update(body).digest("hex"))
        .lastInsertRowid,
    );
    db.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES ('agent-pin-b22b', 'Pin', 'agent', 'memroos', 'local')`,
    ).run();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skill_version_pins (agent_id, skill_name, current_version, current_content_hash, actor, created_at, updated_at)
       VALUES ('agent-pin-b22b', ?, '1.0.0', ?, 'operator', ?, ?)`,
    ).run(name, "d".repeat(64), now, now);
    const view = getSkillDependencyView(db, skillId);
    expect(view.trusted.some((row) => row.provenance === "pin")).toBe(true);
    db.close();
  });
});
