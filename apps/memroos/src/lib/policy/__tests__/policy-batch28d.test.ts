// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { authorizeMemoryUse } from "@/lib/memory/policy-gate";

import { matchDimensions, type PolicyDimensionRule } from "../dimensions";
import { evaluatePolicy } from "../engine";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  initSchema(db);
});

afterEach(() => {
  db.close();
});

describe("policy batch28d — dimensions agentId and engine tightening", () => {
  it("matchDimensions honors agentId scalar equality", () => {
    const rule: PolicyDimensionRule = {
      subject: { agentId: "agent-batch28d" },
      effect: "deny",
    };
    expect(matchDimensions(rule, { subject: { agentId: "agent-batch28d" } })).toBe(true);
    expect(matchDimensions(rule, { subject: { agentId: "other-agent" } })).toBe(false);
  });

  it("matchDimensions treats empty action arrays as non-wildcard", () => {
    const rule: PolicyDimensionRule = { action: [], effect: "deny" };
    expect(matchDimensions(rule, { action: "memory.read" })).toBe(true);
  });

  it("evaluatePolicy applies manifest dimension deny without changing wrapped memoryUse", () => {
    const memoryUse = {
      actor: { id: "agent:gtm", role: "agent" as const },
      purpose: "export" as const,
      label: {
        visibility: "internal" as const,
        domain: "client" as const,
        sensitivity: "privileged" as const,
        policy: "agent_visible" as const,
      },
    };
    const evaluation = evaluatePolicy({
      domain: "memory-use",
      action: "export.client",
      actor: { id: memoryUse.actor.id, role: memoryUse.actor.role },
      memoryUse,
      dimensions: {
        subject: { team: ["GTM"] },
        object: { domain: ["client"], sensitivity: ["privileged"] },
        purpose: "export",
      },
    });
    const direct = authorizeMemoryUse(memoryUse);
    expect(evaluation.memoryUse).toEqual(direct);
    expect(evaluation.receipt.outcome).toBe("deny");
    expect(evaluation.receipt.ruleMatched).toBe("gtm.meeting-prep-export-deny");
    expect(evaluation.receipt.reason).toBe("dimension_deny:gtm.meeting-prep-export-deny");
  });
});
