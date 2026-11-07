// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callRest, callTool, initialize } from "../mcp-client";

describe("mcp-client JSON-RPC transport", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initialize completes on plain JSON initialize result", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { capabilities: {} } }), {
        status: 200,
      })
    );
    await expect(initialize("https://mcp.example/rpc", "tok")).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      "https://mcp.example/rpc",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
      })
    );
  });

  it("parses SSE data lines for tools/call", async () => {
    const sse = [
      "event: message",
      'data: {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\\"issues\\":[]}"}]}}',
      "",
    ].join("\n");
    vi.mocked(fetch).mockResolvedValue(new Response(sse, { status: 200 }));

    const result = await callTool("https://mcp.example/rpc", "tok", "list_issues", { limit: 5 });
    expect(result.payload).toEqual({ issues: [] });
  });

  it("throws McpError on HTTP failures and JSON-RPC errors", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("nope", { status: 502 }));
    await expect(initialize("https://mcp.example/rpc", "tok")).rejects.toSatisfy(
      (err: unknown) => err instanceof Error && err.message.includes("HTTP 502")
    );

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('data: {"jsonrpc":"2.0","id":1,"error":{"message":"denied"}}', { status: 200 })
    );
    await expect(initialize("https://mcp.example/rpc", "tok")).rejects.toSatisfy(
      (err: unknown) => err instanceof Error && err.message.includes("denied")
    );
  });

  it("throws when tool response has no text block", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"image"}]}}', {
        status: 200,
      })
    );
    await expect(callTool("https://mcp.example/rpc", "tok", "list_issues", {})).rejects.toSatisfy(
      (err: unknown) => err instanceof Error && err.message.includes("no text content")
    );
  });

  it("throws when response body has no parseable JSON-RPC result", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("not json at all", { status: 200 }));
    await expect(initialize("https://mcp.example/rpc", "tok")).rejects.toSatisfy(
      (err: unknown) => err instanceof Error && err.message.includes("no parseable result")
    );
  });

  it("callRest serializes object query params on GET", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    await callRest("https://rest.example", "tok", {
      method: "GET",
      path: "/v1/items",
      body: { filter: { state: "open" }, page: 2 },
    });
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("filter=");
    expect(String(url)).toContain("page=2");
  });
});
