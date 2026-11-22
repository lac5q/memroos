import { test } from "node:test";
import assert from "node:assert/strict";
import { contentTokens } from "../dist/retrieval-query.js";

test("sentence punctuation does not change content-token identity", () => {
  assert.deepEqual(contentTokens("Routing. routing ROUTING..."), ["Routing"]);
  assert.deepEqual(contentTokens("Check v1.2.3 and src/worker.ts."), ["Check", "v1.2.3", "src/worker.ts"]);
  assert.deepEqual(contentTokens("The. THE... and the"), []);
});
