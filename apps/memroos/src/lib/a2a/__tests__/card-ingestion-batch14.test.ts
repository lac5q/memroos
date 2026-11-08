// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { A2aError } from "@/lib/a2a/errors";

async function loadIngestion() {
  return import("@/lib/a2a/card-ingestion");
}

describe("card-ingestion batch14 — URL allowlist and fetch edges", () => {
  it("isAllowedAgentCardUrl rejects private RFC1918 hosts when disallowed", async () => {
    const { isAllowedAgentCardUrl } = await loadIngestion();
    const strict = { allowPrivateNetworkCards: false } as Parameters<typeof isAllowedAgentCardUrl>[1];
    expect(isAllowedAgentCardUrl("http://10.0.0.5/card.json", strict)).toBe(false);
    expect(isAllowedAgentCardUrl("http://192.168.1.10/card.json", strict)).toBe(false);
    expect(isAllowedAgentCardUrl("http://172.16.0.2/card.json", strict)).toBe(false);
    expect(isAllowedAgentCardUrl("http://localhost/card.json", strict)).toBe(false);
  });

  it("validateA2aAgentCard normalizes partial skill entries", async () => {
    const { validateA2aAgentCard } = await loadIngestion();
    const card = validateA2aAgentCard({
      name: "Agent",
      url: "http://localhost:8080/rpc",
      version: "1.0.0",
      skills: [{ id: "skill-a", name: "", description: "desc", tags: ["x"] }],
    });
    expect(card.skills[0]?.name).toBe("skill-a");
  });

  it("fetchA2aAgentCard rejects oversize bodies and invalid JSON", async () => {
    const { fetchA2aAgentCard } = await loadIngestion();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => null },
        text: async () => "not-json",
      })),
    );
    await expect(fetchA2aAgentCard("http://localhost/card.json")).rejects.toThrow(A2aError);
    vi.unstubAllGlobals();
  });
});
