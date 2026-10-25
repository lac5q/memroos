// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/constants", () => ({
  MEM0_URL: "http://mem0.test.local",
  CLAUDE_MEMORY_PATH: "/tmp/claude-memory.md",
}));

vi.mock("@/lib/parsers", () => ({
  parseClaudeMemory: vi.fn(async () => ({ entries: [] })),
}));

const { parseClaudeMemory } = await import("@/lib/parsers");
const { GET } = await import("../route");

function memoryRequest(url: string) {
  const nextUrl = new URL(url);
  return { nextUrl, url: nextUrl.toString() } as never;
}

describe("GET /api/memory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ results: [{ id: "m1" }] }))
    );
  });

  it("returns mem0 and claude payloads for source=all", async () => {
    const res = await GET(memoryRequest("http://localhost/api/memory?q=hello"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mem0).toEqual({ results: [{ id: "m1" }] });
    expect(body.claude).toEqual({ entries: [] });
    expect(body.timestamp).toBeTruthy();
  });

  it("returns mem0 unavailable when fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
    const res = await GET(memoryRequest("http://localhost/api/memory?source=mem0"));
    const body = await res.json();
    expect(body.mem0).toEqual({ error: "mem0 unavailable" });
    expect(parseClaudeMemory).not.toHaveBeenCalled();
  });

  it("loads claude only when source=claude", async () => {
    const res = await GET(memoryRequest("http://localhost/api/memory?source=claude"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.claude).toEqual({ entries: [] });
    expect(body.mem0).toBeUndefined();
  });
});
