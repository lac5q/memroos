// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { buildAgentContextPacket, readAgentRunLedger } from "@/lib/agent-context-packet";
import { createOrResumeGsdGoal } from "@/lib/agent-gsd-control";
import { initSchema } from "@/lib/db-schema";

const db = new Database(":memory:");
initSchema(db);

afterEach(() => {
  db.prepare("DELETE FROM efficiency_events").run();
  db.prepare("DELETE FROM agent_memory_traces").run();
  db.prepare("DELETE FROM hive_actions").run();
  db.prepare("DELETE FROM hive_delegations").run();
  db.prepare("DELETE FROM agent_checkpoints").run();
});

describe("agent-context-packet batch20b — ledger receipts and constraints", () => {
  it("buildAgentContextPacket throws when goalId or actorAgentId is blank", () => {
    expect(() =>
      buildAgentContextPacket(db, {
        goalId: " ",
        actorAgentId: "codex-cli-agent",
        lane: "ops",
        goalTitle: "t",
      }),
    ).toThrow(/goalId/);
    expect(() =>
      buildAgentContextPacket(db, {
        goalId: "g1",
        actorAgentId: " ",
        lane: "ops",
        goalTitle: "t",
      }),
    ).toThrow(/actorAgentId/);
  });

  it("readAgentRunLedger maps token_ledger efficiency rows into costs", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    createOrResumeGsdGoal(db, {
      goalId,
      title: "Cost ledger",
      actorAgentId: "codex-cli-agent",
      lane: "code",
    });
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, task_id, agent_id, event_type, payload, created_at)
       VALUES ('default-tenant', ?, 'codex-cli-agent', 'token_ledger', ?, datetime('now'))`,
    ).run(goalId, JSON.stringify({ modelId: "gpt-test", totalTokens: 1200 }));
    const ledger = readAgentRunLedger(db, { goalId, lane: "code" });
    expect(ledger.costs.some((c) => c.model === "gpt-test" && c.actual === 1200)).toBe(true);
  });

  it("buildAgentContextPacket includes explicit forbidden actions in constraints", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    const built = buildAgentContextPacket(db, {
      goalId,
      actorAgentId: "codex-cli-agent",
      lane: "safety",
      goalTitle: "Safety goal",
      constraints: {
        forbiddenActions: ["deploy_prod"],
        requiredVerification: ["safety_review"],
      },
    });
    expect(built.packet.constraints.forbiddenActions).toContain("deploy_prod");
    expect(built.packet.constraints.requiredVerification).toContain("safety_review");
  });

  it("packet receipts include below_threshold retrieval traces without sources", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    createOrResumeGsdGoal(db, {
      goalId,
      title: "Trace goal",
      actorAgentId: "codex-cli-agent",
      lane: "research",
    });
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, task_id, agent_id, event_type, payload, created_at)
       VALUES ('default-tenant', ?, 'codex-cli-agent', 'retrieval_trace', ?, datetime('now'))`,
    ).run(goalId, JSON.stringify({ sources: [] }));
    const built = buildAgentContextPacket(db, {
      goalId,
      actorAgentId: "codex-cli-agent",
      lane: "research",
      goalTitle: "Trace goal",
    });
    expect(
      built.packet.receipts.some(
        (r) => r.source === "efficiency_events" && r.status === "below_threshold",
      ),
    ).toBe(true);
  });
});
