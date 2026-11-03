// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildAgentContextPacket, readAgentRunLedger } from "@/lib/agent-context-packet";
import { initSchema } from "@/lib/db-schema";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  initSchema(db);
});

afterEach(() => {
  db.close();
});

describe("agent-context-packet batch27 — verification defaults, trace allow, artifact object", () => {
  it("uses checkpoint verification keys when explicit requiredVerification is empty", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO agent_checkpoints
         (id, tenant_id, run_id, owner_agent_id, objective, completed_steps_json, remaining_steps_json,
          decisions_json, artifact_refs_json, verification_state_json, next_safe_action, rollback_notes,
          provenance_pointers_json, checkpoint_size, write_latency_ms, created_at)
       VALUES (?, 'default-tenant', ?, 'worker', 'Verify', '[]', '[]', '{}', '[]', ?, 'continue', NULL, '[]', 1, 1, datetime('now'))`,
    ).run(randomUUID(), goalId, JSON.stringify({ typecheck: "pending", lint: "passed" }));
    const built = buildAgentContextPacket(db, {
      goalId,
      actorAgentId: "codex-cli-agent",
      lane: "code",
      constraints: { requiredVerification: [] },
    });
    expect(built.packet.constraints.requiredVerification).toEqual(expect.arrayContaining(["typecheck", "lint"]));
  });

  it("maps included trace receipts for allow decisions and single-object artifact refs", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO agent_memory_traces
         (id, tenant_id, run_id, task_id, causal_path_json, created_at)
       VALUES (?, 'default-tenant', ?, ?, ?, datetime('now'))`,
    ).run(
      randomUUID(),
      goalId,
      goalId,
      JSON.stringify({ policyFilters: [{ decision: "allow", reason: "policy ok batch27" }] }),
    );
    db.prepare(
      `INSERT INTO agent_checkpoints
         (id, tenant_id, run_id, owner_agent_id, objective, completed_steps_json, remaining_steps_json,
          decisions_json, artifact_refs_json, verification_state_json, next_safe_action, rollback_notes,
          provenance_pointers_json, checkpoint_size, write_latency_ms, created_at)
       VALUES (?, 'default-tenant', ?, 'worker', 'Artifacts', '[]', '[]', '{}', ?, '{}', 'continue', NULL, '[]', 1, 1, datetime('now'))`,
    ).run(
      randomUUID(),
      goalId,
      JSON.stringify({ id: "artifact-b27", path: "/tmp/b27-artifact", hash: "deadbeef" }),
    );
    const built = buildAgentContextPacket(db, {
      goalId,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
    });
    expect(
      built.packet.receipts.some((r) => r.status === "included" && r.reason === "policy ok batch27"),
    ).toBe(true);
    const ledger = readAgentRunLedger(db, { goalId, lane: "ops" });
    expect(ledger.artifacts.some((a) => a.id === "artifact-b27" && a.hash === "deadbeef")).toBe(true);
  });
});
