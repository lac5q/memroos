// @vitest-environment node
import { describe, expect, it } from "vitest";

import { evaluatePolicy } from "../engine";

describe("policy engine batch33 — applyDimensionTightening (569, 576)", () => {
  it("applyDimensionTightening denies export when dimensions match (569)", () => {
    const memoryUse = {
      actor: { id: "agent:gtm-b33", role: "agent" as const },
      purpose: "export" as const,
      label: {
        visibility: "internal" as const,
        domain: "client" as const,
        sensitivity: "privileged" as const,
        policy: "agent_visible" as const,
      },
    };
    const denied = evaluatePolicy({
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
    expect(denied.receipt.outcome).toBe("deny");
  });

  it("continues past non-matching dimension rules (576)", () => {
    const memoryUse = {
      actor: { id: "agent:noop-b33", role: "agent" as const },
      purpose: "recall" as const,
      label: {
        visibility: "internal" as const,
        domain: "general" as const,
        sensitivity: "standard" as const,
        policy: "agent_visible" as const,
      },
    };
    const out = evaluatePolicy({
      domain: "memory-use",
      action: "memory.read",
      actor: { id: memoryUse.actor.id, role: memoryUse.actor.role },
      memoryUse,
      dimensions: { subject: { team: ["OPS"] } },
    });
    expect(out.receipt.outcome).not.toBe("deny");
  });
});
