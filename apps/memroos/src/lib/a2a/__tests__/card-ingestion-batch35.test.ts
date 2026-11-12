// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { A2aError } from "../errors";
import type { A2aAgentCard } from "../types";

describe("a2a card-ingestion batch35", () => {
  const baseCard: A2aAgentCard = {
    name: "Batch35 Agent",
    description: "test",
    url: "https://example.com/api",
    version: "1.0.0",
    preferredTransport: "HTTP+JSON",
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: [],
    defaultOutputModes: [],
    securitySchemes: {},
    security: [],
    skills: [
      {
        id: "sk-b35",
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

  it("isPrivateNetworkHost treats 127.0.0.0/8 as private (42)", async () => {
    const { isAllowedAgentCardUrl } = await import("../card-ingestion");
    const { getA2aConfig } = await import("../config");
    const locked = { ...getA2aConfig(), allowPrivateNetworkCards: false };
    expect(isAllowedAgentCardUrl("http://localhost:8443/card-b35.json", locked)).toBe(false);
  });

  it("normalizeSkill drops non-record skill entries (76)", async () => {
    const { validateA2aAgentCard } = await import("../card-ingestion");
    expect(() =>
      validateA2aAgentCard({
        ...baseCard,
        skills: [null, "not-a-skill"],
      }),
    ).toThrow(A2aError);
    const card = validateA2aAgentCard({
      ...baseCard,
      skills: [
        null,
        { id: `sk-b35-${randomUUID().slice(0, 8)}`, name: "Agent skill" },
      ],
    });
    expect(card.skills).toHaveLength(1);
  });
});
