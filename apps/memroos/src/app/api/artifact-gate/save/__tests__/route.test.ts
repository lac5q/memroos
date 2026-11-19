// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";
import { loadWorkspace } from "@/lib/workspace";

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

describe("POST /api/artifact-gate/save", () => {
  let spaceId = "";

  beforeEach(() => {
    spaceId = createSpace(testDb, { tenantId: "default-tenant", name: `save-${Date.now()}` }).id;
    loadWorkspace(testDb, { spaceId, actorId: "agent-1" });
  });

  it("returns 400 when required fields missing", async () => {
    const res = await POST(
      new Request("http://localhost/api/artifact-gate/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId }),
      }) as never
    );
    expect(res.status).toBe(400);
  });

  it("saves artifact in active workspace", async () => {
    const res = await POST(
      new Request("http://localhost/api/artifact-gate/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spaceId,
          artifactName: "runbook.md",
          artifactType: "markdown",
          resourceId: "res-001",
          beliefStage: "hypothesis",
        }),
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.documentDirectoryEntry?.name).toBe("runbook.md");
  });
});
