// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  reconcileStages,
  stageRecord,
  type StageRecord,
} from "@/lib/retrieval-bench/modules/reconciliation";
import type { AggregateReport } from "@/lib/retrieval-bench/schema";

function report(tasks: AggregateReport["tasks"], failed = 0): AggregateReport {
  return {
    taskCount: tasks.length,
    aggregate: {
      completedTaskCount: tasks.length - failed,
      failedTaskCount: failed,
      injectedTotal: tasks.reduce((n, t) => n + t.injectedCount, 0),
      ignoredTotal: tasks.reduce((n, t) => n + (t.ignoredCount ?? 0), 0),
    },
    tasks,
  } as AggregateReport;
}

describe("reconciliation batch23b — retrieved/packed mismatches and skipped stages", () => {
  it("flags retrieved_lt_injected when retrieved ids are fewer than injected", () => {
    const perTask = new Map<string, StageRecord[]>([
      [
        "t1",
        [
          stageRecord({ taskId: "t1", stage: "retrieved", ids: ["a"] }),
          stageRecord({ taskId: "t1", stage: "injected", ids: ["a", "b"] }),
        ],
      ],
    ]);
    const receipt = reconcileStages({
      report: report([{ taskId: "t1", injectedCount: 2, ignoredCount: 0, status: "completed" }]),
      perTask,
    });
    expect(receipt.ok).toBe(false);
    expect(receipt.mismatches.some((m) => m.includes("retrieved_lt_injected"))).toBe(true);
  });

  it("ignores skipped stage records when summing ids", () => {
    const skipped: StageRecord = {
      taskId: "t1",
      stage: "injected",
      ids: ["ghost"],
      skipped: true,
    };
    const perTask = new Map<string, StageRecord[]>([
      [
        "t1",
        [
          stageRecord({ taskId: "t1", stage: "retrieved", ids: ["a"] }),
          stageRecord({ taskId: "t1", stage: "injected", ids: ["a"] }),
          skipped,
        ],
      ],
    ]);
    const receipt = reconcileStages({
      report: report([{ taskId: "t1", injectedCount: 1, ignoredCount: 0, status: "completed" }]),
      perTask,
    });
    expect(receipt.ok).toBe(true);
    expect(receipt.aggregate.injectedTotal).toBe(1);
  });

  it("aggregates denied/stale/omitted into ignoredTotal across tasks", () => {
    const perTask = new Map<string, StageRecord[]>([
      [
        "t1",
        [
          stageRecord({ taskId: "t1", stage: "injected", ids: ["a"] }),
          stageRecord({ taskId: "t1", stage: "denied", ids: ["d1"] }),
          stageRecord({ taskId: "t1", stage: "stale", ids: ["s1"] }),
        ],
      ],
      [
        "t2",
        [
          stageRecord({ taskId: "t2", stage: "injected", ids: ["b"] }),
          stageRecord({ taskId: "t2", stage: "omitted", ids: ["o1"] }),
        ],
      ],
    ]);
    const receipt = reconcileStages({
      report: report(
        [
          { taskId: "t1", injectedCount: 1, ignoredCount: 2, status: "completed" },
          { taskId: "t2", injectedCount: 1, ignoredCount: 1, status: "completed" },
        ],
      ),
      perTask,
    });
    expect(receipt.aggregate.ignoredTotal).toBe(3);
    expect(receipt.perTask).toHaveLength(2);
  });
});
