// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { A2aError } from "../errors";
import type { A2aAgentCard } from "../types";

describe("a2a card-ingestion batch33", () => {
  const baseCard: A2aAgentCard = {
    name: "Batch33 Agent",
    description: "test",
    url: "https://example.com/api",
    version: "1.0.0",
    preferredTransport: "HTTP+JSON",
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: [],
    defaultOutputModes: [],
    securitySchemes: {},
    security: [],
    skills: [],
    extensions: {},
  };

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch should be mocked");
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("isPrivateNetworkHost blocks localhost hostnames (42)", async () => {
    const { isAllowedAgentCardUrl } = await import("../card-ingestion");
    const { getA2aConfig } = await import("../config");
    const locked = { ...getA2aConfig(), allowPrivateNetworkCards: false };
    expect(isAllowedAgentCardUrl("http://localhost:3000/card-b33.json", locked)).toBe(false);
  });

  it("normalizeSkill mirrors id into name when name blank (76)", async () => {
    const { validateA2aAgentCard } = await import("../card-ingestion");
    const id = `sk-b33-${randomUUID().slice(0, 8)}`;
    const card = validateA2aAgentCard({
      ...baseCard,
      skills: [
        {
          id,
          name: "",
          description: "",
          tags: [],
          examples: [],
          inputModes: [],
          outputModes: [],
        },
      ],
    });
    expect(card.skills[0]?.name).toBe(id);
  });

  it("fetchA2aAgentCard rejects private localhost URLs (42–43)", async () => {
    const { fetchA2aAgentCard, isAllowedAgentCardUrl } = await import("../card-ingestion");
    const { getA2aConfig } = await import("../config");
    const cardUrl = `http://localhost:3000/card-b33-${randomUUID().slice(0, 8)}.json`;
    const locked = { ...getA2aConfig(), allowPrivateNetworkCards: false };
    expect(isAllowedAgentCardUrl(cardUrl, locked)).toBe(false);
    await expect(fetchA2aAgentCard(cardUrl, locked)).rejects.toThrow(A2aError);
  });
});
