/**
 * Fixture validation tests (VAL-RETR-002).
 */
import { describe, expect, it } from "vitest";
import {
  hashCorpus,
  hashFixtures,
  hashTaskIdentity,
  isDatasetId,
  isTaskType,
  partitionValidTasks,
  validateFixtures,
  validateTask,
} from "../validation";
import type { NormalizedTask } from "../schema";

function makeTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "task-1",
    dataset: "memroos_public_synthetic",
    task_type: "single_hop",
    corpus: [
      { id: "mem-1", text: "The team decided to use Qdrant for vector search." },
    ],
    question: "Which vector store did the team decide to use?",
    expected_answer: "Qdrant",
    evidence_spans: ["mem-1"],
    license: "MIT",
    citation: "MemroOS internal synthetic benchmark",
    provenance: {
      dataset: "memroos_public_synthetic",
      sourceCitation: "MemroOS internal synthetic benchmark",
      sourceLicense: "MIT",
      sourceAvailability: "synthetic",
    },
    ...overrides,
  };
}

describe("retrieval-bench fixture validation (VAL-RETR-002)", () => {
  it("accepts a well-formed synthetic task", () => {
    const r = validateTask(makeTask(), { seenIds: new Set() });
    expect(r.ok).toBe(true);
  });

  it("rejects missing id", () => {
    const r = validateTask(makeTask({ id: undefined }), { seenIds: new Set() });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.field === "id")).toBe(true);
    }
  });

  it("rejects empty corpus", () => {
    const r = validateTask(makeTask({ corpus: [] }), { seenIds: new Set() });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.field === "corpus")).toBe(true);
    }
  });

  it("rejects duplicate corpus IDs", () => {
    const r = validateTask(
      makeTask({
        corpus: [
          { id: "mem-1", text: "First." },
          { id: "mem-1", text: "Duplicate ID." },
        ],
      }),
      { seenIds: new Set() },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.reason === "duplicate_corpus_id")).toBe(true);
    }
  });

  it("rejects dangling evidence spans", () => {
    const r = validateTask(
      makeTask({
        corpus: [{ id: "mem-1", text: "Only one entry." }],
        evidence_spans: ["mem-1", "mem-missing"],
      }),
      { seenIds: new Set() },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.reason === "dangling_evidence_span")).toBe(true);
    }
  });

  it("rejects invalid task_type enum", () => {
    const r = validateTask(
      makeTask({ task_type: "unicorn_reasoning" }),
      { seenIds: new Set() },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.field === "task_type")).toBe(true);
    }
  });

  it("rejects malformed ISO timestamps", () => {
    const r = validateTask(
      makeTask({
        corpus: [
          { id: "mem-1", text: "x", timestamp_iso: "not-a-date" },
        ],
      }),
      { seenIds: new Set() },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.reason === "timestamp_invalid_iso8601")).toBe(true);
    }
  });

  it("rejects malformed candidate scope metadata when provided", () => {
    const r = validateTask(
      makeTask({
        corpus: [
          {
            id: "mem-1",
            text: "x",
            scope: {
              tenantId: "tenant",
              userId: "user",
              agentId: "agent",
              spaceId: "space",
              label: { visibility: "internal", policy: "agent_visible" },
              purpose: "not-allowlisted",
              beliefStage: "silver_candidate_claim",
            },
          },
        ],
      }),
      { seenIds: new Set() },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.reason === "candidate_scope_invalid")).toBe(true);
    }
  });

  it("rejects invalid temporal_direction enum", () => {
    const r = validateTask(
      makeTask({
        temporal_metadata: { temporal_direction: "sideways" },
      }),
      { seenIds: new Set() },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.reason === "temporal_direction_invalid_enum")).toBe(true);
    }
  });

  it("rejects license mismatch with canonical provenance", () => {
    const r = validateTask(
      makeTask({ license: "Proprietary", provenance: { dataset: "memroos_public_synthetic", sourceCitation: "MemroOS internal synthetic benchmark", sourceLicense: "Proprietary", sourceAvailability: "synthetic" } }),
      { seenIds: new Set() },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.reason === "provenance_sourceLicense_mismatch")).toBe(true);
    }
  });

  it("rejects duplicate task IDs across the fixture set", () => {
    const tasks = [makeTask({ id: "task-1" }), makeTask({ id: "task-1" })];
    const r = validateFixtures(tasks);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.reason === "duplicate_task_id")).toBe(true);
    }
  });

  it("partitionValidTasks returns validated tasks", () => {
    const r = partitionValidTasks([
      makeTask({ id: "task-1" }),
      makeTask({ id: "task-2", license: "Proprietary", provenance: { dataset: "memroos_public_synthetic", sourceCitation: "MemroOS internal synthetic benchmark", sourceLicense: "Proprietary", sourceAvailability: "synthetic" } }),
    ]);
    expect(r.invalid).toBeGreaterThan(0);
    expect(r.valid.length).toBe(0);
  });

  it("hashFixtures is stable across runs for equivalent inputs", () => {
    const a: NormalizedTask[] = [
      makeTask({ id: "task-1" }) as unknown as NormalizedTask,
    ];
    const b: NormalizedTask[] = [
      makeTask({ id: "task-1" }) as unknown as NormalizedTask,
    ];
    expect(hashFixtures(a)).toBe(hashFixtures(b));
  });

  it("hashFixtures changes when a corpus entry changes", () => {
    const a: NormalizedTask[] = [
      makeTask({ id: "task-1" }) as unknown as NormalizedTask,
    ];
    const b: NormalizedTask[] = [
      makeTask({ id: "task-1", corpus: [{ id: "mem-1", text: "Changed." }] }) as unknown as NormalizedTask,
    ];
    expect(hashFixtures(a)).not.toBe(hashFixtures(b));
  });

  it("hashCorpus and hashTaskIdentity are independent", () => {
    const t = makeTask() as unknown as NormalizedTask;
    const corpusHash = hashCorpus(t.corpus);
    const identityHash = hashTaskIdentity(t);
    expect(corpusHash).not.toBe(identityHash);
    expect(corpusHash.startsWith("sha256:")).toBe(true);
    expect(identityHash.startsWith("sha256:")).toBe(true);
  });

  it("isTaskType and isDatasetId narrow correctly", () => {
    expect(isTaskType("single_hop")).toBe(true);
    expect(isTaskType("unicorn")).toBe(false);
    expect(isDatasetId("locomo")).toBe(true);
    expect(isDatasetId("nope")).toBe(false);
  });

  it("rejects non-object tasks and duplicate ids within validateTask", () => {
    const notObject = validateTask("nope", { seenIds: new Set() });
    expect(notObject.ok).toBe(false);
    if (!notObject.ok) {
      expect(notObject.issues[0]).toMatchObject({ field: "task", reason: "task_not_object" });
    }

    const seen = new Set<string>(["task-1"]);
    const duplicate = validateTask(makeTask({ id: "task-1" }), { seenIds: seen });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.issues.some((i) => i.reason === "duplicate_task_id")).toBe(true);
    }
  });

  it("rejects invalid dataset enum and missing question/expected_answer", () => {
    const badDataset = validateTask(makeTask({ dataset: "unknown" }), { seenIds: new Set() });
    expect(badDataset.ok).toBe(false);

    const missingQuestion = validateTask(makeTask({ question: "" }), { seenIds: new Set() });
    expect(missingQuestion.ok).toBe(false);
    if (!missingQuestion.ok) {
      expect(missingQuestion.issues.some((i) => i.field === "question")).toBe(true);
    }

    const missingAnswer = validateTask(makeTask({ expected_answer: undefined }), { seenIds: new Set() });
    expect(missingAnswer.ok).toBe(false);
    if (!missingAnswer.ok) {
      expect(missingAnswer.issues.some((i) => i.reason === "expected_answer_missing")).toBe(true);
    }

    const badAnswerType = validateTask(makeTask({ expected_answer: 42 }), { seenIds: new Set() });
    expect(badAnswerType.ok).toBe(false);
    if (!badAnswerType.ok) {
      expect(badAnswerType.issues.some((i) => i.reason === "expected_answer_not_string")).toBe(true);
    }
  });

  it("validates abstention and evidence_spans typing", () => {
    const badAbstention = validateTask(makeTask({ abstention_correct: "yes" }), { seenIds: new Set() });
    expect(badAbstention.ok).toBe(false);
    if (!badAbstention.ok) {
      expect(badAbstention.issues.some((i) => i.reason === "abstention_correct_not_boolean")).toBe(true);
    }

    const badSpans = validateTask(makeTask({ evidence_spans: [1, 2] }), { seenIds: new Set() });
    expect(badSpans.ok).toBe(false);
    if (!badSpans.ok) {
      expect(badSpans.issues.some((i) => i.reason === "evidence_spans_not_string_array")).toBe(true);
    }
  });

  it("validates sessions, temporal metadata, and provenance fields", () => {
    const sessions = validateTask(
      makeTask({
        sessions: [
          {
            session_id: "",
            turns: [{ role: "narrator", content: "hi" }],
          },
        ],
      }),
      { seenIds: new Set() },
    );
    expect(sessions.ok).toBe(false);
    if (!sessions.ok) {
      expect(sessions.issues.some((i) => i.field.includes("session_id"))).toBe(true);
      expect(sessions.issues.some((i) => i.reason === "turn_role_invalid")).toBe(true);
    }

    const temporal = validateTask(
      makeTask({
        temporal_metadata: {
          reference_time_iso: "bad",
          fact_valid_until_iso: "also-bad",
          temporal_direction: "sideways",
        },
      }),
      { seenIds: new Set() },
    );
    expect(temporal.ok).toBe(false);
    if (!temporal.ok) {
      expect(temporal.issues.some((i) => i.reason === "timestamp_invalid_iso8601")).toBe(true);
      expect(temporal.issues.some((i) => i.reason === "temporal_direction_invalid_enum")).toBe(true);
    }

    const provenance = validateTask(
      makeTask({
        provenance: {
          sourceCitation: "",
          sourceLicense: "MIT",
          sourceAvailability: "mystery",
        },
      }),
      { seenIds: new Set() },
    );
    expect(provenance.ok).toBe(false);
    if (!provenance.ok) {
      expect(provenance.issues.some((i) => i.reason === "provenance_sourceCitation_missing")).toBe(true);
      expect(provenance.issues.some((i) => i.reason === "provenance_sourceAvailability_invalid")).toBe(true);
    }
  });

  it("validates corpus entry metadata and accepts a complete candidate scope", () => {
    const corpusIssues = validateTask(
      makeTask({
        corpus: [
          {
            id: "",
            text: "",
            timestamp_iso: "not-iso",
            entity_refs: [1],
          },
        ],
      }),
      { seenIds: new Set() },
    );
    expect(corpusIssues.ok).toBe(false);
    if (!corpusIssues.ok) {
      expect(corpusIssues.issues.some((i) => i.reason === "corpus_id_missing_or_empty")).toBe(true);
      expect(corpusIssues.issues.some((i) => i.reason === "corpus_text_missing_or_empty")).toBe(true);
      expect(corpusIssues.issues.some((i) => i.reason === "entity_refs_not_string_array")).toBe(true);
    }

    const validScope = validateTask(
      makeTask({
        corpus: [
          {
            id: "mem-1",
            text: "Scoped memory.",
            scope: {
              tenantId: "tenant",
              userId: "user",
              agentId: "agent",
              spaceId: "space",
              label: { visibility: "internal", policy: "agent_visible" },
              purpose: "recall",
              beliefStage: "silver_candidate_claim",
            },
          },
        ],
      }),
      { seenIds: new Set() },
    );
    expect(validScope.ok).toBe(true);
  });

  it("rejects malformed sessions arrays and accepts valid temporal metadata enums", () => {
    const badSessions = validateTask(makeTask({ sessions: "not-an-array" }), { seenIds: new Set() });
    expect(badSessions.ok).toBe(false);
    if (!badSessions.ok) {
      expect(badSessions.issues.some((i) => i.reason === "sessions_not_array")).toBe(true);
    }

    const validTemporal = validateTask(
      makeTask({
        temporal_metadata: {
          reference_time_iso: "2026-01-01T00:00:00Z",
          fact_valid_until_iso: "2026-12-31T23:59:59Z",
          temporal_direction: "between",
        },
      }),
      { seenIds: new Set() },
    );
    expect(validTemporal.ok).toBe(true);
  });

  it("validateFixtures rejects non-arrays and partitionValidTasks returns valid tasks", () => {
    const notArray = validateFixtures({ id: "task-1" });
    expect(notArray.ok).toBe(false);
    expect(notArray.issues[0]).toMatchObject({ field: "fixtures", reason: "fixtures_not_array" });

    const ok = partitionValidTasks([
      makeTask({ id: "task-1" }),
      makeTask({ id: "task-2" }),
    ]);
    expect(ok).toMatchObject({ ok: true, invalid: 0, valid: expect.any(Array) });
    expect(ok.valid).toHaveLength(2);
  });
});
