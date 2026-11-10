// @vitest-environment node
import { createHmac, randomUUID } from "node:crypto";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { normalizeRegistryEntry, parseSkillMd, verifySkillSignature } from "../registry";

const SIGNING_KEY_PATH = path.join(process.cwd(), "skill-signing-key.json");

afterEach(() => {
  if (fs.existsSync(SIGNING_KEY_PATH)) {
    fs.unlinkSync(SIGNING_KEY_PATH);
  }
});

describe("registry batch33b", () => {
  it("verifySkillSignature returns false for latin1-mangled signatures (338)", () => {
    const hash = "a".repeat(64);
    const signature = createHmac("sha256", "batch33b-key").update(hash, "utf8").digest("hex");
    const malformed = Buffer.from(signature, "hex").toString("latin1");
    expect(verifySkillSignature(hash, malformed, "batch33b-key")).toBe(false);
  });

  it("normalizeRegistryEntry maps enabled complete imports to quarantined (380)", () => {
    const name = `complete-b33b-${randomUUID().slice(0, 8)}`;
    const parsed = parseSkillMd(`---
name: ${name}
description: batch33b complete
owner: ops
source_harness: claude
risk_tier: low
dispatch_status: enabled
version: 1.0.0
---

## Preconditions
none

## Allowed Tools
read

## Verification Checks
json

## Rollback
revert

## Evidence Examples
one
`);
    const entry = normalizeRegistryEntry(parsed, "claude", "importer-b33b");
    expect(entry.dispatch_status).toBe("quarantined");
  });
});
