// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_DIR = path.join(os.tmpdir(), `tool-record-b33b-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DIR, "routes.db");
const TEST_OUTCOMES_PATH = path.join(TEST_DIR, "outcomes.jsonl");

async function loadRoute() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  process.env.TOOL_ATTENTION_OUTCOMES = TEST_OUTCOMES_PATH;
  vi.resetModules();
  const registry = await import("@/lib/agent-registry");
  const route = await import("../record/route");
  const dbModule = await import("@/lib/db");
  return { ...registry, ...route, closeDb: dbModule.closeDb };
}

describe("POST /api/tool-attention/record batch33b", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    const { closeDb } = await loadRoute();
    closeDb();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
    delete process.env.TOOL_ATTENTION_OUTCOMES;
  });

  it("returns 400 when JSON body is missing toolId/outcome (lines 42-49)", async () => {
    const { POST, registerAgent } = await loadRoute();
    const { apiKey } = registerAgent({
      id: "tool-agent-b33b",
      name: "Tool Agent",
      role: "Records tools",
      platform: "codex",
      protocol: "rest",
      issueApiKey: true,
    });

    const badJson = await POST(
      new Request("http://localhost/api/tool-attention/record", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: "{bad",
      }),
    );
    expect(badJson.status).toBe(400);

    const missingFields = await POST(
      new Request("http://localhost/api/tool-attention/record", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ outcome: "helped" }),
      }),
    );
    expect(missingFields.status).toBe(400);
    expect((await missingFields.json()).error).toMatch(/toolId and outcome are required/);
  });
});
