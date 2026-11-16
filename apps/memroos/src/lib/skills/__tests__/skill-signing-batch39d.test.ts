// @vitest-environment node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const SIGNING_KEY = path.join(process.cwd(), "data", "skill-signing-key.json");

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("node:crypto");
  vi.resetModules();
  if (fs.existsSync(SIGNING_KEY)) {
    fs.unlinkSync(SIGNING_KEY);
  }
});

describe("skill-signing batch39d", () => {
  it("verifySkill returns false when crypto.verify throws (line 166)", async () => {
    vi.doMock("node:crypto", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:crypto")>();
      return {
        ...actual,
        verify: vi.fn(() => {
          throw new Error("verify failed batch39d");
        }),
      };
    });
    vi.resetModules();
    const signing = await import("@/lib/skills/skill-signing");
    const { publicKey, privateKey } = signing.generateKeyPair();
    const hash = crypto.createHash("sha256").update(`batch39d-${randomUUID()}`).digest("hex");
    const signature = crypto.sign(null, Buffer.from(hash, "utf8"), privateKey).toString("base64");
    expect(signing.verifySkill(publicKey, hash, signature)).toBe(false);
  });
});