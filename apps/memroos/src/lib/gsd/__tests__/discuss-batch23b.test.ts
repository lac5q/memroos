// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runBoundedDiscussCouncil } from "@/lib/gsd/discuss";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
});

const baseVerdict = {
  decision: "approve" as const,
  summary: "Ready to ship",
  actionItems: ["verify"],
  risks: [],
  validatorPass: true,
};

describe("gsd discuss batch23b — council guardrail branches", () => {
  it("blocks when roles exceed taskBudget.maxAgents", () => {
    const database = freshDb();
    const result = runBoundedDiscussCouncil(database, {
      goalId: "goal-roles",
      actorAgentId: "agent-a",
      topic: "Role cap",
      roles: [
        { role: "chair", agentId: "agent-a", mandate: "lead" },
        { role: "researcher", agentId: "agent-b", mandate: "research" },
        { role: "validator", agentId: "agent-c", mandate: "validate" },
      ],
      taskBudget: { maxRounds: 2, maxAgents: 2 },
      verdict: baseVerdict,
    });
    expect(result.blockedReasons.some((r) => r.includes("roles exceed"))).toBe(true);
    expect(result.ledgerReceiptId).toBe(0);
  });

  it("blocks when validator role is missing from assignments", () => {
    const database = freshDb();
    const result = runBoundedDiscussCouncil(database, {
      goalId: "goal-no-validator",
      actorAgentId: "agent-a",
      topic: "Missing validator",
      roles: [{ role: "chair", agentId: "agent-a", mandate: "lead" }],
      taskBudget: { maxRounds: 2, maxAgents: 4 },
      verdict: baseVerdict,
    });
    expect(result.blockedReasons).toContain("validator role is required.");
  });

  it("blocks when verdict summary is blank", () => {
    const database = freshDb();
    const result = runBoundedDiscussCouncil(database, {
      goalId: "goal-summary",
      actorAgentId: "agent-a",
      topic: "Summary required",
      roles: [
        { role: "chair", agentId: "agent-a", mandate: "lead" },
        { role: "validator", agentId: "agent-b", mandate: "validate" },
      ],
      taskBudget: { maxRounds: 2, maxAgents: 4 },
      verdict: { ...baseVerdict, summary: "   " },
    });
    expect(result.blockedReasons).toContain("verdict.summary is required.");
  });

  it("blocks when maxAgents is outside bounded range", () => {
    const database = freshDb();
    const result = runBoundedDiscussCouncil(database, {
      goalId: "goal-agents",
      actorAgentId: "agent-a",
      topic: "Agent bounds",
      roles: [
        { role: "chair", agentId: "agent-a", mandate: "lead" },
        { role: "validator", agentId: "agent-b", mandate: "validate" },
      ],
      taskBudget: { maxRounds: 2, maxAgents: 1 },
      verdict: baseVerdict,
    });
    expect(result.blockedReasons.some((r) => r.includes("maxAgents"))).toBe(true);
  });
});
