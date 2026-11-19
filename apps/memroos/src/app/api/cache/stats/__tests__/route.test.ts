// @vitest-environment node
import { describe, expect, it } from "vitest";

import { GET } from "../route";

describe("GET /api/cache/stats", () => {
  it("returns response cache stats and metric envelopes", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stats).toBeDefined();
    expect(body.metrics.entries.status).toMatch(/live|unavailable/);
    expect(body.metrics.hitRate).toBeDefined();
    expect(body.timestamp).toMatch(/^\d{4}-/);
  });
});
