// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("../../schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../schema")>();
  return {
    ...actual,
    SUPPORTED_TASK_TYPES: ["multi_hop"] as typeof actual.SUPPORTED_TASK_TYPES,
  };
});

import { convertLongMemEvalSamples, type LongMemEvalRawSample } from "../longmemeval";

const sample: LongMemEvalRawSample = {
  sample_id: "s-b37",
  history_sessions: [
    {
      session_id: "sess-b37",
      turns: [{ role: "user", text: "hello", timestamp_iso: "2026-01-01T00:00:00Z" }],
    },
  ],
  questions: [
    {
      qid: "q-b37",
      question: "hello?",
      answer: "world",
      category: "single_hop",
    },
  ],
};

describe("longmemeval adapter batch37", () => {
  it("returns task_type_unsupported when mapped task type is filtered out (line 88)", () => {
    const out = convertLongMemEvalSamples({ rawSamples: [sample], variant: "longmemeval" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("task_type_unsupported:single_hop");
  });
});