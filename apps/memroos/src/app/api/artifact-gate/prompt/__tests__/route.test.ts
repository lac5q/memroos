// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: vi.fn(() => ({ id: "agent-1" })),
}));

const { POST } = await import("../route");

describe("POST /api/artifact-gate/prompt", () => {
  let spaceId = "";

  beforeEach(() => {
    spaceId = createSpace(testDb, { tenantId: "default-tenant", name: `prompt-${Date.now()}` }).id;
  });

  it("returns 401 without auth", async () => {
    const { authenticateAgentHeaders } = await import("@/lib/agent-registry");
    vi.mocked(authenticateAgentHeaders).mockReturnValueOnce(null);
    const res = await POST(
      new Request("http://localhost/api/artifact-gate/prompt", {
        method: "POST",
        body: JSON.stringify({ spaceId, artifactName: "a", artifactType: "doc" }),
      }) as never
    );
    expect(res.status).toBe(401);
  });

  it("returns prompt payload for valid input", async () => {
    const res = await POST(
      new Request("http://localhost/api/artifact-gate/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId, artifactName: "notes.md", artifactType: "markdown" }),
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.prompt).toBeTruthy();
  });
});
