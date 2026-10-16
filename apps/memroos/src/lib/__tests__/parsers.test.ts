// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from "child_process";
import {
  parseAgents,
  parseClaudeMemory,
  parseModelUsage,
  parseTokenStats,
} from "../parsers";

describe("parsers", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "parsers-"));
    vi.mocked(execFileSync).mockReset();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("parseAgents", () => {
    it("returns empty array when configs path is missing", async () => {
      await expect(parseAgents(path.join(root, "missing"))).resolves.toEqual([]);
    });

    it("skips non-directories and parses agent metadata", async () => {
      await writeFile(path.join(root, "README.md"), "skip me");
      const agentDir = path.join(root, "hermes-ceo");
      await mkdir(agentDir);
      await writeFile(
        path.join(agentDir, "HEARTBEAT.md"),
        "# heartbeat\nSTATUS: ok\nPopSmiths ops\n"
      );
      await writeFile(
        path.join(agentDir, "HEARTBEAT_STATE.md"),
        "# Current task\nShip coverage\n"
      );
      await writeFile(
        path.join(agentDir, "AGENTS.md"),
        "Reports to hermes as master coordinator.\n"
      );
      await writeFile(
        path.join(agentDir, "LESSONS.md"),
        "- lesson one\n- lesson two\n"
      );
      await mkdir(path.join(agentDir, "memory"));
      const today = new Date().toISOString().slice(0, 10);
      await writeFile(path.join(agentDir, "memory", `${today}-note.md`), "note");

      const agents = await parseAgents(root);
      expect(agents).toHaveLength(1);
      expect(agents[0]).toMatchObject({
        id: "hermes-ceo",
        platform: "hermes",
        company: "PopSmiths",
        masterId: "hermes",
        lessonsCount: 2,
        todayMemoryCount: 1,
        currentTask: "Current task",
      });
      expect(agents[0].status).toBe("active");
    });

    it("detects error status and openclaw master, and sorts by status", async () => {
      const errorDir = path.join(root, "qwen-engineer");
      await mkdir(errorDir);
      await writeFile(
        path.join(errorDir, "HEARTBEAT.md"),
        "[ERROR] pipeline failed\nOpenClaw notes\n"
      );
      await writeFile(
        path.join(errorDir, "SOUL.md"),
        "This agent reports to openclaw.\n"
      );

      const idleDir = path.join(root, "codex-helper");
      await mkdir(idleDir);
      const old = new Date(Date.now() - 60 * 60 * 1000);
      const { utimes } = await import("fs/promises");
      await writeFile(path.join(idleDir, "HEARTBEAT.md"), "all good");
      await utimes(path.join(idleDir, "HEARTBEAT.md"), old, old);

      const dormantDir = path.join(root, "pi-bot");
      await mkdir(dormantDir);

      const agents = await parseAgents(root);
      expect(agents.map((a) => a.id)).toEqual([
        "qwen-engineer",
        "codex-helper",
        "pi-bot",
      ]);
      expect(agents[0].status).toBe("error");
      expect(agents[0].masterId).toBe("openclaw");
      expect(agents[0].company).toBe("OpenClaw");
      expect(agents[1].status).toBe("idle");
      expect(agents[1].platform).toBe("codex");
      expect(agents[2].status).toBe("dormant");
      expect(agents[2].platform).toBe("pi");
    });

    it("prefers business company names over OpenClaw platform mentions", async () => {
      const agentDir = path.join(root, "growth-strategist");
      await mkdir(agentDir);
      await writeFile(
        path.join(agentDir, "USER.md"),
        "GrowthAlchemy and OpenClaw together\nHandDrawn brand kit\n"
      );
      const agents = await parseAgents(root);
      expect(agents[0].company).toBe("HandDrawn");
      expect(agents[0].role).toBe("Reservations");
    });

    it("detects Epilogue Capital and recent active heartbeats", async () => {
      const agentDir = path.join(root, "epilogue-analyst");
      await mkdir(agentDir);
      await writeFile(path.join(agentDir, "HEARTBEAT.md"), "Epilogue Capital weekly review\n");
      await writeFile(path.join(agentDir, "AGENTS.md"), "Reports to hermes for coordination.\n");
      const agents = await parseAgents(root);
      expect(agents[0].company).toBe("Epilogue Capital");
      expect(agents[0].masterId).toBe("hermes");
      expect(agents[0].status).toBe("active");
    });

    it("flags STATUS: blocked markers as error state", async () => {
      const agentDir = path.join(root, "blocked-agent");
      await mkdir(agentDir);
      await writeFile(path.join(agentDir, "HEARTBEAT.md"), "STATUS: blocked on dependency\n");
      const agents = await parseAgents(root);
      expect(agents[0].status).toBe("error");
    });

    it("skips projects whose memory directory cannot be read", async () => {
      const projectDir = path.join(root, "proj-no-memory");
      await mkdir(projectDir);
      await writeFile(path.join(projectDir, "README.md"), "no memory dir here");
      await expect(parseClaudeMemory(root)).resolves.toEqual([]);
    });

    it("maps known directory names to restaurant-themed roles", async () => {
      const agentDir = path.join(root, "founding-engineer");
      await mkdir(agentDir);
      await writeFile(path.join(agentDir, "HEARTBEAT.md"), "all good\n");
      const agents = await parseAgents(root);
      expect(agents[0].role).toBe("Line Cook");
    });

    it("marks agents without heartbeat files as dormant", async () => {
      await mkdir(path.join(root, "silent-agent"));
      const agents = await parseAgents(root);
      expect(agents[0]).toMatchObject({ id: "silent-agent", status: "dormant" });
    });

    it("detects gemini/opencode/zcode/openclaw platforms", async () => {
      for (const id of ["gemini-bot", "opencode-bot", "zcode-bot", "openclaw-bot"]) {
        await mkdir(path.join(root, id));
        await writeFile(path.join(root, id, "HEARTBEAT.md"), "ok\n");
      }
      const agents = await parseAgents(root);
      const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
      expect(byId["gemini-bot"].platform).toBe("gemini");
      expect(byId["opencode-bot"].platform).toBe("opencode");
      expect(byId["zcode-bot"].platform).toBe("zcode");
      expect(byId["openclaw-bot"].platform).toBe("openclaw");
    });
  });

  describe("parseTokenStats", () => {
    it("returns null when rtk fails", () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error("missing rtk");
      });
      expect(parseTokenStats()).toBeNull();
    });

    it("parses byte-scale token counts in rtk output", () => {
      const output = "Input tokens: 2.5B\nOutput tokens: 900\n";
      vi.mocked(execFileSync).mockReturnValue(output);
      const stats = parseTokenStats();
      expect(stats?.totalInput).toBe(2_500_000_000);
      expect(stats?.totalOutput).toBe(900);
    });

    it("honors RTK_STATS_TIMEOUT_MS when invoking rtk gain", () => {
      process.env.RTK_STATS_TIMEOUT_MS = "2500";
      vi.mocked(execFileSync).mockReturnValue("Input tokens: 1K\n");
      parseTokenStats();
      expect(execFileSync).toHaveBeenCalledWith("rtk", ["gain"], {
        encoding: "utf-8",
        timeout: 2500,
      });
      delete process.env.RTK_STATS_TIMEOUT_MS;
    });

    it("parses rtk gain summary and command breakdown", () => {
      const output = [
        "Total commands: 1,234",
        "Input tokens: 12.5M",
        "Output tokens: 800K",
        "Tokens saved: 45.4M (68.0%)",
        "Total exec time: 1053m34s (avg 4.8s)",
        "By Command",
        " 1.  rtk find                    411   45.4M   68.0%    4.2s  ██████████",
        " 2.  rtk grep                    12   1.2K   10.0%    1.0s",
      ].join("\n");
      vi.mocked(execFileSync).mockReturnValue(output);

      const stats = parseTokenStats();
      expect(stats).toMatchObject({
        totalCommands: 1234,
        totalInput: 12_500_000,
        totalOutput: 800_000,
        tokensSaved: 45_400_000,
        savingsPercent: 68,
        avgExecutionTime: 4.8,
      });
      expect(stats?.commandBreakdown).toEqual([
        {
          command: "rtk find",
          count: 411,
          tokensSaved: 45_400_000,
          savingsPercent: 68,
        },
        {
          command: "rtk grep",
          count: 12,
          tokensSaved: 1200,
          savingsPercent: 10,
        },
      ]);
    });
  });

  describe("parseClaudeMemory", () => {
    it("returns empty when projects root missing", async () => {
      await expect(parseClaudeMemory(path.join(root, "nope"))).resolves.toEqual(
        []
      );
    });

    it("parses markdown memory entries and skips MEMORY.md", async () => {
      const memDir = path.join(root, "proj-a", "memory");
      await mkdir(memDir, { recursive: true });
      await writeFile(path.join(memDir, "MEMORY.md"), "skip");
      await writeFile(
        path.join(memDir, "note.md"),
        "---\ntype: feedback\n---\nUseful note\n"
      );
      await writeFile(path.join(memDir, "other.md"), "plain content");

      const entries = await parseClaudeMemory(root);
      expect(entries).toHaveLength(2);
      expect(entries.find((e) => e.id.endsWith("note.md"))).toMatchObject({
        type: "feedback",
        content: "Useful note",
        agent: "claude",
      });
      expect(entries.find((e) => e.id.endsWith("other.md"))?.type).toBe(
        "project"
      );
    });
  });

  describe("parseModelUsage", () => {
    it("returns empty totals when claude projects dir is missing", async () => {
      const prev = process.env.HOME;
      process.env.HOME = path.join(root, "no-home");
      try {
        await expect(parseModelUsage()).resolves.toEqual({
          models: [],
          total: {
            inputTokens: 0,
            outputTokens: 0,
            cacheRead: 0,
            cacheCreation: 0,
            requests: 0,
          },
        });
      } finally {
        process.env.HOME = prev;
      }
    });

    it("aggregates assistant usage from jsonl and subagent files", async () => {
      const prev = process.env.HOME;
      process.env.HOME = root;
      const projectDir = path.join(root, ".claude", "projects", "demo");
      await mkdir(projectDir, { recursive: true });
      await writeFile(path.join(projectDir, "not-a-dir.txt"), "x");

      const jsonl = [
        JSON.stringify({
          type: "assistant",
          requestId: "r1",
          timestamp: new Date().toISOString(),
          message: {
            model: "claude-opus-4-6",
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              cache_read_input_tokens: 2,
              cache_creation_input_tokens: 1,
            },
          },
        }),
        JSON.stringify({
          type: "assistant",
          requestId: "r1",
          message: {
            model: "claude-opus-4-6",
            usage: { input_tokens: 99, output_tokens: 99 },
          },
        }),
        JSON.stringify({ type: "user", message: {} }),
        "{not-json",
        JSON.stringify({
          type: "assistant",
          requestId: "r2",
          timestamp: "2000-01-01T00:00:00.000Z",
          message: {
            model: "claude-sonnet-4-5",
            usage: { input_tokens: 3, output_tokens: 1 },
          },
        }),
      ].join("\n");
      await writeFile(path.join(projectDir, "session.jsonl"), jsonl);

      const subDir = path.join(projectDir, "sess-1", "subagents");
      await mkdir(subDir, { recursive: true });
      await writeFile(
        path.join(subDir, "sa.jsonl"),
        JSON.stringify({
          type: "assistant",
          requestId: "r3",
          timestamp: new Date().toISOString(),
          message: {
            model: "claude-haiku-4-5",
            usage: { input_tokens: 7, output_tokens: 2 },
          },
        }) + "\n"
      );

      try {
        const since = new Date(Date.now() - 60_000);
        const usage = await parseModelUsage(since);
        expect(usage.models.map((m) => m.name).sort()).toEqual([
          "Haiku 4.5",
          "Opus 4.6",
        ]);
        expect(usage.total.requests).toBe(2);
        expect(usage.total.inputTokens).toBeGreaterThan(0);
      } finally {
        process.env.HOME = prev;
      }
    });

    it("aggregates multiple assistant lines into one model stat and normalizes opus/sonnet names", async () => {
      const prev = process.env.HOME;
      process.env.HOME = root;
      const projectDir = path.join(root, ".claude", "projects", "models");
      await mkdir(projectDir, { recursive: true });
      const jsonl = [
        JSON.stringify({
          type: "assistant",
          requestId: "dup-req",
          timestamp: new Date().toISOString(),
          message: {
            model: "claude-opus-4-6",
            usage: { input_tokens: 4, output_tokens: 2, cache_read_input_tokens: 1 },
          },
        }),
        JSON.stringify({
          type: "assistant",
          requestId: "dup-req",
          timestamp: new Date().toISOString(),
          message: {
            model: "claude-opus-4-6",
            usage: { input_tokens: 99, output_tokens: 99 },
          },
        }),
        JSON.stringify({
          type: "assistant",
          requestId: "sonnet-req",
          timestamp: new Date().toISOString(),
          message: {
            model: "claude-sonnet-4-5",
            usage: { input_tokens: 3, output_tokens: 1, cache_creation_input_tokens: 2 },
          },
        }),
      ].join("\n");
      await writeFile(path.join(projectDir, "session.jsonl"), jsonl);
      try {
        const usage = await parseModelUsage();
        const opus = usage.models.find((m) => m.name === "Opus 4.6");
        const sonnet = usage.models.find((m) => m.name === "Sonnet 4.5");
        expect(opus?.requests).toBe(1);
        expect(opus?.inputTokens).toBe(4);
        expect(opus?.cacheRead).toBe(1);
        expect(sonnet?.requests).toBe(1);
        expect(sonnet?.cacheCreation).toBe(2);
      } finally {
        process.env.HOME = prev;
      }
    });

    it("skips jsonl files older than the since filter", async () => {
      const prev = process.env.HOME;
      process.env.HOME = root;
      const projectDir = path.join(root, ".claude", "projects", "stale");
      await mkdir(projectDir, { recursive: true });
      const stalePath = path.join(projectDir, "old.jsonl");
      await writeFile(
        stalePath,
        JSON.stringify({
          type: "assistant",
          requestId: "old",
          timestamp: "1999-01-01T00:00:00.000Z",
          message: { model: "claude-haiku-4-5", usage: { input_tokens: 1, output_tokens: 1 } },
        })
      );
      const { utimes } = await import("fs/promises");
      const old = new Date("1999-01-01T00:00:00.000Z");
      await utimes(stalePath, old, old);
      try {
        const usage = await parseModelUsage(new Date("2026-01-01T00:00:00.000Z"));
        expect(usage.total.requests).toBe(0);
      } finally {
        process.env.HOME = prev;
      }
    });
  });
});
