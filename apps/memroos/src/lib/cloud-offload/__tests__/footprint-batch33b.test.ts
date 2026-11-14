// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { collectLocalFootprintInventory, defaultLocalStoreProfiles } from "../footprint";

const SANDBOX = path.join(os.tmpdir(), `footprint-b33b-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

describe("cloud-offload footprint batch33b", () => {
  it("homePath expands bare tilde profiles (42)", () => {
    const repo = path.join(SANDBOX, "repo-b33b");
    fs.mkdirSync(repo, { recursive: true });
    const runtimeEnv = defaultLocalStoreProfiles(repo).find((p) => p.id === "runtime-env");
    expect(runtimeEnv?.path).toBe(path.join(os.homedir(), ".memroos"));
  });

  // Line 146 (`!current` stack guard) is not reachable without mutating internal stacks.
});
