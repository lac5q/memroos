import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  BASELINE_RANKING_PROVIDER,
  EvidenceRankingError,
  createEvidenceRankingRequest,
  rankEvidenceBaseline,
  validateEvidenceRankingResult,
} from "@memroos/memory-core";
import { hashEngineRequest } from "@memroos/memory-core/hash";
import { planRetrievalQuery } from "@memroos/memory-core/retrieval-query";
import {
  artifactIdentity,
  trainedRankingArtifactSchema,
} from "@memroos/memory-core/trained-ranking-contract";

const DIGEST_A = "sha256:" + "a".repeat(64);
const DIGEST_B = "sha256:" + "b".repeat(64);

function candidate(id, text, fusedScore = 0.1) {
  return {
    id,
    text,
    sourceHash: null,
    sourceRevision: null,
    fusedScore,
    intentPriority: 0,
  };
}

function makeRequest() {
  return createEvidenceRankingRequest({
    operationId: "synthetic-operation",
    scopeHash: DIGEST_A,
    query: "billing launch",
    intentQuery: "billing launch",
    candidates: [
      candidate("high-relevance", "billing launch plan", 0.9),
      candidate("low-relevance", "billing", 0.2),
    ],
  });
}

function constantError(code) {
  return (error) =>
    error instanceof EvidenceRankingError
    && error.code === code
    && error.message === code;
}

test("canonical hashing has a stable known vector and key-order independence", () => {
  const expected = "sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777";
  assert.equal(hashEngineRequest({ b: 2, a: 1 }), expected);
  assert.equal(hashEngineRequest({ a: 1, b: 2 }), expected);
});

test("en-US hashing retains the pre-extraction serialization vectors", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { hashEngineRequest } from '@memroos/memory-core/hash';
    const vectors = [{ z: 1, Z: 2, _a: 3, a2: 4, a10: 5 },
      { nested: [null, { b: 2, a: 1 }, undefined] },
      { absent: undefined, date: new Date('2026-01-01T00:00:00Z'), map: new Map([['x', 1]]) }];
    console.log(JSON.stringify({ locale: Intl.DateTimeFormat().resolvedOptions().locale,
      hashes: vectors.map(hashEngineRequest) }));
  `], { cwd: fileURLToPath(new URL("../", import.meta.url)), env: { LANG: "en_US.UTF-8" }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { locale: "en-US", hashes: [
    "sha256:dbee3ef81d1688e219b55a32d1273f0470e37771a36ebd04eaaf9e815efe391f",
    "sha256:0f5052f8a7d90d104bdeae41a9002c1bec9a05213bdbcc6cdb61ed778b13e80c",
    "sha256:b0b8d92149dfe16be219243f2ec7b495cad70caa9d00072dc2c29112152be5f7",
  ] });
});

test("retrieval planning removes meeting filler while retaining a quoted subject", () => {
  const plan = planRetrievalQuery(
    'Please show recent meetings about "emerald ledger" with finance',
  );
  assert.equal(plan.original, 'Please show recent meetings about "emerald ledger" with finance');
  assert.deepEqual(plan.terms, ["emerald ledger", "finance"]);
  assert.equal(plan.retrievalQuery, "emerald ledger finance");
});

test("the package root creates a frozen evidence request", () => {
  const request = makeRequest();
  assert.ok(Object.isFrozen(request));
  assert.ok(Object.isFrozen(request.candidates));
  assert.ok(Object.isFrozen(request.candidates[0]));
  assert.equal(request.candidates.length, 2);
  assert.match(request.requestHash, /^sha256:[a-f0-9]{64}$/);
});

test("baseline ranking is relevance ordered and validates against its request", () => {
  const request = makeRequest();
  const result = rankEvidenceBaseline(request);
  assert.equal(result.status, "ranked");
  assert.deepEqual(
    result.ranked.map((item) => item.id),
    ["high-relevance", "low-relevance"],
  );
  assert.ok(result.ranked[0].score > result.ranked[1].score);
  assert.deepEqual(
    validateEvidenceRankingResult(request, result, BASELINE_RANKING_PROVIDER),
    result,
  );
});

test("bad scope, provider, and evidence are refused with constant reason codes", () => {
  assert.throws(
    () => createEvidenceRankingRequest({
      operationId: "synthetic-operation",
      scopeHash: "bad-scope",
      query: "billing",
      intentQuery: "billing",
      candidates: [],
    }),
    constantError("ranking_request_invalid"),
  );

  const request = makeRequest();
  const result = rankEvidenceBaseline(request);
  assert.throws(
    () => validateEvidenceRankingResult(
      request,
      result,
      { id: "synthetic-other-provider", revision: "synthetic-revision" },
    ),
    constantError("ranking_provider_mismatch"),
  );

  const forged = {
    ...result,
    ranked: result.ranked.map((item) => ({ ...item, evidenceRevision: DIGEST_B })),
  };
  assert.throws(
    () => validateEvidenceRankingResult(request, forged, BASELINE_RANKING_PROVIDER),
    constantError("ranking_evidence_mismatch"),
  );
});

test("duplicate candidate evidence is rejected before a request is created", () => {
  const duplicate = candidate("duplicate", "synthetic evidence");
  assert.throws(
    () => createEvidenceRankingRequest({
      operationId: "synthetic-operation",
      scopeHash: DIGEST_A,
      query: "synthetic",
      intentQuery: "synthetic",
      candidates: [duplicate, { ...duplicate }],
    }),
    constantError("ranking_request_invalid"),
  );
});

test("malformed ranking input is rejected without echoing payloads", () => {
  assert.throws(
    () => createEvidenceRankingRequest({
      operationId: "",
      scopeHash: DIGEST_A,
      query: "private synthetic phrase",
      intentQuery: "private synthetic phrase",
      candidates: [],
    }),
    (error) =>
      error instanceof EvidenceRankingError
      && error.code === "ranking_request_invalid"
      && error.message === "ranking_request_invalid"
      && !error.message.includes("private synthetic phrase"),
  );
});

test("trained-ranking subpath validates and projects a synthetic artifact identity", () => {
  const artifact = {
    id: "synthetic-ranking",
    revision: "revision-1",
    contentHash: DIGEST_A,
    runHash: DIGEST_B,
    trainingUse: "approved-derived",
    eligibilityHash: DIGEST_A,
  };
  assert.deepEqual(trainedRankingArtifactSchema.parse(artifact), artifact);
  assert.deepEqual(artifactIdentity(artifact), {
    id: artifact.id,
    revision: artifact.revision,
    contentHash: artifact.contentHash,
    runHash: artifact.runHash,
  });
});
