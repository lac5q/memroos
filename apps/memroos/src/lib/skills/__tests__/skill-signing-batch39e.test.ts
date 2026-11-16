// @vitest-environment node
import crypto from "crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const SIGNING_KEY = path.join(process.cwd(), "data", "skill-signing-key.json");

afterEach(() => {
  vi.doUnmock("crypto");
  vi.resetModules();
  vi.restoreAllMocks();
  if (fs.existsSync(SIGNING_KEY)) {
    fs.unlinkSync(SIGNING_KEY);
  }
});

describe("skill-signing batch39e — verify catch via crypto mock", () => {
  it("verifySkill returns false when crypto.verify throws (166)", async () => {
    // skill-signing imports from "crypto" (not "node:crypto"); mock must match.
    vi.doMock("crypto", async (importOriginal) => {
      const actual = await importOriginal<typeof import("crypto")>();
      return {
        ...actual,
        verify: vi.fn(() => {
          throw new Error(`verify boom batch39e-${randomUUID().slice(0, 6)}`);
        }),
      };
    });
    vi.resetModules();

    const signing = await import("@/lib/skills/skill-signing");
    const { publicKey, privateKey } = signing.generateKeyPair();
    const hash = crypto.createHash("sha256").update(`batch39e-${randomUUID()}`).digest("hex");
    // Use real sign from the unmocked crypto namespace for a well-formed signature buffer.
    const signature = crypto.sign(null, Buffer.from(hash, "utf8"), privateKey).toString("base64");
    expect(signing.verifySkill(publicKey, hash, signature)).toBe(false);
  });
});
