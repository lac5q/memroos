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

describe("agent-context-packet batch28 — deny receipts and trace without filters", () => {
  it("maps policy filter deny decisions to denied receipts", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO agent_memory_traces
         (id, tenant_id, run_id, task_id, causal_path_json, created_at)
       VALUES (?, 'default-tenant', ?, ?, ?, datetime('now'))`,
    ).run(
      randomUUID(),
      goalId,
      goalId,
      JSON.stringify({ policyFilters: [{ decision: "deny", reason: "policy blocked batch28" }] }),
    );
    const built = buildAgentContextPacket(db, {
      goalId,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
    });
    expect(built.packet.receipts.some((r) => r.status === "denied" && r.reason === "policy blocked batch28")).toBe(
      true,
    );
  });

  it("emits skipped trace receipt when causal path has no policy filters", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO agent_memory_traces
         (id, tenant_id, run_id, task_id, causal_path_json, created_at)
       VALUES (?, 'default-tenant', ?, ?, ?, datetime('now'))`,
    ).run(randomUUID(), goalId, goalId, JSON.stringify({ hops: [] }));
    const built = buildAgentContextPacket(db, {
      goalId,
      actorAgentId: "codex-cli-agent",
      lane: "code",
    });
    expect(
      built.packet.receipts.some(
        (r) => r.source === "agent_memory_traces" && r.status === "skipped" && /no policy filter/i.test(r.reason ?? ""),
      ),
    ).toBe(true);
  });
});
