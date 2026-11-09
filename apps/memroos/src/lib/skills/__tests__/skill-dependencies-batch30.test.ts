// @vitest-environment node
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  getReverseDependencyView,
  getSkillDependencyView,
  summarizeDependencyView,
} from "../skill-dependencies";

describe("skill-dependencies batch30 — provenance classes and reverse view", () => {
  it("places capability and report rows in observed-only provenance (132, 136)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `dep-b30-${crypto.randomUUID().slice(0, 6)}`;
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
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES ('agent-b30', 'Cap', 'agent', 'memroos', 'local')`,
    ).run();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO agent_capabilities (agent_id, capability_id, name, description, tags, created_at, updated_at)
       VALUES ('agent-b30', ?, ?, 'batch30 capability', '[]', ?, ?)`,
    ).run(name, name, now, now);
    db.prepare(
      `INSERT INTO agent_skill_reports (agent_id, skill_id, action, metadata, reported_at)
       VALUES ('agent-b30', ?, 'observed', '{"observed_state":"enabled"}', ?)`,
    ).run(name, now);

    const view = getSkillDependencyView(db, skillId);
    const cap = view.observed.find((row) => row.provenance === "capability");
    const report = view.observed.find((row) => row.provenance === "report");
    expect(cap?.is_observation).toBe(true);
    expect(cap?.is_trusted).toBe(false);
    expect(report?.is_observation).toBe(true);
    expect(view.trusted.every((row) => row.is_trusted)).toBe(true);

    const summary = summarizeDependencyView(view);
    expect(summary.observed_count).toBeGreaterThanOrEqual(2);

    const reverse = getReverseDependencyView(db, skillId);
    expect(reverse.some((row) => row.via === "capability" && row.is_observation)).toBe(true);
    expect(reverse.some((row) => row.via === "report" && row.is_observation)).toBe(true);
    db.close();
  });

  it("loadTrustPins uses skill_name fallback when skill_id pins are absent (168)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `pin-b30-${crypto.randomUUID().slice(0, 6)}`;
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
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES ('agent-pin-b30', 'Pin', 'agent', 'memroos', 'local')`,
    ).run();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skill_version_pins (agent_id, skill_name, current_version, current_content_hash, actor, created_at, updated_at)
       VALUES ('agent-pin-b30', ?, '1.0.0', ?, 'operator', ?, ?)`,
    ).run(name, "e".repeat(64), now, now);
    const view = getSkillDependencyView(db, skillId);
    expect(view.trusted.some((row) => row.provenance === "pin")).toBe(true);
    db.close();
  });

  it("returns empty capability rows when registry row is missing (260 via missing skill)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const view = getSkillDependencyView(db, 424242);
    expect(view.forward_consistency.ok).toBe(false);
    expect(view.observed).toHaveLength(0);
    db.close();
  });
});
