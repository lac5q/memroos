// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  asGsdLane,
  createOrResumeGsdGoal,
  gsdInputFromJson,
  gsdStringArray,
  runGsdShipcheck,
} from "@/lib/agent-gsd-control";
import { initSchema } from "@/lib/db-schema";

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

describe("agent-gsd-control batch35b — lane helpers and shipcheck branches", () => {
  it("asGsdLane returns undefined for invalid lane strings (139-141)", () => {
    expect(asGsdLane("not-a-lane")).toBeUndefined();
    expect(asGsdLane("code")).toBe("code");
  });

  it("gsdStringArray filters blank strings (503+ via gsdStringArray export)", () => {
    expect(gsdStringArray(["  ", "proof-b35b", 12, ""])).toEqual(["proof-b35b"]);
  });

  it("gsdInputFromJson returns {} for non-object inputs (499-501)", () => {
    expect(gsdInputFromJson("not-json")).toEqual({});
    expect(gsdInputFromJson(["lane"])).toEqual({});
    expect(gsdInputFromJson({ lane: "ops" })).toEqual({ lane: "ops" });
  });

  it("runGsdShipcheck blocks when proof missing and no bypass (314-323)", () => {
    const database = freshDb();
    const goal = createOrResumeGsdGoal(database, {
      title: `ship-block-b35b-${randomUUID().slice(0, 6)}`,
      actorAgentId: "codex-cli-agent",
      lane: "code",
    });
    const result = runGsdShipcheck(database, {
      goalId: goal.goalId,
      actorAgentId: "codex-cli-agent",
      lane: "code",
    });
    expect(result.status).toBe("blocked");
    expect(result.missingProof.length).toBeGreaterThan(0);
  });

  it("runGsdShipcheck rejects short bypass reasons (326-335)", () => {
    const database = freshDb();
    const goal = createOrResumeGsdGoal(database, {
      title: `ship-bypass-b35b-${randomUUID().slice(0, 6)}`,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
    });
    const result = runGsdShipcheck(database, {
      goalId: goal.goalId,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
      bypassReason: "short",
    });
    expect(result.status).toBe("blocked");
    expect(result.message).toMatch(/at least 8 characters/i);
  });

  it("runGsdShipcheck bypasses with a long explicit reason (338+)", () => {
    const database = freshDb();
    const goal = createOrResumeGsdGoal(database, {
      title: `ship-bypass-ok-b35b-${randomUUID().slice(0, 6)}`,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
    });
    const result = runGsdShipcheck(database, {
      goalId: goal.goalId,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
      bypassReason: "batch35b bypass proof for ops lane",
    });
    expect(result.status).toBe("bypassed");
    expect(result.receiptId).toBeGreaterThan(0);
  });
});
