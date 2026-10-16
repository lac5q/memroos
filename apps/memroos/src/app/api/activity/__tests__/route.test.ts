// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const readFile = vi.fn();
const readdir = vi.fn();
const stat = vi.fn();

vi.mock("fs/promises", () => ({
  readFile,
  readdir,
  stat,
}));

const { GET } = await import("../route");

describe("GET /api/activity", () => {
  beforeEach(() => {
    readFile.mockReset();
    readdir.mockReset();
    stat.mockReset();
  });

  it("returns empty events when sources are unavailable", async () => {
    readFile.mockRejectedValue(new Error("missing log"));
    readdir.mockRejectedValue(new Error("missing dir"));

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.events).toEqual([]);
    expect(data).toHaveProperty("nodeActivity");
    expect(typeof data.timestamp).toBe("string");
  });

  it("parses cron log lines into typed activity events", async () => {
    readFile.mockResolvedValue(
      [
        "2026-01-15T10:00:00 PROPOSAL created skill-x",
        "2026-01-15T10:01:00 ERROR something FAILed",
        "2026-01-15T10:02:00 audit scan QMD search hit",
        "2026-01-15T10:03:00 mem0 memory remember flush",
        "2026-01-15T10:04:00 Starting APO cycle Complete",
      ].join("\n")
    );
    readdir.mockRejectedValue(new Error("no agents"));

    const res = await GET();
    const data = await res.json();
    expect(data.events.length).toBeGreaterThan(0);
    const types = new Set(data.events.map((e: { type: string }) => e.type));
    expect(types.has("apo")).toBe(true);
    expect(types.has("error")).toBe(true);
    expect(types.has("knowledge")).toBe(true);
    expect(types.has("memory")).toBe(true);
    expect(data.events.length).toBeLessThanOrEqual(20);
  });

  it("includes recent agent heartbeats and pending proposals", async () => {
    readFile.mockRejectedValue(new Error("no log"));
    readdir.mockImplementation(async (dir: string) => {
      if (String(dir).includes("proposals")) return ["APO_PROPOSAL_test.md"];
      return ["ceo"];
    });
    stat.mockResolvedValue({ mtime: new Date() });

    const res = await GET();
    const data = await res.json();
    const messages = data.events.map((e: { message: string }) => e.message);
    expect(messages.some((m: string) => m.includes("heartbeat"))).toBe(true);
    expect(messages.some((m: string) => m.includes("APO proposal pending"))).toBe(true);
  });
});
