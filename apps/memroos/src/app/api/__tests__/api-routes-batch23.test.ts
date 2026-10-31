// @vitest-environment node
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";

const LOOPBACK = "http://localhost";
const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthorizeRegistryWrite = vi.fn(() => true);
const mockAuthenticateAgent = vi.fn(() => ({ id: "agent-b23" }));
const mockAuthenticateUser = vi.fn();
const mockQueryGraphMemory = vi.fn();
const mockFilterAuthorized = vi.fn((_: unknown, items: unknown[]) => items);
const mockExecuteOrchestrationPlan = vi.fn();
const mockPersistArtifact = vi.fn();
const mockResolveProof = vi.fn();
const mockGetWriteRules = vi.fn();
const mockCreateWriteRule = vi.fn();
const mockGetActiveWorkspace = vi.fn();
const mockLoadWorkspace = vi.fn();
const mockClearWorkspace = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => mockAuthorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () => Response.json({ ok: false, error: "forbidden" }, { status: 403 }),
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: (...args: unknown[]) => mockAuthenticateAgent(...args),
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

vi.mock("@/lib/memory/backends", () => ({
  queryGraphMemory: (...args: unknown[]) => mockQueryGraphMemory(...args),
}));

vi.mock("@/lib/memory/policy-gate", () => ({
  filterAuthorizedMemoryItems: (...args: unknown[]) => mockFilterAuthorized(...args),
  extractMemoryLabelSnapshot: vi.fn(),
}));

vi.mock("@/lib/orchestration/client", () => ({
  executeOrchestrationPlan: (...args: unknown[]) => mockExecuteOrchestrationPlan(...args),
}));

vi.mock("@/lib/federation/action-bridge", () => ({
  persistFederationActionArtifact: (...args: unknown[]) => mockPersistArtifact(...args),
  resolveFederationActionProof: (...args: unknown[]) => mockResolveProof(...args),
}));

vi.mock("@/lib/write-rules", () => ({
  getWriteRules: (...args: unknown[]) => mockGetWriteRules(...args),
  createWriteRule: (...args: unknown[]) => mockCreateWriteRule(...args),
}));

vi.mock("@/lib/workspace", () => ({
  getActiveWorkspace: (...args: unknown[]) => mockGetActiveWorkspace(...args),
  loadWorkspace: (...args: unknown[]) => mockLoadWorkspace(...args),
  clearWorkspace: (...args: unknown[]) => mockClearWorkspace(...args),
}));

function asNext(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

beforeEach(() => {
  mockAuthorizeRegistryWrite.mockReturnValue(true);
  mockAuthenticateAgent.mockReturnValue({ id: "agent-b23" });
  mockAuthenticateUser.mockResolvedValue(null);
  mockQueryGraphMemory.mockReset();
  mockFilterAuthorized.mockImplementation((_, items: unknown[]) => items);
  mockExecuteOrchestrationPlan.mockReset();
  mockPersistArtifact.mockReset();
  mockResolveProof.mockReset();
  mockGetWriteRules.mockReset();
  mockCreateWriteRule.mockReset();
  mockGetActiveWorkspace.mockReset();
  mockLoadWorkspace.mockReset();
  mockClearWorkspace.mockReset();
  vi.resetModules();
});

afterEach(() => {
  delete process.env.MEMROOS_OPERATOR_API_KEY;
  delete process.env.MEMROOS_AGENT_API_KEY;
  vi.unstubAllEnvs();
});

describe("api routes batch23 — workspace, write-rules, memory/graph", () => {
  it("GET /api/workspace returns 500 when active workspace lookup fails", async () => {
    mockGetActiveWorkspace.mockImplementation(() => {
      throw new Error("workspace read batch23");
    });
    const { GET } = await import("../workspace/route");
    const res = await GET(asNext(`${LOOPBACK}/api/workspace`, { headers: { authorization: "Bearer k" } }));
    expect(res.status).toBe(500);
  });

  it("POST /api/workspace uses body agent hints and returns 400 on load failure", async () => {
    mockLoadWorkspace.mockImplementation(() => {
      throw new Error("workspace load batch23");
    });
    const space = createSpace(testDb, { tenantId: "default-tenant", name: "ws-b23" });
    const { POST } = await import("../workspace/route");
    const res = await POST(
      asNext(`${LOOPBACK}/api/workspace`, {
        method: "POST",
        headers: { authorization: "Bearer k", "content-type": "application/json" },
        body: JSON.stringify({ spaceId: space.id, agentId: "agent-b23" }),
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "workspace load batch23" });
  });

  it("DELETE /api/workspace returns 500 when clear fails", async () => {
    mockClearWorkspace.mockImplementation(() => {
      throw new Error("workspace clear batch23");
    });
    const { DELETE } = await import("../workspace/route");
    const res = await DELETE(asNext(`${LOOPBACK}/api/workspace`, { headers: { authorization: "Bearer k" } }));
    expect(res.status).toBe(500);
  });

  it("GET /api/write-rules returns 500 when rule lookup fails", async () => {
    mockGetWriteRules.mockImplementation(() => {
      throw new Error("rules read batch23");
    });
    const space = createSpace(testDb, { tenantId: "default-tenant", name: "wr-b23" });
    const { GET } = await import("../write-rules/route");
    const res = await GET(
      asNext(`${LOOPBACK}/api/write-rules?spaceId=${space.id}`, { headers: { authorization: "Bearer k" } })
    );
    expect(res.status).toBe(500);
  });

  it("POST /api/write-rules returns 400 when createWriteRule throws", async () => {
    mockCreateWriteRule.mockImplementation(() => {
      throw new Error("rules create batch23");
    });
    const space = createSpace(testDb, { tenantId: "default-tenant", name: "wr-post-b23" });
    const { POST } = await import("../write-rules/route");
    const res = await POST(
      asNext(`${LOOPBACK}/api/write-rules`, {
        method: "POST",
        headers: { authorization: "Bearer k", "content-type": "application/json" },
        body: JSON.stringify({
          spaceId: space.id,
          agentId: "agent-b23",
          dataType: "decision_intent",
          targetDocument: "decisions.md",
        }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/memory/graph handles array results and non-result objects", async () => {
    mockQueryGraphMemory.mockResolvedValueOnce([{ node: { id: "n-array" } }]);
    const { GET } = await import("../memory/graph/route");
    const arrayRes = await GET(new Request(`${LOOPBACK}/api/memory/graph?q=array`));
    expect(arrayRes.status).toBe(200);

    mockQueryGraphMemory.mockResolvedValueOnce({ meta: "only" });
    const objectRes = await GET(new Request(`${LOOPBACK}/api/memory/graph?q=object`));
    expect(objectRes.status).toBe(200);
    expect(await objectRes.json()).toMatchObject({ ok: true, tier: "graph" });
  });
});

describe("api routes batch23 — federated execute, directives, native-memory, knowledge, time-series", () => {
  it("POST /api/orchestration/federated/execute handles invalid JSON, proof failures, and proxy errors", async () => {
    const { POST } = await import("../orchestration/federated/execute/route");
    const invalidJson = await POST(
      new Request(`${LOOPBACK}/api/orchestration/federated/execute`, {
        method: "POST",
        body: "{",
      })
    );
    expect(invalidJson.status).toBe(400);

    mockPersistArtifact.mockReturnValueOnce({
      status: "ready",
      artifact: {
        id: "art-b23",
        artifactHash: "hash-b23",
        federationRunId: "fed-b23",
        packHash: "pack-b23",
        policyHash: "policy-b23",
        ontologyHash: "ontology-b23",
      },
    });
    mockResolveProof.mockReturnValueOnce({ status: "missing", reason: "proof missing batch23" });
    const proofFail = await POST(
      new Request(`${LOOPBACK}/api/orchestration/federated/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          federation: {
            tenantId: "default-tenant",
            spaceId: "space-b23",
            federationRunId: "fed-b23",
            packHash: "pack-b23",
          },
          plan: { scope: { tenantId: "default-tenant", spaceId: "space-b23" }, steps: [] },
        }),
      })
    );
    expect(proofFail.status).toBe(409);

    process.env.ORCHESTRATION_FEDERATION_PROOF_SECRET = "secret-b23";
    mockPersistArtifact.mockReturnValueOnce({
      status: "ready",
      artifact: {
        id: "art-b23",
        artifactHash: "hash-b23",
        federationRunId: "fed-b23",
        packHash: "pack-b23",
        policyHash: "policy-b23",
        ontologyHash: "ontology-b23",
      },
    });
    mockResolveProof.mockReturnValueOnce({
      status: "ready",
      artifact: {
        id: "art-b23",
        artifactHash: "hash-b23",
        federationRunId: "fed-b23",
        packHash: "pack-b23",
        policyHash: "policy-b23",
        ontologyHash: "ontology-b23",
      },
    });
    mockExecuteOrchestrationPlan.mockRejectedValueOnce(new Error("orchestration down batch23"));
    const proxyFail = await POST(
      new Request(`${LOOPBACK}/api/orchestration/federated/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          federation: {
            tenantId: "default-tenant",
            spaceId: "space-b23",
            federationRunId: "fed-b23",
            packHash: "pack-b23",
          },
          plan: { scope: { tenantId: "default-tenant", spaceId: "space-b23" }, steps: [] },
        }),
      })
    );
    expect(proxyFail.status).toBe(502);
    delete process.env.ORCHESTRATION_FEDERATION_PROOF_SECRET;
  });

  it("GET /api/directives/diff rejects wrong API keys", async () => {
    process.env.MEMROOS_OPERATOR_API_KEY = "real-key";
    const { GET } = await import("../directives/diff/route");
    const res = await GET({
      nextUrl: new URL(`${LOOPBACK}/api/directives/diff`),
      headers: new Headers({ authorization: "Bearer wrong-key" }),
      json: async () => ({ local: "a", canonical: "b" }),
    } as unknown as NextRequest);
    expect(res.status).toBe(403);
  });

  it("POST /api/native-memory/ingest rejects wrong API keys", async () => {
    process.env.MEMROOS_OPERATOR_API_KEY = "real-key";
    const { POST } = await import("../native-memory/ingest/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/native-memory/ingest`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer wrong-key",
        },
        body: JSON.stringify({
          source: "claude",
          agentId: "a",
          userId: "u",
          content: "x",
          memoryPath: "/tmp/m.md",
        }),
      }) as never
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/knowledge surfaces scan failures and top-level handler errors", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "knowledge-b23-"));
    const configPath = path.join(root, "collections.config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        collections: [{ name: "broken", category: "agents" }],
      })
    );
    vi.doMock("@/lib/knowledge-collections", () => ({
      loadCollections: () => [{ name: "broken", category: "agents" }],
      resolveCollectionPaths: () => [path.join(root, "missing-dir")],
      scanConfiguredCollection: async () => {
        throw new Error("scan failed batch23");
      },
    }));
    vi.resetModules();
    vi.stubEnv("KNOWLEDGE_BASE_PATH", root);
    vi.stubEnv("COLLECTIONS_CONFIG_PATH", configPath);
    const { GET } = await import("../knowledge/route");
    const res = await GET();
    const body = await res.json();
    const broken = body.collections.find((c: { name: string }) => c.name === "broken");
    expect(broken.metric.status).toBe("error");

    vi.doMock("@/lib/knowledge-collections", () => ({
      loadCollections: () => {
        throw new Error("knowledge load batch23");
      },
      resolveCollectionPaths: () => [],
      scanConfiguredCollection: async () => ({ docCount: 0, lastUpdated: null }),
    }));
    vi.resetModules();
    vi.stubEnv("KNOWLEDGE_BASE_PATH", root);
    vi.stubEnv("COLLECTIONS_CONFIG_PATH", configPath);
    const { GET: GET2 } = await import("../knowledge/route");
    const errRes = await GET2();
    expect(errRes.status).toBe(500);
    vi.doUnmock("@/lib/knowledge-collections");
  });
});

