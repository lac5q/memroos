// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { A2aError } from "../errors";
import type { A2aAgentCard } from "../types";

describe("a2a card-ingestion batch29e", () => {
  const baseCard: A2aAgentCard = {
    name: "Batch29e Agent",
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

  it("normalizeSkill drops records without id or name (lines 42–43 via validate)", async () => {
    const { validateA2aAgentCard } = await import("../card-ingestion");
    expect(() =>
      validateA2aAgentCard({
        ...baseCard,
        skills: [{ id: "", name: "x", description: "", tags: [], examples: [], inputModes: [], outputModes: [] }],
      }),
    ).toThrow(A2aError);
  });

  it("isPrivateNetworkHost blocks disallowed card URLs (lines 76–198)", async () => {
    const { isAllowedAgentCardUrl, fetchA2aAgentCard } = await import("../card-ingestion");
    const { getA2aConfig } = await import("../config");
    const cardUrl = `http://localhost:${8000 + (Math.floor(Math.random() * 100) % 50)}/card-b29e.json`;
    expect(isAllowedAgentCardUrl(cardUrl, { ...getA2aConfig(), allowPrivateNetworkCards: false })).toBe(
      false,
    );

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      headers: new Headers(),
      text: async () => JSON.stringify(baseCard),
    } as Response);

    const locked = { ...getA2aConfig(), allowPrivateNetworkCards: false };
    expect(isAllowedAgentCardUrl(cardUrl, locked)).toBe(false);
    await expect(fetchA2aAgentCard(cardUrl, locked)).rejects.toThrow(A2aError);
  });

  it("fetch rejects oversize body beyond MAX_AGENT_CARD_BYTES (line 198)", async () => {
    const { isAllowedAgentCardUrl, fetchA2aAgentCard } = await import("../card-ingestion");
    const { getA2aConfig } = await import("../config");
    const cardUrl = "https://public-batch29e.example.com/card.json";
    expect(isAllowedAgentCardUrl(cardUrl, getA2aConfig())).toBe(true);

    const huge = "x".repeat(262_144 + 2);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      headers: new Headers(),
      text: async () => huge,
    } as Response);

    await expect(fetchA2aAgentCard(cardUrl)).rejects.toThrow(A2aError);
  });
});
