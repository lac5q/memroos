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

describe("skill-dependencies batch31 — pins, observations, missing registry", () => {
  // unreachable: isObservationProvenance / isTrustedProvenance (132, 136) — no call sites in module.
  // unreachable: loadCapabilitiesReferencing early return (260) — only invoked after registry row exists.

  it("observed rows carry observation flags for capability + report provenance", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `dep-b31-${crypto.randomUUID().slice(0, 8)}`;
    const body = `body-${crypto.randomUUID().slice(0, 8)}`;
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
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES ('agent-b31', 'Cap', 'agent', 'memroos', 'local')`,
    ).run();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO agent_capabilities (agent_id, capability_id, name, description, tags, created_at, updated_at)
       VALUES ('agent-b31', ?, ?, 'batch31 capability', '[]', ?, ?)`,
    ).run(name, name, now, now);
    db.prepare(
      `INSERT INTO agent_skill_reports (agent_id, skill_id, action, metadata, reported_at)
       VALUES ('agent-b31', ?, 'observed', '{"observed_state":"enabled"}', ?)`,
    ).run(name, now);

    const view = getSkillDependencyView(db, skillId);
    expect(view.observed.filter((r) => r.provenance === "capability")).toHaveLength(1);
    expect(view.observed.filter((r) => r.provenance === "report")).toHaveLength(1);
    expect(view.observed.every((r) => r.is_observation && !r.is_trusted)).toBe(true);
    expect(summarizeDependencyView(view).observed_count).toBeGreaterThanOrEqual(2);

    const reverse = getReverseDependencyView(db, skillId);
    expect(reverse.some((r) => r.via === "capability" && r.is_observation)).toBe(true);
    expect(reverse.some((r) => r.via === "report" && r.is_observation)).toBe(true);
    db.close();
  });

  it("loadTrustPins resolves pins keyed only by skill_name when skill_id is unset (168)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `pin-b31-${crypto.randomUUID().slice(0, 8)}`;
    const body = `body-${crypto.randomUUID().slice(0, 8)}`;
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
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES ('agent-pin-b31', 'Pin', 'agent', 'memroos', 'local')`,
    ).run();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skill_version_pins (agent_id, skill_name, current_version, current_content_hash, actor, created_at, updated_at)
       VALUES ('agent-pin-b31', ?, '1.0.0', ?, 'operator', ?, ?)`,
    ).run(name, "a".repeat(64), now, now);

    const view = getSkillDependencyView(db, skillId);
    expect(view.trusted.some((row) => row.provenance === "pin" && row.is_trusted)).toBe(true);
    db.close();
  });

  it("returns empty observed/trusted slices when registry id is unknown", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const view = getSkillDependencyView(db, 515151);
    expect(view.forward_consistency.ok).toBe(false);
    expect(view.trusted).toHaveLength(0);
    expect(view.observed).toHaveLength(0);
    db.close();
  });
});
