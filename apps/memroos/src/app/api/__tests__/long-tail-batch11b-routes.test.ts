// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: vi.fn(),
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: vi.fn(),
  recordToolOutcome: vi.fn(),
}));

import { authenticateAgentHeaders } from "@/lib/agent-registry";

vi.mock("@/lib/operator-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operator-auth")>();
  return {
    ...actual,
    authorizeRegistryWrite: vi.fn(actual.authorizeRegistryWrite),
  };
});

import { authenticateUser } from "@/lib/auth/session";
import { authorizeRegistryWrite } from "@/lib/operator-auth";

import { GET as getCacheStats } from "../cache/stats/route";
import { GET as getAuditExport } from "../audit/export/route";
import { GET as getAgentVersions, POST as postAgentVersions } from "../agents/versions/route";
import { POST as postEvalsRun } from "../evals/run/route";
import { GET as getEvidenceTaskBundles, POST as postEvidenceTaskBundles } from "../evidence/task-bundles/route";
import { POST as postAuthRegister } from "../auth/register/route";
import { POST as postSpaceCacheInvalidate } from "../space-cache/invalidate/route";

const PUBLIC_HOST = "https://memroos.example.com";

beforeEach(() => {
  vi.mocked(authenticateUser).mockReset();
  vi.mocked(authenticateAgentHeaders).mockReset();
  vi.mocked(authorizeRegistryWrite).mockReset();
  delete process.env.MEMROOS_OPERATOR_API_KEY;
  delete process.env.MEMROOS_AGENT_API_KEY;
});

describe("long-tail batch 11b — API routes", () => {
  it("GET /api/cache/stats returns metric envelopes", async () => {
    const res = await getCacheStats();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { stats: { entries: number }; metrics: Record<string, unknown> };
    expect(typeof body.stats.entries).toBe("number");
    expect(body.metrics.entries).toBeTruthy();
  });

  it("GET /api/audit/export requires operator session", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce(null);
    const res = await getAuditExport(
      new Request(`${PUBLIC_HOST}/api/audit/export?format=ndjson`) as NextRequest
    );
    expect([401, 403]).toContain(res.status);
  });

  it("GET /api/audit/export streams ndjson for operators", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce({
      userId: "u1",
      role: "operator",
      email: "ops@example.com",
      displayName: "Ops",
      tenantId: "default-tenant",
    });
    const res = await getAuditExport(
      new Request(`${PUBLIC_HOST}/api/audit/export?format=ndjson`) as NextRequest
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
  });

  it("GET /api/agents/versions requires registry write", async () => {
    vi.mocked(authorizeRegistryWrite).mockReturnValueOnce(false);
    const res = await getAgentVersions(new Request(`${PUBLIC_HOST}/api/agents/versions?agentId=a1`));
    expect(res.status).toBe(403);
  });

  it("GET /api/agents/versions validates agentId", async () => {
    vi.mocked(authorizeRegistryWrite).mockReturnValueOnce(true);
    const res = await getAgentVersions(new Request(`${PUBLIC_HOST}/api/agents/versions`));
    expect(res.status).toBe(400);
  });

  it("POST /api/agents/versions rejects invalid payloads", async () => {
    vi.mocked(authorizeRegistryWrite).mockReturnValueOnce(true);
    const res = await postAgentVersions(
      new Request(`${PUBLIC_HOST}/api/agents/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "only-id" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/evals/run requires registry write and a trace body", async () => {
    vi.mocked(authorizeRegistryWrite).mockReturnValueOnce(false);
    const denied = await postEvalsRun(
      new Request(`${PUBLIC_HOST}/api/evals/run`, {
        method: "POST",
        body: JSON.stringify({ trace: {} }),
      }) as NextRequest
    );
    expect(denied.status).toBe(403);

    vi.mocked(authorizeRegistryWrite).mockReturnValueOnce(true);
    const invalid = await postEvalsRun(
      new Request(`${PUBLIC_HOST}/api/evals/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trace: { traceId: "t1" } }),
      }) as NextRequest
    );
    expect(invalid.status).toBe(400);
  });

  it("GET /api/evidence/task-bundles requires taskId", async () => {
    const res = await getEvidenceTaskBundles(new Request(`${PUBLIC_HOST}/api/evidence/task-bundles`));
    expect(res.status).toBe(400);
  });

  it("POST /api/evidence/task-bundles validates auth and JSON", async () => {
    vi.mocked(authorizeRegistryWrite).mockReturnValueOnce(false);
    const denied = await postEvidenceTaskBundles(
      new Request(`${PUBLIC_HOST}/api/evidence/task-bundles`, {
        method: "POST",
        body: JSON.stringify({ taskId: "task-1" }),
      })
    );
    expect(denied.status).toBe(403);

    vi.mocked(authorizeRegistryWrite).mockReturnValueOnce(true);
    const badJson = await postEvidenceTaskBundles(
      new Request(`${PUBLIC_HOST}/api/evidence/task-bundles`, { method: "POST", body: "{" })
    );
    expect(badJson.status).toBe(400);
  });

  it("GET /api/gitnexus returns repo inventory JSON", async () => {
    const registryPath = path.join(os.tmpdir(), `gitnexus-reg-${randomUUID()}.json`);
    fs.writeFileSync(
      registryPath,
      JSON.stringify([{ name: "memroos", path: os.tmpdir(), stats: { files: 1, nodes: 2, edges: 3, communities: 1, processes: 1 } }])
    );
    process.env.GITNEXUS_REGISTRY = registryPath;
    vi.resetModules();
    const { GET } = await import("../gitnexus/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { repos: Array<{ name: string }> };
    expect(body.repos.some((r) => r.name === "memroos")).toBe(true);
    delete process.env.GITNEXUS_REGISTRY;
    fs.rmSync(registryPath, { force: true });
  });

  it("POST /api/auth/register rejects invalid JSON bodies", async () => {
    const res = await postAuthRegister(
      new Request(`${PUBLIC_HOST}/api/auth/register`, { method: "POST", body: "not-json" }) as NextRequest
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/space-cache/invalidate surfaces handler errors as 400", async () => {
    vi.mocked(authenticateAgentHeaders).mockReturnValueOnce({ id: "agent-1" } as never);
    const res = await postSpaceCacheInvalidate(
      new Request(`${PUBLIC_HOST}/api/space-cache/invalidate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spaceId: `missing-${randomUUID()}` }),
      }) as never
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error.length).toBeGreaterThan(0);
  });
});
