// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildAgentContextPacket } from "@/lib/agent-context-packet";
import { initSchema } from "@/lib/db-schema";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  initSchema(db);
});

afterEach(() => {
  db.close();
});

describe("agent-context-packet batch37b — status, trace deny, retrieval empty sources", () => {
  it("statusFor maps failed hive_delegations to blocked (263)", () => {
    const goalId = `goal-failed-b37b-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO hive_delegations (task_id, from_agent, to_agent, task_summary, status, created_at, updated_at)
       VALUES (?, 'director', 'codex', 'failed delegation batch37b', 'failed', datetime('now'), datetime('now'))`,
    ).run(goalId);
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent" });
    expect(built.packet.goal.status).toBe("blocked");
  });

  it("traceReceipts marks policy deny decisions (312)", () => {
    const goalId = `goal-deny-b37b-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO agent_memory_traces
         (id, tenant_id, run_id, task_id, agent_id, causal_path_json, created_at)
       VALUES (?, 'default-tenant', ?, ?, 'codex', ?, datetime('now'))`,
    ).run(
      randomUUID(),
      goalId,
      goalId,
      JSON.stringify({
        policyFilters: [{ decision: "deny", reason: "batch37b policy deny" }],
      }),
    );
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent" });
    expect(
      built.packet.receipts.some(
        (r) => r.source === "agent_memory_traces" && r.status === "denied" && /batch37b policy deny/i.test(r.reason ?? ""),
      ),
    ).toBe(true);
  });

  it("efficiencyReceipts uses below_threshold when retrieval_trace has no sources (335-337)", () => {
    const goalId = `goal-rt-empty-b37b-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, task_id, agent_id, event_type, payload, created_at)
       VALUES ('default-tenant', ?, 'codex', 'retrieval_trace', ?, datetime('now'))`,
    ).run(goalId, JSON.stringify({ sources: [] }));
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent" });
    expect(
      built.packet.receipts.some(
        (r) => r.status === "below_threshold" && /no source references/i.test(r.reason ?? ""),
      ),
    ).toBe(true);
  });

  it("requiredVerificationFrom uses checkpoint verification keys when explicit list empty (271-273)", () => {
    const goalId = `goal-ver-b37b-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO agent_checkpoints
         (id, tenant_id, run_id, owner_agent_id, objective, verification_state_json, artifact_refs_json,
          decisions_json, next_safe_action, created_at)
       VALUES (?, 'default-tenant', ?, 'codex', 'verify batch37b', ?, '[]', '{}', 'resume', datetime('now'))`,
    ).run(randomUUID(), goalId, JSON.stringify({ "npm test": "pending" }));
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent" });
    expect(built.packet.constraints.requiredVerification).toContain("npm test");
  });
});