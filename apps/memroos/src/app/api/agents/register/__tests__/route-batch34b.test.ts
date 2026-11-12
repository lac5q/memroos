// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () =>
    Response.json({ ok: false, error: "unauthorized" }, { status: 403 }),
}));

const LOOPBACK = "http://localhost";

function jsonPost(body: Record<string, unknown>) {
  return new Request(`${LOOPBACK}/api/agents/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/agents/register batch34b", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReset();
    authorizeRegistryWrite.mockReturnValue(true);
    vi.resetModules();
  });

  it("registers with optional host, capability filtering, and issueApiKey=false", async () => {
    const { POST } = await import("../route");
    const id = `agent-b34b-${randomUUID().slice(0, 8)}`;
    const res = await POST(
      jsonPost({
        id,
        name: "Full Register",
        role: "Worker",
        platform: "codex",
        protocol: "rest",
        company: "MemRoOS Labs",
        location: "cloudflare",
        host: "localhost",
        port: 8080,
        healthEndpoint: "/health",
        tunnelUrl: "http://localhost/tunnel",
        capabilities: [
          { id: "cap-1", name: "Primary", description: "main", tags: ["a"] },
          { id: "", name: "Dropped", description: "" },
          "not-a-record",
          { name: "No id", description: "skip" },
        ],
        metadata: { lane: "batch34b" },
        issueApiKey: false,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.agent).toMatchObject({
      id,
      company: "MemRoOS Labs",
      location: "cloudflare",
      host: "localhost",
      port: 8080,
      healthEndpoint: "/health",
      tunnelUrl: "http://localhost/tunnel",
      metadata: { lane: "batch34b" },
    });
    expect(body.agent.capabilities).toEqual([
      expect.objectContaining({ id: "cap-1", name: "Primary", tags: ["a"] }),
    ]);
    expect(body.apiKey).toBeUndefined();
  });

  it("accepts tailscale location and drops invalid location values", async () => {
    const { POST } = await import("../route");
    const tailscaleId = `agent-ts-b34b-${randomUUID().slice(0, 6)}`;
    const tailscale = await POST(
      jsonPost({
        id: tailscaleId,
        name: "Tailscale",
        role: "Edge",
        platform: "cursor",
        protocol: "a2a",
        location: "tailscale",
      }),
    );
    expect(tailscale.status).toBe(200);
    expect((await tailscale.json()).agent.location).toBe("tailscale");

    const invalid = await POST(
      jsonPost({
        id: `agent-badloc-b34b-${randomUUID().slice(0, 6)}`,
        name: "Bad Loc",
        role: "Edge",
        platform: "cursor",
        protocol: "a2a",
        location: "mars",
      }),
    );
    expect(invalid.status).toBe(200);
    expect((await invalid.json()).agent.location).not.toBe("mars");
  });

  it("defaults capability tags to [] and omits metadata when not an object", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      jsonPost({
        id: `agent-meta-b34b-${randomUUID().slice(0, 8)}`,
        name: "Sparse Meta",
        role: "Worker",
        platform: "qwen",
        protocol: "local",
        capabilities: [{ id: "c2", name: "Only Id", description: "" }],
        metadata: ["not", "record"],
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agent.capabilities[0].tags).toEqual([]);
    expect(body.agent.metadata ?? {}).toEqual({});
  });
});
