// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    stat: async (target: Parameters<typeof actual.stat>[0], opts?: Parameters<typeof actual.stat>[1]) => {
      if (String(target).includes("ghost-b33b.jsonl")) {
        return Promise.reject(new Error("ENOENT batch33b"));
      }
      return actual.stat(target, opts);
    },
  };
});

import { parseModelUsage } from "../parsers";

const TMP = path.join(os.tmpdir(), `parsers-b33b-${randomUUID()}`);

afterEach(() => {
  delete process.env.HOME;
  vi.clearAllMocks();
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("parsers batch33b", () => {
  it("parseModelUsage skips jsonl when stat fails (426)", async () => {
    const home = path.join(TMP, "home-b33b");
    const project = path.join(home, ".claude", "projects", `proj-b33b-${randomUUID().slice(0, 8)}`);
    fs.mkdirSync(project, { recursive: true });
    const ghost = path.join(project, "ghost-b33b.jsonl");
    fs.writeFileSync(ghost, '{"type":"assistant","timestamp":"2026-11-10T00:00:00.000Z"}\n', "utf8");
    process.env.HOME = home;

    const usage = await parseModelUsage(new Date("2026-01-01T00:00:00.000Z"));
    expect(usage.models).toEqual([]);
  });
});
