// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  isSha256Hash,
  normalizePackProvenance,
  PackContractError,
  scrubLegacyPackProvenance,
} from "../pack-contract";

describe("ontology pack-contract", () => {
  const valid = {
    sourceId: "src_pack_01",
    classification: "internal" as const,
    importedAt: "2026-01-15T12:00:00.000Z",
    references: ["ref_audit_01"],
  };

  it("normalizes valid provenance with sorted keys only", () => {
    expect(normalizePackProvenance(valid)).toEqual(valid);
  });

  it("rejects extra fields and invalid identifiers", () => {
    expect(() => normalizePackProvenance({ ...valid, extra: true })).toThrow(PackContractError);
    expect(() => normalizePackProvenance({ ...valid, sourceId: "../escape" })).toThrow(/sourceId/i);
    expect(() => normalizePackProvenance({ ...valid, classification: "secret" })).toThrow(/classification/i);
    expect(() => normalizePackProvenance({ ...valid, importedAt: "not-a-zulu-ts" })).toThrow(/importedAt/i);
    expect(() => normalizePackProvenance({ ...valid, references: ["bad ref"] })).toThrow(/references/i);
  });

  it("scrubs legacy provenance to empty object on failure", () => {
    expect(scrubLegacyPackProvenance(null)).toEqual({});
    expect(scrubLegacyPackProvenance({ garbage: true })).toEqual({});
    expect(scrubLegacyPackProvenance(valid)).toEqual(valid);
  });

  it("validates sha256 hash prefix", () => {
    expect(isSha256Hash(`sha256:${"a".repeat(64)}`)).toBe(true);
    expect(isSha256Hash("sha256:short")).toBe(false);
    expect(isSha256Hash(42)).toBe(false);
  });
});
