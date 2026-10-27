// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  isStageRecord,
  reconcileStages,
  stageRecord,
  type StageRecord,
} from "@/lib/retrieval-bench/modules/reconciliation";
import type { AggregateReport } from "@/lib/retrieval-bench/schema";

function minimalReport(overrides: Partial<AggregateReport["tasks"][0]> = {}): AggregateReport {
  return {
    taskCount: 1,
    aggregate: {
      completedTaskCount: 1,
      failedTaskCount: 0,
      injectedTotal: 1,
      ignoredTotal: 0,
    },
    tasks: [
      {
        taskId: "t1",
        injectedCount: 1,
        ignoredCount: 0,
        status: "completed",
        ...overrides,
      },
    ],
  } as AggregateReport;
}

describe("reconciliation batch20c", () => {
  it("isStageRecord rejects non-objects and arrays", () => {
    expect(isStageRecord(null)).toBe(false);
    expect(isStageRecord([])).toBe(false);
    expect(isStageRecord({ taskId: "t", stage: "injected" })).toBe(true);
  });

  it("reconcileStages ok when stage ids match injected count", () => {
    const perTask = new Map<string, StageRecord[]>([
      [
        "t1",
        [
          stageRecord({ taskId: "t1", stage: "retrieved", ids: ["a"] }),
          stageRecord({ taskId: "t1", stage: "injected", ids: ["a"] }),
        ],
      ],
    ]);
    const receipt = reconcileStages({ report: minimalReport(), perTask });
    expect(receipt.ok).toBe(true);
    expect(receipt.mismatches).toHaveLength(0);
    expect(receipt.reconciliationHash).toMatch(/^sha256:/);
  });

  it("reconcileStages flags injected_count_mismatch and failed_tasks_present", () => {
    const perTask = new Map<string, StageRecord[]>([
      ["t1", [stageRecord({ taskId: "t1", stage: "injected", ids: [] })]],
    ]);
    const report = minimalReport({ injectedCount: 2 });
    report.aggregate.failedTaskCount = 1;
    const receipt = reconcileStages({ report, perTask });
    expect(receipt.ok).toBe(false);
    expect(receipt.mismatches.some((m) => m.includes("injected_count_mismatch"))).toBe(true);
    expect(receipt.mismatches.some((m) => m.includes("failed_tasks_present"))).toBe(true);
  });

  it("reconcileStages flags packed_lt_injected when packed ids are fewer than injected", () => {
    const perTask = new Map<string, StageRecord[]>([
      [
        "t1",
        [
          stageRecord({ taskId: "t1", stage: "injected", ids: ["a", "b"] }),
          stageRecord({ taskId: "t1", stage: "packed", ids: ["a"] }),
        ],
      ],
    ]);
    const receipt = reconcileStages({
      report: minimalReport({ injectedCount: 2 }),
      perTask,
    });
    expect(receipt.mismatches.some((m) => m.includes("packed_lt_injected"))).toBe(true);
  });
});
