// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => false));

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () =>
    Response.json({ ok: false, error: "unauthorized" }, { status: 403 }),
}));

vi.mock("@/lib/skills/activity-suggestions", () => ({
  buildSkillSuggestionAudit: vi.fn(() => [{ id: "s1", skill: "browser", status: "proposed" }]),
  persistSkillSuggestions: vi.fn(),
}));

const { GET, PATCH } = await import("../route");

describe("/api/skills/suggestions", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReset();
    authorizeRegistryWrite.mockReturnValue(true);
    testDb.prepare("DELETE FROM skill_suggestions").run();
    testDb
      .prepare(
        `INSERT INTO skill_suggestions (id, name, source_pattern, recommendation, confidence, status)
         VALUES ('s1', 'browser', 'pattern', 'add skill', 0.8, 'proposed')`
      )
      .run();
  });

  it("GET returns suggestions audit window", async () => {
    const res = await GET(new Request("http://localhost/api/skills/suggestions?days=7") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.suggestions).toHaveLength(1);
  });

  it("PATCH returns 403 without operator auth", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    const res = await PATCH(
      new Request("http://localhost/api/skills/suggestions", {
        method: "PATCH",
        body: JSON.stringify({ id: "s1", status: "approved" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("PATCH updates suggestion status", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/skills/suggestions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "s1", status: "approved" }),
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
