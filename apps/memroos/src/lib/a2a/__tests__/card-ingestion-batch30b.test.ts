// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { A2aError } from "../errors";
import type { A2aAgentCard } from "../types";

describe("a2a card-ingestion batch30b", () => {
  const baseCard: A2aAgentCard = {
    name: "Batch30b Agent",
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
    skills: [
      {
        id: "sk1",
        name: "Skill",
        description: "",
        tags: [],
        examples: [],
        inputModes: [],
        outputModes: [],
      },
    ],
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

  it("normalizeSkill rejects skills missing id and name (lines 42–43)", async () => {
    const { validateA2aAgentCard } = await import("../card-ingestion");
    expect(() =>
      validateA2aAgentCard({
        ...baseCard,
        skills: [{ id: "", name: "", description: "", tags: [], examples: [], inputModes: [], outputModes: [] }],
      }),
    ).toThrow(A2aError);
  });

  it("isPrivateNetworkHost blocks loopback card URLs when private cards disallowed (lines 42–76)", async () => {
    const { isAllowedAgentCardUrl, fetchA2aAgentCard } = await import("../card-ingestion");
    const { getA2aConfig } = await import("../config");
    const port = 8100 + (Math.floor(Math.random() * 100) % 40);
    const cardUrl = `http://localhost:${port}/card-b30b-${randomUUID().slice(0, 8)}.json`;
    const locked = { ...getA2aConfig(), allowPrivateNetworkCards: false };
    expect(isAllowedAgentCardUrl(cardUrl, locked)).toBe(false);

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      headers: new Headers(),
      text: async () => JSON.stringify(baseCard),
    } as Response);

    await expect(fetchA2aAgentCard(cardUrl, locked)).rejects.toThrow(A2aError);
  });
});
