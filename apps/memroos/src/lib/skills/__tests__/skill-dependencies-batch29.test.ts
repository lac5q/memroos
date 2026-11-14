// @vitest-environment node
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { getSkillDependencyView } from "../skill-dependencies";

describe("skill-dependencies batch29 — loadTrustPins name fallback", () => {
  it("loadTrustPins falls back to skill_name query when skill_id pins missing (lines 168–177)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `dep-b29-${crypto.randomUUID().slice(0, 6)}`;
    const body = `body-${crypto.randomUUID().slice(0, 6)}`;
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
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES ('agent-pin-b29', 'Pin', 'agent', 'memroos', 'local')`,
    ).run();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skill_version_pins (agent_id, skill_name, current_version, current_content_hash, actor, created_at, updated_at)
       VALUES ('agent-pin-b29', ?, '1.0.0', ?, 'operator', ?, ?)`,
    ).run(name, "c".repeat(64), now, now);
    const view = getSkillDependencyView(db, skillId);
    expect(view.trusted.some((row) => row.provenance === "pin")).toBe(true);
    db.close();
  });
});
