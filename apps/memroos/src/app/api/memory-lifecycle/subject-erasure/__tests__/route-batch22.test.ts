// @vitest-environment node
import { describe, expect, it } from "vitest";

const REMOTE = "https://memroos.example.test";

describe("GET /api/memory-lifecycle/subject-erasure batch22", () => {
  it("returns 403 without registry write authorization on remote host", async () => {
    const { GET } = await import("../route");
    const res = GET(new Request(`${REMOTE}/api/memory-lifecycle/subject-erasure`));
    expect(res.status).toBe(403);
  });
});
