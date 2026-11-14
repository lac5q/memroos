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

describe("agent-context-packet batch35b — status, receipts, ledger arms", () => {
  it("buildAgentContextPacket rejects blank goalId (513)", () => {
    expect(() =>
      buildAgentContextPacket(db, { goalId: "   ", actorAgentId: "codex-cli-agent" }),
    ).toThrow(/goalId is required/i);
  });

  it("statusFor maps failed delegation to blocked goal (262-263)", () => {
    const goalId = `goal-fail-b35b-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO hive_delegations (task_id, from_agent, to_agent, task_summary, status, created_at, updated_at)
       VALUES (?, 'director', 'codex', 'failed batch35b', 'failed', datetime('now'), datetime('now'))`,
    ).run(goalId);
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent", lane: "ops" });
    expect(built.packet.goal.status).toBe("blocked");
  });

  it("traceReceipts maps deny policy filters (309-313)", () => {
    const goalId = `goal-deny-b35b-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO agent_memory_traces
         (id, tenant_id, run_id, task_id, agent_id, causal_path_json, created_at)
       VALUES (?, 'default-tenant', ?, ?, 'codex', ?, datetime('now'))`,
    ).run(
      randomUUID(),
      goalId,
      goalId,
      JSON.stringify({ policyFilters: [{ decision: "deny", reason: "batch35b deny arm" }] }),
    );
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent" });
    expect(built.packet.receipts.some((r) => r.status === "denied" && /batch35b deny/i.test(r.reason ?? ""))).toBe(true);
  });

  it("efficiencyReceipts marks retrieval_trace with zero sources below_threshold (332-336)", () => {
    const goalId = `goal-below-b35b-${randomUUID().slice(0, 8)}`;
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

  it("ledger approval mapping includes bypassed audits (460-466)", () => {
    const goalId = `goal-bypass-b35b-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO audit_entries
         (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, created_at)
       VALUES ('default-tenant', 'op', 'operator', 'skillforge.bypass', 'proposal', ?, 'bypass batch35b', datetime('now'))`,
    ).run(goalId);
    const ledger = readAgentRunLedger(db, { goalId, lane: "code" });
    expect(ledger.approvals.some((a) => a.status === "bypassed")).toBe(true);
  });

  it("handoff packs resolve snake_case resume markers (500-502)", () => {
    const goalId = `goal-handoff-b35b-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO agent_handoff_packs
         (id, tenant_id, task_id, title, status, context_pack_json, source_capture_ids_json, token_budget, redaction_state, created_at)
       VALUES (?, 'default-tenant', ?, 'handoff b35b', 'ready', ?, '[]', 4000, 'none', datetime('now'))`,
    ).run(
      randomUUID(),
      goalId,
      JSON.stringify({ resume_marker: "resume-snake-b35b", next_action: "run tests" }),
    );
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent" });
    expect(built.packet.recentRunState.handoff).toBe("resume-snake-b35b");
    expect(built.ledger.handoffs[0]?.nextAction).toBe("run tests");
  });

  it("artifactEntriesFromJson maps url kind when record has url (293-297)", () => {
    const goalId = `goal-url-b35b-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO agent_checkpoints
         (id, tenant_id, run_id, owner_agent_id, objective, artifact_refs_json, decisions_json, verification_state_json, next_safe_action, created_at)
       VALUES (?, 'default-tenant', ?, 'codex', 'url artifact', ?, '{}', '{}', 'resume', datetime('now'))`,
    ).run(randomUUID(), goalId, JSON.stringify([{ url: "http://localhost/proof-b35b" }]));
    const ledger = readAgentRunLedger(db, { goalId });
    expect(ledger.artifacts.some((a) => a.kind === "url")).toBe(true);
  });
});
