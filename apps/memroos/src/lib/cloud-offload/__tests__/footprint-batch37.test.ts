// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { collectLocalFootprintInventory, defaultLocalStoreProfiles } from "../footprint";

const SANDBOX = path.join(os.tmpdir(), `footprint-b37-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

describe("cloud-offload footprint batch37", () => {
  it("homePath resolves ~/github/knowledge via slice(2) join (43-44)", () => {
    const repo = path.join(SANDBOX, "repo-b37");
    fs.mkdirSync(repo, { recursive: true });
    const profile = defaultLocalStoreProfiles(repo).find((p) => p.id === "knowledge-repo");
    expect(profile?.path).toBe(path.join(os.homedir(), "github", "knowledge"));
  });

  it.skip("homePath passthrough for absolute paths (44 return input) — no public caller supplies non-tilde paths", () => {});
});