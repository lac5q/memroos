import { test } from "node:test";
import assert from "node:assert/strict";
import { localCrossEncoderScore } from "../dist/ranking.js";
import { contentTokens, planRetrievalQuery } from "../dist/retrieval-query.js";

test("content tokens and retrieval plans preserve compound identifiers", () => {
  const query = "v1.2.3 src/worker.ts HOMECHAT-01";

  assert.deepEqual(contentTokens(query), ["v1.2.3", "src/worker.ts", "HOMECHAT-01"]);
  assert.deepEqual(planRetrievalQuery(query), {
    original: query,
    retrievalQuery: query,
    terms: ["v1.2.3", "src/worker.ts", "HOMECHAT-01"],
  });
});

test("the local cross-encoder matches complete tokens inside compound evidence", () => {
  const matches = [
    ["Cobalt", "https://sms.cobalt.example"],
    ["Cobalt", "Cobalt/ops"],
    ["Cobalt", "service_Cobalt_worker"],
    ["Cobalt", "Cobalt-ops"],
    ["src/worker.ts", "repo/src/worker.ts"],
    ["v1.2.3", "Release v1.2.3 deployed"],
    ["webhook retries", "webhook retries confirmed"],
  ];

  for (const [query, text] of matches) {
    assert.ok(localCrossEncoderScore(query, text) > 0, `${query} should match ${text}`);
  }

  assert.ok(
    localCrossEncoderScore("Cobalt", "https://sms.cobalt.example")
      > localCrossEncoderScore("Cobalt", "https://sms.cobaltium.example"),
    "a complete host label should score above a longer lookalike label",
  );
  assert.ok(
    localCrossEncoderScore("Cobalt", "Cobalt/ops")
      > localCrossEncoderScore("Cobalt", "cobaltium/ops"),
    "a complete path component should score above a longer lookalike component",
  );
  assert.ok(
    localCrossEncoderScore("src/worker.ts", "repo/src/worker.ts")
      > localCrossEncoderScore("src/worker.ts", "repo/src/worker.tsx"),
    "a complete path suffix should score above an extension lookalike",
  );
  assert.ok(
    localCrossEncoderScore("v1.2.3", "Release v1.2.3 deployed")
      > localCrossEncoderScore("v1.2.3", "Release v1.2.30 deployed"),
    "a complete dotted version should score above a longer version",
  );
  assert.ok(
    localCrossEncoderScore("webhook retries", "webhook retries confirmed")
      > localCrossEncoderScore("webhook retries", "webhooks retry queue"),
    "exact query tokens should score above stem-only lookalikes",
  );
});
