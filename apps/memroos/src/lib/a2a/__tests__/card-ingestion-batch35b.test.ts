// @vitest-environment node
import { describe, expect, it } from "vitest";

describe("a2a card-ingestion batch35b", () => {
  it("isPrivateNetworkHost treats localhost as private when private cards disabled (42)", async () => {
    const { isAllowedAgentCardUrl } = await import("../card-ingestion");
    const { getA2aConfig } = await import("../config");
    const locked = { ...getA2aConfig(), allowPrivateNetworkCards: false };
    expect(isAllowedAgentCardUrl("http://localhost:9220/card-b35b.json", locked)).toBe(false);
  });
});
