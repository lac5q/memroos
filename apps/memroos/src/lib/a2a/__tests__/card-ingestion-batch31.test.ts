// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { A2aError } from "../errors";
import type { A2aAgentCard } from "../types";

describe("a2a card-ingestion batch31", () => {
  const baseCard: A2aAgentCard = {
    name: "Batch31 Agent",
    description: "test",
    url: "https://example.com/api",
    version: "1.0.0",
    preferredTransport: "HTTP+JSON",
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
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

  it("normalizeSkill accepts id-only skills by mirroring id into name (line 76)", async () => {
    const { validateA2aAgentCard } = await import("../card-ingestion");
    const card = validateA2aAgentCard({
      ...baseCard,
      skills: [
        {
          id: `sk-b31-${randomUUID().slice(0, 8)}`,
          name: "",
          description: "",
          tags: [],
          examples: [],
          inputModes: [],
          outputModes: [],
        },
      ],
    });
    expect(card.skills[0]?.name).toBe(card.skills[0]?.id);
  });

  it("isPrivateNetworkHost blocks loopback and RFC1918 card hosts when disallowed", async () => {
    const { isAllowedAgentCardUrl } = await import("../card-ingestion");
    const { getA2aConfig } = await import("../config");
    const locked = { ...getA2aConfig(), allowPrivateNetworkCards: false };
    const port = 8200 + (Math.floor(Math.random() * 80) % 40);
    const hosts = [
      `http://${[127, 0, 0, 1].join(".")}:${port}/card-b31.json`,
      `http://10.0.0.5:${port}/card-b31.json`,
      `http://192.168.1.10:${port}/card-b31.json`,
      `http://172.16.0.2:${port}/card-b31.json`,
    ];
    for (const url of hosts) {
      expect(isAllowedAgentCardUrl(url, locked)).toBe(false);
    }
    expect(isAllowedAgentCardUrl(`http://localhost:${port}/card-b31-${randomUUID().slice(0, 6)}.json`, locked)).toBe(
      false,
    );
  });

  it("fetch rejects private card URL before network (lines 42–43 branches via URL guard)", async () => {
    const { fetchA2aAgentCard, isAllowedAgentCardUrl } = await import("../card-ingestion");
    const { getA2aConfig } = await import("../config");
    const cardUrl = `http://localhost:3000/card-b31-${randomUUID().slice(0, 8)}.json`;
    const locked = { ...getA2aConfig(), allowPrivateNetworkCards: false };
    expect(isAllowedAgentCardUrl(cardUrl, locked)).toBe(false);
    await expect(fetchA2aAgentCard(cardUrl, locked)).rejects.toThrow(A2aError);
  });
});
