// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () => Response.json({ ok: false, error: "forbidden" }, { status: 403 }),
}));

vi.mock("@/lib/orchestration/client", () => ({
  executeOrchestrationPlan: vi.fn(),
}));

vi.mock("@/lib/federation/action-bridge", () => ({
  persistFederationActionArtifact: vi.fn(),
  resolveFederationActionProof: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({}),
}));

const { POST } = await import("../route");

describe("POST /api/orchestration/federated/execute", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReset();
    authorizeRegistryWrite.mockReturnValue(true);
  });

  afterEach(() => {
    delete process.env.ORCHESTRATION_FEDERATION_PROOF_SECRET;
  });

  it("returns 403 when registry write is unauthorized", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    const res = await POST(new Request("http://localhost/api/orchestration/federated/execute", { method: "POST", body: "{}" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when federation bridge input is invalid", async () => {
    const res = await POST(
      new Request("http://localhost/api/orchestration/federated/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: { scope: { tenantId: "t1", spaceId: "s1" } } }),
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ reason: "federation_bridge_input_invalid" });
  });

  it("returns 503 when federation proof signing is unavailable", async () => {
    const { persistFederationActionArtifact, resolveFederationActionProof } = await import("@/lib/federation/action-bridge");
    vi.mocked(persistFederationActionArtifact).mockReturnValueOnce({
      status: "ready",
      artifact: {
        id: "art-1",
        artifactHash: "hash-1",
        federationRunId: "fed-1",
        packHash: "pack-1",
        policyHash: "policy-1",
        ontologyHash: "ontology-1",
      },
    } as never);
    vi.mocked(resolveFederationActionProof).mockReturnValueOnce({
      status: "ready",
      artifact: {
        id: "art-1",
        artifactHash: "hash-1",
        federationRunId: "fed-1",
        packHash: "pack-1",
        policyHash: "policy-1",
        ontologyHash: "ontology-1",
      },
    } as never);

    const res = await POST(
      new Request("http://localhost/api/orchestration/federated/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          federation: {
            tenantId: "default-tenant",
            spaceId: "space-1",
            federationRunId: "fed-1",
            packHash: "pack-1",
          },
          plan: { scope: { tenantId: "default-tenant", spaceId: "space-1" }, steps: [] },
        }),
      })
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ reason: "federation_proof_signing_unavailable" });
  });
});
