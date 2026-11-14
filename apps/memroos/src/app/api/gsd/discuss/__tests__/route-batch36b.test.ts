// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

const TMP = path.join(os.tmpdir(), `gsd-discuss-b36b-${randomUUID()}`);

async function loadRoute() {
  process.env.SQLITE_DB_PATH = path.join(TMP, "gsd.db");
  const registry = await import("@/lib/agent-registry");
  const route = await import("../route");
  return { ...registry, ...route };
}

beforeEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
});

afterEach(async () => {
  const { closeDb } = await import("@/lib/db");
  closeDb();
  delete process.env.SQLITE_DB_PATH;
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("POST /api/gsd/discuss batch36b", () => {
  it("normalizes validatorPass false and non-string validatorNotes (45–46)", async () => {
    const { POST, registerAgent } = await loadRoute();
    const agentId = `gsd-agent-b36b-${randomUUID().slice(0, 6)}`;
    const { apiKey } = registerAgent({
      id: agentId,
      name: "GSD Agent",
      role: "Council",
      platform: "codex",
      protocol: "rest",
      issueApiKey: true,
    });

    const res = await POST(
      new NextRequest("http://localhost/api/gsd/discuss", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          goalId: `goal-${randomUUID().slice(0, 8)}`,
          topic: "batch36b validator normalization",
          lane: "ops",
          taskBudget: { maxRounds: 1, maxAgents: 2 },
          roles: [{ role: "chair", agentId, mandate: "chair" }],
          contributions: [],
          verdict: {
            decision: "approve",
            summary: "ok",
            validatorPass: false,
            validatorNotes: 42,
          },
        }),
      }),
    );
    const body = await res.json();
    expect(body.verdict?.validatorPass).toBe(false);
    expect(body.verdict?.validatorNotes).toBeUndefined();
  });
});
