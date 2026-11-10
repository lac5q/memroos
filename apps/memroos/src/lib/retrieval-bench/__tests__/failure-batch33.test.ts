// @vitest-environment node
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { validateAdapterResult } from "../failure";

describe("retrieval-bench failure batch33 — validateAdapterResult array guards (100–101)", () => {
  it("flags injected_not_array and ignored_not_array", () => {
    const result = validateAdapterResult({
      taskId: `t-b33-${randomUUID().slice(0, 8)}`,
      adapterName: "lexical",
      retrieved: [],
      injected: "not-array" as unknown as string[],
      ignored: { bad: true } as unknown as [],
      latencyMs: 12,
      receipt: {},
      status: "ok",
    });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("injected_not_array");
    expect(result.reasons).toContain("ignored_not_array");
  });
});
