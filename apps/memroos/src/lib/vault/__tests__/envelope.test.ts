// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LocalFileKeyProvider,
  decryptVaultBody,
  encryptVaultBody,
  rewrapVaultEnvelope,
  shouldEncryptVaultLabel,
} from "../envelope";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "memroos-vault-envelope-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("vault envelope encryption", () => {
  it("encrypts and decrypts with a local file-backed key", () => {
    const provider = new LocalFileKeyProvider(path.join(tmpDir, "vault.key"));
    const plaintext = Buffer.from("sensitive artifact body", "utf8");

    const envelope = encryptVaultBody(plaintext, provider);
    const decrypted = decryptVaultBody(envelope, provider);

    expect(envelope.keyId).toBe("local-v1");
    expect(envelope.ciphertext).not.toContain("sensitive artifact body");
    expect(decrypted.toString("utf8")).toBe("sensitive artifact body");
  });

  it("requires encryption for sensitive vault labels", () => {
    expect(
      shouldEncryptVaultLabel({
        visibility: "internal",
        policy: "default",
        sensitivity: "pii",
      })
    ).toBe(true);
    expect(
      shouldEncryptVaultLabel({ visibility: "private", policy: "default" })
    ).toBe(true);
  });

  it("rejects unsupported vault envelope versions", () => {
    const provider = new LocalFileKeyProvider(path.join(tmpDir, "vault.key"));
    const envelope = encryptVaultBody(Buffer.from("x", "utf8"), provider);
    expect(() =>
      decryptVaultBody({ ...envelope, version: 2 as 1 }, provider)
    ).toThrow(/Unsupported vault encryption envelope/);
  });

  it("rewraps a data key after rotating the key-encryption key", () => {
    const provider = new LocalFileKeyProvider(path.join(tmpDir, "vault.key"));
    const plaintext = Buffer.from("rotation survives replay", "utf8");
    const envelope = encryptVaultBody(plaintext, provider);

    provider.rotate("local-v2");
    const rewrapped = rewrapVaultEnvelope(envelope, provider, provider);

    expect(rewrapped.keyId).toBe("local-v2");
    expect(decryptVaultBody(rewrapped, provider).toString("utf8")).toBe("rotation survives replay");
  });
});
