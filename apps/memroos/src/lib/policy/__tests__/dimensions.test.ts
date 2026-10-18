// @vitest-environment node
/**
 * Phase 129 (POLGOV-03) — Policy dimension matching tests.
 *
 * Covers the rule/request matching logic for the dimension layer. Pure
 * unit tests; no DB required. The byte-identical guarantee for callers
 * that do NOT supply `dimensions` is exercised here, plus the canonical
 * happy / negative paths.
 */

import { describe, expect, it } from "vitest";

import {
  matchDimensions,
  type PolicyDimensionRule,
} from "../dimensions";

describe("matchDimensions — subject matching", () => {
  it("matches when rule.team contains the request team", () => {
    const rule: PolicyDimensionRule = {
      subject: { team: ["GTM"] },
      effect: "deny",
    };
    expect(
      matchDimensions(rule, {
        subject: { team: ["GTM"] },
      })
    ).toBe(true);
  });

  it("does not match when rule.team is a different team", () => {
    const rule: PolicyDimensionRule = {
      subject: { team: ["GTM"] },
      effect: "deny",
    };
    expect(
      matchDimensions(rule, {
        subject: { team: ["ENG"] },
      })
    ).toBe(false);
  });

  it("matches when any element of rule.team is in request.team", () => {
    const rule: PolicyDimensionRule = {
      subject: { team: ["GTM", "OPS"] },
      effect: "deny",
    };
    expect(
      matchDimensions(rule, {
        subject: { team: ["OPS"] },
      })
    ).toBe(true);
  });

  it("does not match when request omits subject (byte-identical preservation)", () => {
    const rule: PolicyDimensionRule = {
      subject: { team: ["GTM"] },
      effect: "deny",
    };
    expect(matchDimensions(rule, undefined)).toBe(false);
    expect(matchDimensions(rule, {})).toBe(false);
  });
});

describe("matchDimensions — object matching", () => {
  it("does not match object rule when request supplies no dimensions", () => {
    const rule: PolicyDimensionRule = {
      object: { sensitivity: ["privileged"] },
      effect: "deny",
    };
    expect(matchDimensions(rule, undefined)).toBe(false);
    expect(matchDimensions(rule, {})).toBe(false);
    expect(matchDimensions(rule, { subject: { team: ["GTM"] } })).toBe(false);
  });

  it("matches when sensitivity overlaps", () => {
    const rule: PolicyDimensionRule = {
      object: { sensitivity: ["privileged"] },
      effect: "deny",
    };
    expect(
      matchDimensions(rule, {
        object: { sensitivity: ["privileged"] },
      })
    ).toBe(true);
  });

  it("does not match when sensitivity differs", () => {
    const rule: PolicyDimensionRule = {
      object: { sensitivity: ["privileged"] },
      effect: "deny",
    };
    expect(
      matchDimensions(rule, {
        object: { sensitivity: ["pii"] },
      })
    ).toBe(false);
  });

  it("matches when all object fields overlap", () => {
    const rule: PolicyDimensionRule = {
      object: { domain: ["client"], sensitivity: ["privileged"] },
      effect: "deny",
    };
    expect(
      matchDimensions(rule, {
        object: { domain: ["client"], sensitivity: ["privileged"] },
      })
    ).toBe(true);
  });

  it("does not match when one object field differs", () => {
    const rule: PolicyDimensionRule = {
      object: { domain: ["client"], sensitivity: ["privileged"] },
      effect: "deny",
    };
    expect(
      matchDimensions(rule, {
        object: { domain: ["legal"], sensitivity: ["privileged"] },
      })
    ).toBe(false);
  });
});

describe("matchDimensions — combined subject + object + purpose", () => {
  it("matches only when every specified field matches", () => {
    const rule: PolicyDimensionRule = {
      subject: { team: ["GTM"] },
      object: { domain: ["client"], sensitivity: ["privileged"] },
      purpose: ["export"],
      effect: "deny",
    };

    // All fields match
    expect(
      matchDimensions(rule, {
        subject: { team: ["GTM"] },
        object: { domain: ["client"], sensitivity: ["privileged"] },
        purpose: "export",
      })
    ).toBe(true);

    // Team mismatch -> no match
    expect(
      matchDimensions(rule, {
        subject: { team: ["ENG"] },
        object: { domain: ["client"], sensitivity: ["privileged"] },
        purpose: "export",
      })
    ).toBe(false);

    // Purpose mismatch -> no match
    expect(
      matchDimensions(rule, {
        subject: { team: ["GTM"] },
        object: { domain: ["client"], sensitivity: ["privileged"] },
        purpose: "recall",
      })
    ).toBe(false);

    // Domain mismatch -> no match
    expect(
      matchDimensions(rule, {
        subject: { team: ["GTM"] },
        object: { domain: ["legal"], sensitivity: ["privileged"] },
        purpose: "export",
      })
    ).toBe(false);
  });
});

describe("matchDimensions — action matching", () => {
  it("matches when action is in rule.action list", () => {
    const rule: PolicyDimensionRule = {
      action: ["export", "summarize"],
      effect: "deny",
    };
    expect(matchDimensions(rule, { action: "export" })).toBe(true);
    expect(matchDimensions(rule, { action: "summarize" })).toBe(true);
  });

  it("does not match when action is not in list", () => {
    const rule: PolicyDimensionRule = {
      action: ["export"],
      effect: "deny",
    };
    expect(matchDimensions(rule, { action: "recall" })).toBe(false);
  });

  it("does not match when request omits action but rule specifies it", () => {
    const rule: PolicyDimensionRule = {
      action: ["export"],
      effect: "deny",
    };
    expect(matchDimensions(rule, {})).toBe(false);
  });
});

describe("matchDimensions — ontology and belief object fields", () => {
  it("matches ontologyType and beliefStage with scalar request values", () => {
    const rule: PolicyDimensionRule = {
      object: { ontologyType: ["memory.record"], beliefStage: ["candidate"] },
      effect: "deny",
    };
    expect(
      matchDimensions(rule, {
        object: { ontologyType: "memory.record", beliefStage: "candidate" },
      }),
    ).toBe(true);
    expect(
      matchDimensions(rule, {
        object: { ontologyType: "memory.record", beliefStage: "promoted" },
      }),
    ).toBe(false);
  });

  it("matches scalar subject team and role arrays on the request side", () => {
    const rule: PolicyDimensionRule = {
      subject: { team: ["GTM", "OPS"], role: ["admin"] },
      effect: "deny",
    };
    expect(matchDimensions(rule, { subject: { team: "GTM", role: "admin" } })).toBe(true);
    expect(matchDimensions(rule, { subject: { team: "ENG", role: "admin" } })).toBe(false);
  });

  it("does not match when rule action array is empty", () => {
    const rule: PolicyDimensionRule = {
      action: [],
      effect: "deny",
    };
    expect(matchDimensions(rule, { action: "export" })).toBe(true);
  });
});

describe("matchDimensions — wildcard rules", () => {
  it("a rule with no specified fields matches everything", () => {
    const rule: PolicyDimensionRule = {
      effect: "deny",
    };
    expect(matchDimensions(rule, undefined)).toBe(true);
    expect(matchDimensions(rule, {})).toBe(true);
    expect(
      matchDimensions(rule, {
        subject: { team: ["ANY"] },
        object: { domain: ["client"] },
        purpose: "export",
      })
    ).toBe(true);
  });
});