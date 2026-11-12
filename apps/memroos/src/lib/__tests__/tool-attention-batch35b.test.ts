// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { getToolAttention } from "@/lib/tool-attention";

const TMP = path.join(os.tmpdir(), `tool-attn-b35b-${randomUUID()}`);
const CATALOG = path.join(TMP, "tool-catalog.json");
const OUTCOMES = path.join(TMP, "outcomes.jsonl");

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  fs.mkdirSync(TMP, { recursive: true });
  for (const key of ["TOOL_ATTENTION_CATALOG", "TOOL_ATTENTION_OUTCOMES", "HOME"]) {
    savedEnv[key] = process.env[key];
  }
  process.env.TOOL_ATTENTION_CATALOG = CATALOG;
  process.env.TOOL_ATTENTION_OUTCOMES = OUTCOMES;
  process.env.HOME = TMP;
  fs.writeFileSync(
    CATALOG,
    JSON.stringify({
      capabilities: [],
      sources: [{ id: "empty-path-b35b", label: "No path", type: "local-config", status: "available" }],
    }),
    "utf8",
  );
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("tool-attention batch35b", () => {
  it("publicPath returns undefined when catalog source omits file path (153)", () => {
    const response = getToolAttention("", 5);
    const empty = response.sources.find((s) => s.id === "empty-path-b35b");
    expect(empty?.path).toBeUndefined();
  });
});
