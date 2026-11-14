// @vitest-environment node
import { describe, expect, it } from "vitest";

import { evaluatePolicy } from "../engine";

describe("policy engine batch35 — applyDimensionTightening (569, 576)", () => {
  it("short-circuits when receipt already deny (569)", () => {
    const memoryUse = {
      actor: { id: "agent:sealed-b35", role: "agent" as const },
      purpose: "export" as const,
      label: {
        visibility: "private" as const,
        domain: "client" as const,
        sensitivity: "privileged" as const,
        policy: "sealed" as const,
      },
    };
    const out = evaluatePolicy({
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
    expect(out.receipt.outcome).toBe("deny");
  });

  it("skips rules whose dimension effect is not deny (576)", () => {
    const memoryUse = {
      actor: { id: "agent:allow-b35", role: "agent" as const },
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
      dimensions: { subject: { team: ["ENG"] } },
    });
    expect(out.receipt.outcome).not.toBe("deny");
  });
});
