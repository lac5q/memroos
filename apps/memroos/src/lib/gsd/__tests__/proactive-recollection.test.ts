import { describe, expect, it } from "vitest";

import {
  assembleRecollectionContextPack,
  evaluateRecollectionTrigger,
  planRecollectionQueries,
  rankRecollectionCandidates,
  type RecollectionCandidate,
} from "../proactive-recollection";

describe("Phase 118 proactive recollection", () => {
  it("requires recollection for auditable task signals before planning", () => {
    const decision = evaluateRecollectionTrigger({
      timing: "before_plan",
      taskText: "Implement Phase 118 using the previous proactive recollection requirement and current source notes.",
      projectId: "memroos",
      sourceRefs: [{ id: ".planning/notes/2026-06-23-proactive-recollection-gsd-requirement.md", changed: true }],
      handoff: { unresolved: true, blockerCount: 1 },
      recentHighSalienceFacts: 1,
    });

    expect(decision.action).toBe("search");
    expect(decision.required).toBe(true);
    expect(decision.authorization).toBe("allowed");
    expect(decision.triggers).toEqual(
      expect.arrayContaining(["explicit_memory_request", "source_changed", "unresolved_handoff"]),
    );
    expect(decision.reason).toContain("cleared threshold");
  });

  it("emits deterministic skip receipts for low-signal or unsafe decisions", () => {
    const lowSignal = evaluateRecollectionTrigger({
      timing: "before_tool_use",
      taskText: "format output",
      projectId: "memroos",
    });

    expect(lowSignal.action).toBe("skip");
    expect(lowSignal.skipReason).toBe("low_signal");

    const denied = evaluateRecollectionTrigger({
      timing: "before_plan",
      taskText: "Recall the previous implementation details from a different project.",
      candidateProjectIds: ["private-client"],
      crossProjectAllowlist: [],
    });

    expect(denied.action).toBe("skip");
    expect(denied.skipReason).toBe("policy_denied");
    expect(denied.deniedProjectIds).toEqual(["private-client"]);
  });

  it("plans bounded tier-aware queries and scopes cross-project recall to allowlisted projects", () => {
    const decision = evaluateRecollectionTrigger({
      timing: "before_dispatch",
      taskText: "Recall MemRoOS Phase 118 context for PROACTIVE-RECOLLECTION before dispatch.",
      projectId: "memroos",
      candidateProjectIds: ["memroos", "operator-handbook", "unlisted"],
      crossProjectAllowlist: ["operator-handbook"],
      sourceRefs: [
        { id: "phase-118-qmd", kind: "qmd", healthy: true },
        { id: "stale-runbook", kind: "qmd", healthy: false },
      ],
    });

    const plans = planRecollectionQueries({
      taskText: "Recall MemRoOS Phase 118 context for PROACTIVE-RECOLLECTION before dispatch.",
      projectId: "memroos",
      sourceRefs: [
        { id: "phase-118-qmd", kind: "qmd", healthy: true },
        { id: "stale-runbook", kind: "qmd", healthy: false },
      ],
      decision,
      maxQueries: 2,
      maxTermsPerQuery: 5,
    });

    expect(plans).toHaveLength(2);
    expect(plans[0]?.query.split(" ").length).toBeLessThanOrEqual(5);
    expect(plans[0]?.projectIds).toEqual(["memroos", "operator-handbook"]);
    expect(plans[0]?.tiers).not.toContain("qmd_source");
    expect(decision.deniedProjectIds).toEqual(["unlisted"]);
  });

  it("ranks old critical memories above recent low-value chatter and penalizes stale or risky candidates", () => {
    const candidates: RecollectionCandidate[] = [
      {
        id: "recent-low",
        text: "Recent low-value chat about formatting.",
        tier: "episodic",
        relevance: 0.4,
        importance: 0.1,
        observedAt: "2026-06-24T00:00:00Z",
        priorUsefulness: 0.1,
      },
      {
        id: "old-critical",
        text: "Durable requirement: old but critical source freshness decisions must be preserved.",
        tier: "graph",
        relevance: 0.92,
        importance: 1,
        observedAt: "2026-03-01T00:00:00Z",
        priorUsefulness: 0.85,
      },
      {
        id: "stale-source",
        text: "Candidate copied before the source changed.",
        tier: "qmd_source",
        relevance: 0.9,
        importance: 0.7,
        observedAt: "2026-06-20T00:00:00Z",
        sourceUpdatedAt: "2026-06-25T00:00:00Z",
      },
      {
        id: "policy-risk",
        text: "Risky cross-project fact.",
        tier: "vector",
        relevance: 0.9,
        importance: 0.9,
        observedAt: "2026-06-24T00:00:00Z",
        authorization: "denied",
        policyRisk: 1,
      },
    ];

    const ranked = rankRecollectionCandidates(candidates, { now: "2026-06-25T00:00:00Z" });

    expect(ranked[0]?.id).toBe("old-critical");
    expect(ranked.find((candidate) => candidate.id === "stale-source")?.components.freshness).toBe(0.2);
    expect(ranked.find((candidate) => candidate.id === "policy-risk")?.ignoredReason).toBe("policy_denied");
  });

  it("assembles thresholded context packs with search and no-search receipts", () => {
    const decision = evaluateRecollectionTrigger({
      timing: "before_final",
      taskText: "Recall prior requirements and cite source references before final answer.",
      projectId: "memroos",
      sourceRefs: [{ id: "phase-118-note", changed: true }],
      operatorReaskCount: 1,
      rediscoveredFactCount: 1,
      alreadyHasCitations: false,
    });
    const plans = planRecollectionQueries({
      taskText: "Recall prior requirements and cite source references before final answer.",
      projectId: "memroos",
      sourceRefs: [{ id: "phase-118-note", changed: true }],
      decision,
    });
    const ranked = rankRecollectionCandidates(
      [
        {
          id: "include",
          text: "Use bounded deterministic recollection with receipts.",
          tier: "episodic",
          relevance: 0.95,
          importance: 0.95,
          priorUsefulness: 0.8,
          observedAt: "2026-06-24T00:00:00Z",
          citation: "phase-118-note",
        },
        {
          id: "ignore",
          text: "Fresh but low-value chatter.",
          tier: "episodic",
          relevance: 0.1,
          importance: 0.1,
          observedAt: "2026-06-25T00:00:00Z",
        },
      ],
      { now: "2026-06-25T00:00:00Z" },
    );

    const pack = assembleRecollectionContextPack({
      decision,
      plans,
      rankedCandidates: ranked,
      scoreThreshold: 0.7,
      maxItems: 1,
      maxChars: 200,
    });

    expect(pack.entries.map((entry) => entry.id)).toEqual(["include"]);
    expect(pack.context).toContain("Use bounded deterministic recollection");
    expect(pack.receipt.injectedIds).toEqual(["include"]);
    expect(pack.receipt.ignored.map((entry) => entry.id)).toContain("ignore");
    expect(pack.receipt.telemetry.efftel04RediscoveredFactGuard).toBe(true);
    expect(pack.receipt.telemetry.efftel05OperatorReaskGuard).toBe(true);

    const skippedDecision = evaluateRecollectionTrigger({
      timing: "before_plan",
      taskText: "",
      projectId: "memroos",
    });
    const skippedPack = assembleRecollectionContextPack({
      decision: skippedDecision,
      plans: [],
      rankedCandidates: [],
    });

    expect(skippedPack.receipt.action).toBe("skip");
    expect(skippedPack.receipt.reason).toContain("No task text");
    expect(skippedPack.receipt.authorization).toBe(skippedDecision.authorization);
  });

  it("returns disabled skip when proactive recollection is turned off", () => {
    const decision = evaluateRecollectionTrigger({
      timing: "before_tool_use",
      taskText: "format output",
      projectId: "memroos",
      enabled: false,
    });
    expect(decision.action).toBe("skip");
    expect(decision.skipReason).toBe("disabled");
    expect(planRecollectionQueries({ decision, taskText: "format output", projectId: "memroos" })).toEqual([]);
  });

  it("breaks score ties lexicographically and drops empty budget slices", async () => {
    const { rankRecollectionCandidates, assembleRecollectionContextPack, evaluateRecollectionTrigger } =
      await import("../proactive-recollection");
    const ranked = rankRecollectionCandidates(
      [
        {
          id: "b-candidate",
          text: "second",
          tier: "episodic",
          relevance: 0.5,
          importance: 0.5,
          observedAt: "2026-06-25T00:00:00Z",
        },
        {
          id: "a-candidate",
          text: "first",
          tier: "episodic",
          relevance: 0.5,
          importance: 0.5,
          observedAt: "2026-06-25T00:00:00Z",
        },
      ],
      { now: "2026-06-25T00:00:00Z" },
    );
    expect(ranked.map((entry) => entry.id)).toEqual(["a-candidate", "b-candidate"]);

    const decision = evaluateRecollectionTrigger({
      timing: "before_plan",
      taskText: "ship recollection coverage",
      projectId: "memroos",
    });
    const pack = assembleRecollectionContextPack({
      decision,
      plans: [],
      rankedCandidates: ranked.map((entry) => ({ ...entry, text: "   " })),
      scoreThreshold: 0,
      maxItems: 5,
      maxChars: 10,
    });
    expect(pack.entries).toEqual([]);
    expect(pack.receipt.ignored.every((entry) => entry.reason === "pack_budget_exhausted")).toBe(true);
  });
});
