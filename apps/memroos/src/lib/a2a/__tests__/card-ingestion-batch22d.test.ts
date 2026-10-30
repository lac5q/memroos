// @vitest-environment node
import { describe, expect, it } from "vitest";

import { isAllowedAgentCardUrl } from "../card-ingestion";

describe("a2a card-ingestion batch22d — localhost and loopback hosts", () => {
  it("isAllowedAgentCardUrl rejects loopback and 127.0.0.0/8 when private cards are disallowed", () => {
    const strict = { allowPrivateNetworkCards: false, remoteCardTimeoutMs: 1000 } as const;
    expect(isAllowedAgentCardUrl("http://10.0.0.1/card.json", strict)).toBe(false);
    expect(isAllowedAgentCardUrl("http://localhost/card.json", strict)).toBe(false);
  });
});
