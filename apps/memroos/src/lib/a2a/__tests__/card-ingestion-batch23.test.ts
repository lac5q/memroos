// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { fetchA2aAgentCard, isAllowedAgentCardUrl } from "../card-ingestion";
import { A2aError } from "../errors";

describe("a2a card-ingestion batch23 — URL guardrails and fetch validation", () => {
  it("isAllowedAgentCardUrl rejects credentials, metadata hosts, and CGNAT ranges", () => {
    const strict = { allowPrivateNetworkCards: false, remoteCardTimeoutMs: 1000 } as const;
    expect(isAllowedAgentCardUrl("https://user:pass@example.com/card.json", strict)).toBe(false);
    expect(isAllowedAgentCardUrl("https://169.254.169.254/latest/meta-data", strict)).toBe(false);
    expect(isAllowedAgentCardUrl("http://100.64.0.1/card.json", strict)).toBe(false);
    expect(isAllowedAgentCardUrl("not-a-url", strict)).toBe(false);
  });

  it("fetchA2aAgentCard rejects invalid JSON payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => null },
        text: async () => "{not-json",
      })),
    );
    await expect(
      fetchA2aAgentCard("https://agents.example.com/card.json", {
        allowPrivateNetworkCards: true,
        remoteCardTimeoutMs: 1000,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    vi.unstubAllGlobals();
  });

  it("fetchA2aAgentCard propagates A2aError from validateA2aAgentCard", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => null },
        text: async () => JSON.stringify({ name: "missing-skills", url: "https://x", version: "1" }),
      })),
    );
    await expect(
      fetchA2aAgentCard("https://agents.example.com/card.json", {
        allowPrivateNetworkCards: true,
        remoteCardTimeoutMs: 1000,
      }),
    ).rejects.toBeInstanceOf(A2aError);
    vi.unstubAllGlobals();
  });
});
