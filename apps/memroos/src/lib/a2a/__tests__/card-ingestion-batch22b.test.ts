// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  fetchA2aAgentCard,
  isAllowedAgentCardUrl,
  validateA2aAgentCard,
} from "../card-ingestion";
import { A2aError } from "../errors";

describe("a2a card-ingestion batch22b — URL policy and fetch guards", () => {
  it("isAllowedAgentCardUrl rejects metadata and private-network hosts when disallowed", () => {
    const strict = { allowPrivateNetworkCards: false, remoteCardTimeoutMs: 1000 } as const;
    expect(isAllowedAgentCardUrl("http://169.254.169.254/card.json", strict)).toBe(false);
    expect(isAllowedAgentCardUrl("http://192.168.1.10/card.json", strict)).toBe(false);
    expect(isAllowedAgentCardUrl("http://172.16.0.2/card.json", strict)).toBe(false);
    expect(isAllowedAgentCardUrl("http://100.64.0.2/card.json", strict)).toBe(false);
  });

  it("validateA2aAgentCard normalizes malformed skill entries", () => {
    const card = validateA2aAgentCard({
      name: "Agent",
      version: "1.0.0",
      url: "http://localhost:8080/rpc",
      skills: [{ id: "skill-1", name: "Do work", tags: [1, "ops"] }],
    });
    expect(card.skills[0]?.tags).toEqual(["ops"]);
  });

  it("fetchA2aAgentCard rejects oversize bodies and invalid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => null },
        text: async () => "not-json",
      })),
    );
    await expect(fetchA2aAgentCard("http://example.com/card.json", { allowPrivateNetworkCards: true, remoteCardTimeoutMs: 1000 })).rejects.toBeInstanceOf(A2aError);
    vi.unstubAllGlobals();
  });
});
