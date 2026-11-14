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

describe("agent-context-packet batch37 — decisions, receipts, ledger costs", () => {
  it("decisionsFrom serializes object decision values (280-281)", () => {
    const goalId = `goal-dec-obj-b37-${randomUUID().slice(0, 8)}`;
    const decisionKey = `choice-b37-${randomUUID().slice(0, 6)}`;
    db.prepare(
      `INSERT INTO agent_checkpoints
         (id, tenant_id, run_id, owner_agent_id, objective, decisions_json, artifact_refs_json,
          verification_state_json, next_safe_action, created_at)
       VALUES (?, 'default-tenant', ?, 'codex', 'object decision', ?, '[]', '{}', 'resume', datetime('now'))`,
    ).run(randomUUID(), goalId, JSON.stringify({ [decisionKey]: { route: "batch37", ok: true } }));
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent" });
    const hit = built.packet.decisions.find((d) => d.id === decisionKey);
    expect(hit?.summary).toContain("batch37");
    expect(hit?.source).toMatch(/agent_checkpoints:/);
  });

  it("traceReceipts emits skipped receipt when trace has no policy filters (317-323)", () => {
    const goalId = `goal-trace-skip-b37-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO agent_memory_traces
         (id, tenant_id, run_id, task_id, agent_id, causal_path_json, created_at)
       VALUES (?, 'default-tenant', ?, ?, 'codex', ?, datetime('now'))`,
    ).run(randomUUID(), goalId, goalId, JSON.stringify({ hops: ["batch37-no-filters"] }));
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent" });
    expect(
      built.packet.receipts.some(
        (r) => r.source === "agent_memory_traces" && r.status === "skipped" && /no policy filter/i.test(r.reason ?? ""),
      ),
    ).toBe(true);
  });

  it("efficiencyReceipts includes retrieval_trace when sources present (332-337)", () => {
    const goalId = `goal-trace-src-b37-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, task_id, agent_id, event_type, payload, created_at)
       VALUES ('default-tenant', ?, 'codex', 'retrieval_trace', ?, datetime('now'))`,
    ).run(goalId, JSON.stringify({ sources: [{ id: "src-b37", tier: "vector" }] }));
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent" });
    expect(
      built.packet.receipts.some(
        (r) =>
          r.status === "included" &&
          r.source === "efficiency_events" &&
          /retrieval trace recorded/i.test(r.reason ?? ""),
      ),
    ).toBe(true);
  });

  it("readAgentRunLedger maps approved audit events (462-463)", () => {
    const goalId = `goal-approved-b37-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO audit_entries
         (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, created_at)
       VALUES ('default-tenant', 'op', 'operator', 'skillforge.promoted', 'proposal', ?, 'approved batch37', datetime('now'))`,
    ).run(goalId);
    const ledger = readAgentRunLedger(db, { goalId });
    expect(ledger.approvals.some((a) => a.status === "approved")).toBe(true);
  });

  it("readAgentRunLedger collects token_ledger costs (476-484)", () => {
    const goalId = `goal-tokens-b37-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, task_id, agent_id, event_type, payload, created_at)
       VALUES ('default-tenant', ?, 'codex', 'token_ledger', ?, datetime('now'))`,
    ).run(goalId, JSON.stringify({ modelId: "gpt-batch37", totalTokens: 2048 }));
    const ledger = readAgentRunLedger(db, { goalId });
    const cost = ledger.costs.find((c) => c.model === "gpt-batch37");
    expect(cost?.model).toBe("gpt-batch37");
    expect(cost?.actual).toBe(2048);
  });
});