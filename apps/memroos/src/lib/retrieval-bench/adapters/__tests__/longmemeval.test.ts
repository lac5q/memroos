// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  convertLongMemEvalSamples,
  hashLongMemEvalSource,
  type LongMemEvalRawSample,
} from "../longmemeval";

const sample: LongMemEvalRawSample = {
  sample_id: "s1",
  history_sessions: [
    {
      session_id: "sess-a",
      turns: [{ role: "user", text: "hello", timestamp_iso: "2026-01-01T00:00:00Z" }],
    },
  ],
  questions: [
    {
      qid: "q1",
      question: "hello?",
      answer: "world",
      category: "temporal",
      evidence_session_ids: ["sess-a"],
    },
  ],
  source_file_hash: "sha256:abc",
};

describe("longmemeval adapter", () => {
  it("refuses v2 explicitly", () => {
    const out = convertLongMemEvalSamples({ rawSamples: [sample], variant: "longmemeval_v2" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("longmemeval_v2_unavailable");
  });

  it("rejects empty and malformed samples", () => {
    expect(convertLongMemEvalSamples({ rawSamples: [], variant: "longmemeval" })).toEqual({
      ok: false,
      reason: "raw_samples_empty",
    });
    const malformed = convertLongMemEvalSamples({
      rawSamples: [{ sample_id: "", history_sessions: [], questions: [] } as LongMemEvalRawSample],
      variant: "longmemeval",
    });
    expect(malformed.ok).toBe(false);
  });

  it("maps categories and builds corpus ids", () => {
    const out = convertLongMemEvalSamples({ rawSamples: [sample], variant: "longmemeval" });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.tasks[0]?.task_type).toBe("temporal_reasoning");
      expect(out.tasks[0]?.evidence_spans).toEqual(["s1-sess-a-turn-0"]);
      expect(out.tasks[0]?.provenance.sourceHash).toBe("sha256:abc");
    }
  });

  it("marks abstention questions with abstention_correct", () => {
    const out = convertLongMemEvalSamples({
      rawSamples: [
        {
          ...sample,
          questions: [{ ...sample.questions[0], abstention: true, category: "abstention" }],
        },
      ],
      variant: "longmemeval",
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.tasks[0]?.abstention_correct).toBe(true);
  });

  it("hashes canonical sample identity", () => {
    const hash = hashLongMemEvalSource([sample]);
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
