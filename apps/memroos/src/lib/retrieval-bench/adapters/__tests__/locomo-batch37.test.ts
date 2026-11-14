// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("../../schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../schema")>();
  return {
    ...actual,
    SUPPORTED_TASK_TYPES: ["multi_hop"] as typeof actual.SUPPORTED_TASK_TYPES,
  };
});

import { convertLoCoMoSamples, type LoCoMoRawSample } from "../locomo";

const sample: LoCoMoRawSample = {
  sample_id: "locomo-b37",
  conversations: [
    {
      session_id: "sess",
      turns: [{ role: "user", text: "hi", timestamp_iso: "2026-01-01T00:00:00Z" }],
    },
  ],
  qa: [
    {
      qid: "q1",
      question: "hi?",
      answer: "there",
      category: "qa",
    },
  ],
};

describe("locomo adapter batch37", () => {
  it("returns task_type_unsupported when mapped qa category is excluded (line 98)", () => {
    const out = convertLoCoMoSamples({ rawSamples: [sample] });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("task_type_unsupported:qa");
  });
});