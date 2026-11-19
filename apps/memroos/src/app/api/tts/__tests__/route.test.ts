// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { POST } = await import("../route");

describe("POST /api/tts", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.unstubAllEnvs();
    delete process.env.ELEVENLABS_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 400 when text missing", async () => {
    const res = await POST(
      new Request("http://localhost/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "   " }),
      }) as never
    );
    expect(res.status).toBe(400);
  });

  it("returns 500 when ELEVENLABS_API_KEY unset", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const res = await POST(
      new Request("http://localhost/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hello", agentId: "ceo" }),
      }) as never
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "ELEVENLABS_API_KEY not set" });
  });

  it("proxies ElevenLabs errors", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    fetchMock.mockResolvedValue(
      new Response("rate limited", { status: 429, statusText: "Too Many Requests" })
    );
    const res = await POST(
      new Request("http://localhost/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hello" }),
      }) as never
    );
    expect(res.status).toBe(429);
  });

  it("returns audio/mpeg on success", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    const audioBytes = new Uint8Array([1, 2, 3]);
    fetchMock.mockResolvedValue(
      new Response(audioBytes, { status: 200, headers: { "Content-Type": "audio/mpeg" } })
    );
    const res = await POST(
      new Request("http://localhost/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hello", agentId: "unknown-agent" }),
      }) as never
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf).toEqual(audioBytes);
    expect(fetchMock.mock.calls[0][0]).toMatch(/text-to-speech\//);
  });
});
