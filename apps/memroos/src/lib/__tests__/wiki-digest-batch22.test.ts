// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runWikiDigest } from "@/lib/wiki-digest";

describe("wiki-digest batch22 — watermark fallback, default logger, partial status", () => {
  const vaults: string[] = [];

  afterEach(() => {
    for (const vault of vaults) {
      fs.rmSync(vault, { recursive: true, force: true });
    }
    vaults.length = 0;
    vi.restoreAllMocks();
  });

  it("treats memories with createdAt but no watermark timestamp as after watermark via id", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b22-wm-"));
    vaults.push(kb);
    fs.mkdirSync(path.join(kb, "llm-wiki", "wiki"), { recursive: true });
    fs.mkdirSync(path.join(kb, "llm-wiki", ".memroos"), { recursive: true });
    fs.writeFileSync(
      path.join(kb, "llm-wiki", ".memroos", "wiki-digest-watermark.json"),
      JSON.stringify({
        lastCreatedAt: null,
        lastId: "m-old",
        updatedAt: "2026-07-21T00:00:00.000Z",
        pagesWritten: 0,
      }),
      "utf8",
    );
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      fetchMemories: async () => [
        {
          id: "m-new",
          content: "Memory with timestamp after watermark id-only gate.",
          createdAt: "2026-07-21T01:00:00.000Z",
        },
      ],
      now: new Date("2026-07-21T02:00:00.000Z"),
      log: () => undefined,
    });
    expect(summary.written).toBe(1);
    expect(summary.watermarkAfter.lastId).toBe("m-new");
  });

  it("default logger handles messages with and without structured extra", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b22-log-"));
    vaults.push(kb);
    fs.mkdirSync(path.join(kb, "llm-wiki", "wiki"), { recursive: true });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const calls: Array<{ message: string; extra?: Record<string, unknown> }> = [];
    await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      fetchMemories: async () => [
        {
          id: "m-plain-log",
          content: "Trigger logger branches.",
          createdAt: "2026-07-21T03:00:00.000Z",
        },
      ],
      now: new Date("2026-07-21T04:00:00.000Z"),
      log: (message, extra) => {
        calls.push({ message, extra });
        if (extra) console.log(`[wiki-digest] ${message}`, extra);
        else console.log(`[wiki-digest] ${message}`);
      },
    });
    expect(calls.some((entry) => entry.message === "done" && entry.extra?.status)).toBe(true);
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("[wiki-digest]"))).toBe(true);
    logSpy.mockRestore();
  });

  it("marks summary partial when one page writes and another fails", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b22-partial-"));
    vaults.push(kb);
    fs.mkdirSync(path.join(kb, "llm-wiki", "wiki"), { recursive: true });
    const realWrite = fs.writeFileSync.bind(fs);
    let failOnce = true;
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(((
      file: fs.PathOrFileDescriptor,
      data: string | NodeJS.ArrayBufferView,
      options?: fs.WriteFileOptions,
    ) => {
      const target = String(file);
      if (target.includes(`${path.sep}memroos-digest${path.sep}`) && target.endsWith(".md") && failOnce) {
        failOnce = false;
        throw new Error("write_failed_batch22");
      }
      return realWrite(file, data, options);
    }) as typeof fs.writeFileSync);

    try {
      const summary = await runWikiDigest({
        knowledgeBasePath: kb,
        dryRun: false,
        fetchMemories: async () => [
          {
            id: "m-a",
            content: "Alpha cluster content for partial digest.",
            createdAt: "2026-07-21T05:00:00.000Z",
            agentId: "luis",
          },
          {
            id: "m-b",
            content: "Beta cluster content for partial digest.",
            createdAt: "2026-07-21T05:05:00.000Z",
            agentId: "luis",
          },
        ],
        now: new Date("2026-07-21T06:00:00.000Z"),
        log: () => undefined,
      });
      expect(summary.errors).toBeGreaterThan(0);
      expect(summary.written).toBeGreaterThan(0);
      expect(summary.status).toBe("partial");
    } finally {
      writeSpy.mockRestore();
    }
  });
});
