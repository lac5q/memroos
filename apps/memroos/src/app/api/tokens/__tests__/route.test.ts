// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/parsers", () => ({
  parseTokenStats: vi.fn(),
}));

const { parseTokenStats } = await import("@/lib/parsers");
const { GET } = await import("../route");

describe("GET /api/tokens", () => {
  beforeEach(() => {
    vi.mocked(parseTokenStats).mockReset();
  });

  it("returns available=false when RTK stats missing", async () => {
    vi.mocked(parseTokenStats).mockReturnValue(null);
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.available).toBe(false);
    expect(data.stats).toBeNull();
    expect(data.error).toBe("RTK not available");
  });

  it("returns available=true with stats when RTK present", async () => {
    const stats = { totalInput: 10, totalOutput: 5, totalCommands: 2 };
    vi.mocked(parseTokenStats).mockReturnValue(stats);
    const res = await GET();
    const data = await res.json();
    expect(data.available).toBe(true);
    expect(data.stats).toEqual(stats);
    expect(typeof data.timestamp).toBe("string");
  });
});
