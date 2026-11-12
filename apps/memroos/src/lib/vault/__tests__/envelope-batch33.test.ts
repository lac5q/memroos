// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { LocalFileKeyProvider } from "../envelope";

describe("vault envelope batch33 — missing key paths (42, 49)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `vault-env-b33-${randomUUID()}-`));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("current() throws when currentKeyId is missing from key file (42)", () => {
    const keyPath = path.join(tmpDir, "vault.key");
    fs.writeFileSync(
      keyPath,
      JSON.stringify({
        currentKeyId: "missing-id",
        keys: [{ id: "local-v1", key: Buffer.from("k").toString("base64"), status: "active" }],
      }),
      "utf8",
    );
    const provider = new LocalFileKeyProvider(keyPath);
    expect(() => provider.current()).toThrow(/Vault key not found: missing-id/);
  });

  it("get() throws for unknown key id (49)", () => {
    const keyPath = path.join(tmpDir, "vault.key");
    const provider = new LocalFileKeyProvider(keyPath);
    provider.rotate(`local-b33-${randomUUID().slice(0, 6)}`);
    expect(() => provider.get("unknown-key-b33")).toThrow(/Vault key not found: unknown-key-b33/);
  });
});
