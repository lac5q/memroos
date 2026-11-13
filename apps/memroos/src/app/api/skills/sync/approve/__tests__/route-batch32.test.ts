// @vitest-environment node
import { describe, expect, it } from "vitest";

const { POST } = await import("../route");

describe("POST /api/skills/sync/approve batch32", () => {
  it("rejects non-object JSON bodies (lines 50-51)", async () => {
    const res = await POST(
      new Request("http://localhost/api/skills/sync/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(["not", "an", "object"]),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "Body must be an object" });
  });

  it("requires source_harness (lines 64-65)", async () => {
    const res = await POST(
      new Request("http://localhost/api/skills/sync/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          skill_name: "test-skill",
          operator: "op-b32",
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/source_harness/);
  });
});
