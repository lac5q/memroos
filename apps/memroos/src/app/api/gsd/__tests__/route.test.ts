// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `gsd-routes-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "routes.db");

async function loadRoutes() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const registry = await import("@/lib/agent-registry");
  const goal = await import("../goal/route");
  const resume = await import("../resume/route");
  const shipcheck = await import("../shipcheck/route");
  const standup = await import("../standup/route");
  const dbModule = await import("@/lib/db");
  return {
    ...registry,
    goal,
    resume,
    shipcheck,
    standup,
    closeDb: dbModule.closeDb,
  };
}

function request(url: string, apiKey?: string, init: RequestInit = {}): Request {
  return new Request(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      ...(init.headers ?? {}),
    },
  });
}

describe("GSD command routes", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(async () => {
    const { closeDb } = await loadRoutes();
    closeDb();
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
  });

  it("requires authenticated agent keys", async () => {
    const { goal } = await loadRoutes();
    const res = await goal.POST(
      request("http://localhost/api/gsd/goal", undefined, {
        method: "POST",
        body: JSON.stringify({ goalId: "goal-1", title: "Unauthorized", lane: "code" }),
      }) as any
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, error: "Unauthorized" });
  });

  it("rejects a mismatched agent hint even with a valid key", async () => {
    const { goal, registerAgent } = await loadRoutes();
    const alpha = registerAgent({
      id: "agent-alpha",
      name: "Agent Alpha",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      issueApiKey: true,
    });
    registerAgent({
      id: "agent-beta",
      name: "Agent Beta",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      issueApiKey: true,
    });

    const res = await goal.POST(
      request("http://localhost/api/gsd/goal", alpha.apiKey, {
        method: "POST",
        body: JSON.stringify({ agent: "agent-beta", goalId: "goal-1", title: "Spoof", lane: "code" }),
      }) as any
    );

    expect(res.status).toBe(401);
  });

  it("creates a goal, blocks missing shipcheck proof, then resumes and reports standup", async () => {
    const { goal, resume, shipcheck, standup, registerAgent } = await loadRoutes();
    const agent = registerAgent({
      id: "agent-alpha",
      name: "Agent Alpha",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      issueApiKey: true,
    });

    const goalRes = await goal.POST(
      request("http://localhost/api/gsd/goal", agent.apiKey, {
        method: "POST",
        body: JSON.stringify({
          goalId: "goal-phase-133",
          title: "Build GSD command routes",
          lane: "code",
          acceptanceCriteria: ["focused_tests"],
        }),
      }) as any
    );
    const goalPayload = await goalRes.json();
    expect(goalRes.status).toBe(200);
    expect(goalPayload.ok).toBe(true);
    expect(goalPayload.packet.goal.id).toBe("goal-phase-133");

    const blockedRes = await shipcheck.POST(
      request("http://localhost/api/gsd/shipcheck", agent.apiKey, {
        method: "POST",
        body: JSON.stringify({ goalId: "goal-phase-133", lane: "code" }),
      }) as any
    );
    const blockedPayload = await blockedRes.json();
    expect(blockedRes.status).toBe(400);
    expect(blockedPayload).toMatchObject({
      ok: false,
      status: "blocked",
      missingProof: ["focused_tests"],
    });

    const verifiedRes = await shipcheck.POST(
      request("http://localhost/api/gsd/shipcheck", agent.apiKey, {
        method: "POST",
        body: JSON.stringify({
          goalId: "goal-phase-133",
          lane: "code",
          proof: { focused_tests: "vitest route test passed" },
        }),
      }) as any
    );
    const verifiedPayload = await verifiedRes.json();
    expect(verifiedRes.status).toBe(200);
    expect(verifiedPayload).toMatchObject({ ok: true, status: "verified", receiptId: expect.any(Number) });

    const resumeRes = await resume.GET(
      request("http://localhost/api/gsd/resume?goal_id=goal-phase-133&agent=agent-alpha", agent.apiKey) as any
    );
    const resumePayload = await resumeRes.json();
    expect(resumeRes.status).toBe(200);
    expect(resumePayload.packet.goal.id).toBe("goal-phase-133");
    expect(resumePayload.ledger.verifications.some((verification: any) => verification.proofStatus === "verified")).toBe(true);

    const standupRes = await standup.GET(
      request("http://localhost/api/gsd/standup?goal_id=goal-phase-133&agent=agent-alpha", agent.apiKey) as any
    );
    const standupPayload = await standupRes.json();
    expect(standupRes.status).toBe(200);
    expect(standupPayload.activeGoals[0]).toMatchObject({ goalId: "goal-phase-133" });
    expect(standupPayload.recentProof[0]).toMatchObject({ goalId: "goal-phase-133", status: "verified" });
  });

  it("returns 400 when goal creation throws validation errors", async () => {
    const { goal, registerAgent } = await loadRoutes();
    const agent = registerAgent({
      id: "agent-alpha",
      name: "Agent Alpha",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      issueApiKey: true,
    });
    const res = await goal.POST(
      request("http://localhost/api/gsd/goal", agent.apiKey, {
        method: "POST",
        body: "{",
      }) as any
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false });
  });

  it("logs explicit shipcheck bypass reasons", async () => {
    const { goal, shipcheck, registerAgent } = await loadRoutes();
    const agent = registerAgent({
      id: "agent-alpha",
      name: "Agent Alpha",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      issueApiKey: true,
    });
    await goal.POST(
      request("http://localhost/api/gsd/goal", agent.apiKey, {
        method: "POST",
        body: JSON.stringify({ goalId: "goal-bypass", title: "Bypass check", lane: "deployment" }),
      }) as any
    );

    const res = await shipcheck.POST(
      request("http://localhost/api/gsd/shipcheck", agent.apiKey, {
        method: "POST",
        body: JSON.stringify({
          goalId: "goal-bypass",
          lane: "deployment",
          bypassReason: "operator accepted external deploy evidence",
        }),
      }) as any
    );
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      status: "bypassed",
      missingProof: ["deploy_verification"],
      bypassReason: "operator accepted external deploy evidence",
    });
  });
});
