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

const baseInput = {
  goalId: "goal-b31-valid",
  actorAgentId: "agent-b31",
  topic: "Batch31 council",
  roles: [
    { role: "chair" as const, agentId: "agent-b31", mandate: "lead" },
    { role: "validator" as const, agentId: "agent-b31b", mandate: "validate" },
  ],
  taskBudget: { maxRounds: 2, maxAgents: 4 },
  verdict: {
    decision: "approve" as const,
    summary: "Ship",
    actionItems: ["verify"],
    risks: [],
    validatorPass: true,
  },
};

describe("gsd discuss batch31 — required field throws", () => {
  it("throws when goalId is blank (line 92)", () => {
    const database = freshDb();
    expect(() =>
      runBoundedDiscussCouncil(database, { ...baseInput, goalId: "   " }),
    ).toThrow(/goalId is required/);
  });

  it("throws when actorAgentId is blank (line 93)", () => {
    const database = freshDb();
    expect(() =>
      runBoundedDiscussCouncil(database, { ...baseInput, actorAgentId: "" }),
    ).toThrow(/actorAgentId is required/);
  });

  it("throws when topic is blank (line 94)", () => {
    const database = freshDb();
    expect(() =>
      runBoundedDiscussCouncil(database, { ...baseInput, topic: "  " }),
    ).toThrow(/topic is required/);
  });

  it("throws when roles array is empty (line 95)", () => {
    const database = freshDb();
    expect(() =>
      runBoundedDiscussCouncil(database, { ...baseInput, roles: [] }),
    ).toThrow(/roles are required/);
  });
});
