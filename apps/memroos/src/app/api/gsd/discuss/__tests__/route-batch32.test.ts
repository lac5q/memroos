// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

const TMP = path.join(os.tmpdir(), `gsd-discuss-b32-${randomUUID()}`);

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

describe("POST /api/gsd/discuss batch32", () => {
  it("passes validatorNotes through verdict normalization (line 44)", async () => {
    const { POST, registerAgent } = await loadRoute();
    const agentId = `gsd-agent-b32-${randomUUID().slice(0, 6)}`;
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
          topic: "batch32 validator notes",
          lane: "ops",
          taskBudget: { maxRounds: 2, maxAgents: 4 },
          roles: [
            { role: "chair", agentId, mandate: "Run the council" },
            { role: "validator", agentId, mandate: "Validate council output" },
          ],
          contributions: [{ role: "validator", agentId, summary: "looks good" }],
          verdict: {
            decision: "approve",
            summary: "approved with notes",
            validatorPass: true,
            validatorNotes: "track follow-up in batch32",
          },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.verdict?.validatorNotes).toBe("track follow-up in batch32");
  });
});
