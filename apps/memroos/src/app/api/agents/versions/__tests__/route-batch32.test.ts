// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: () => true,
  registryWriteUnauthorizedResponse: () => Response.json({ ok: false }, { status: 401 }),
}));

const listAgentVersions = vi.hoisted(() => vi.fn());

vi.mock("@/lib/agent-cicd-gates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-cicd-gates")>();
  return {
    ...actual,
    listAgentVersions: (...args: unknown[]) => listAgentVersions(...args),
  };
});

const TMP = path.join(os.tmpdir(), `agents-versions-b32-${randomUUID()}`);

beforeEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  process.env.SQLITE_DB_PATH = path.join(TMP, `${randomUUID()}.db`);
  listAgentVersions.mockReset();
});

afterEach(async () => {
  const { closeDb } = await import("@/lib/db");
  closeDb();
  delete process.env.SQLITE_DB_PATH;
  fs.rmSync(TMP, { recursive: true, force: true });
  vi.resetModules();
});

describe("agents/versions route batch32", () => {
  it("GET returns 500 when listAgentVersions throws (lines 56-57)", async () => {
    listAgentVersions.mockImplementation(() => {
      throw new Error(`list-fail-${randomUUID()}`);
    });
    const { GET } = await import("../route");
    const res = await GET(
      new Request(`http://localhost/api/agents/versions?agentId=agent-${randomUUID().slice(0, 6)}`),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.message).toMatch(/list-fail/);
  });

  it("POST maps non-Error throws to Unknown error (branch line 28)", async () => {
    const createAgentVersion = vi.fn(() => {
      throw { code: "bad" };
    });
    vi.doMock("@/lib/agent-cicd-gates", () => ({
      createAgentVersion,
      listAgentVersions,
    }));
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/agents/versions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "a1", version: "1.0.0" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ status: "error", message: "Unknown error" });
  });
});
