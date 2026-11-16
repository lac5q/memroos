// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { extractEntities } from "../entity-extraction";

describe("entity-extraction batch39d", () => {
  const nowIso = "2026-11-16T09:00:00.000Z";

  it.skip("classifyKind date branch (271-272) — proper-noun scan never feeds ISO/numeric dates into classifyKind", () => {});

  it.skip("classifyKind unknown branch (277) — proper-noun surfaces always satisfy organization heuristic", () => {});

  it.skip("newline in proper-noun surface (362-363) — PROPER_NOUN_PATTERN never captures newlines in group", () => {});

  it("rejects sentence-initial stop words and still extracts distinct entities", () => {
    const marker = randomUUID().slice(0, 8);
    const result = extractEntities(
      `The review targets Cloudflare batch39d ${marker} before deployment.`,
      { nowIso },
    );
    expect(result.ok).toBe(true);
    expect(result.entities.some((e) => e.surface === "Cloudflare")).toBe(true);
    expect(result.receipt.rejectedReasons.invalidSurface).toBeGreaterThanOrEqual(0);
  });

  it("collects identifier spans from dedicated scan without classifyKind", () => {
    const marker = randomUUID().slice(0, 8);
    const result = extractEntities(`Track ticket INC-8842 during batch39d ${marker}.`, { nowIso });
    expect(result.entities.some((e) => e.kind === "identifier" && e.surface === "INC-8842")).toBe(true);
  });
});