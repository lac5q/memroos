// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { createOpenAICompatibleCoveClient } from "../index";

describe("cove batch33", () => {
  it("endpointForChatCompletions preserves existing /chat/completions suffix (57)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "1. Question?\n2. Another?" } }] }), {
        status: 200,
      }),
    );
    const client = createOpenAICompatibleCoveClient({
      endpoint: "http://localhost:11434/v1/chat/completions",
      model: "qwen-b33",
      fetchImpl,
    });
    await client("verify batch33");
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://localhost:11434/v1/chat/completions");
  });

  it("adds Authorization header when apiKey is set (65)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    const key = `sk-b33-${randomUUID().slice(0, 12)}`;
    const client = createOpenAICompatibleCoveClient({
      endpoint: "http://localhost:11434/v1",
      model: "qwen-b33",
      apiKey: key,
      fetchImpl,
    });
    await client("verify auth");
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${key}`);
  });
});
