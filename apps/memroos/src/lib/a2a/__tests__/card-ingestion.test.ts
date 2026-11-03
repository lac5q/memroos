// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_DB_DIR = path.join(os.tmpdir(), `a2a-card-ingestion-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "ingestion.db");
const CARD_URL = "http://localhost:8001/a2a/check_prime_agent/.well-known/agent-card.json";

const ADK_CARD = {
  name: "ADK Check Prime Agent",
  description: "Checks whether numbers are prime",
  url: "http://localhost:8001/a2a/check_prime_agent",
  version: "1.0",
  capabilities: {
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
  defaultInputModes: ["text/plain", "application/json"],
  defaultOutputModes: ["text/plain", "application/json"],
  securitySchemes: {
    bearerAuth: { type: "http", scheme: "bearer" },
  },
  security: [{ bearerAuth: [] }],
  skills: [
    {
      id: "check_prime",
      name: "Check Prime",
      description: "Determine whether a supplied integer is prime.",
      tags: ["math", "adk"],
    },
  ],
  extensions: {
    adk: { agent: "check_prime_agent" },
  },
};

async function loadIngestion() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const ingestion = await import("../card-ingestion");
  const registry = await import("@/lib/agent-registry");
  const dbModule = await import("@/lib/db");
  return { ...ingestion, ...registry, closeDb: dbModule.closeDb };
}

function mockFetchCard(card = ADK_CARD) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(card), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    )
  );
}

describe("A2A card ingestion", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(async () => {
    const { closeDb } = await loadIngestion();
    closeDb();
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
    vi.unstubAllGlobals();
  });

  it("validates an ADK-shaped bearer-secured A2A card", async () => {
    const { validateA2aAgentCard } = await loadIngestion();

    expect(validateA2aAgentCard(ADK_CARD)).toMatchObject({
      name: "ADK Check Prime Agent",
      url: "http://localhost:8001/a2a/check_prime_agent",
      version: "1.0",
      capabilities: { streaming: true },
      defaultInputModes: ["text/plain", "application/json"],
      defaultOutputModes: ["text/plain", "application/json"],
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    });
  });

  it("rejects cards missing name, url, or skills", async () => {
    const { validateA2aAgentCard } = await loadIngestion();

    expect(() => validateA2aAgentCard({ ...ADK_CARD, name: undefined })).toThrow(/name/i);
    expect(() => validateA2aAgentCard({ ...ADK_CARD, url: undefined })).toThrow(/url/i);
    expect(() => validateA2aAgentCard({ ...ADK_CARD, skills: [] })).toThrow(/skill/i);
  });

  it("rejects unsafe agent-card URLs", async () => {
    const { isAllowedAgentCardUrl } = await loadIngestion();

    expect(isAllowedAgentCardUrl("file:///tmp/agent-card.json")).toBe(false);
    expect(isAllowedAgentCardUrl("ftp://example.test/agent-card.json")).toBe(false);
    expect(isAllowedAgentCardUrl("https://user:pass@example.test/agent-card.json")).toBe(false);
    expect(isAllowedAgentCardUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isAllowedAgentCardUrl("http://metadata.google.internal/computeMetadata/v1")).toBe(false);
  });

  it("ingests through the canonical registry with ADK metadata and capabilities", async () => {
    mockFetchCard();
    const { ingestA2aAgentCard } = await loadIngestion();

    const result = await ingestA2aAgentCard({ cardUrl: CARD_URL, source: "adk" });

    expect(result.agent).toMatchObject({
      protocol: "a2a",
      platform: "gemini",
      name: "ADK Check Prime Agent",
    });
    expect(result.agent.capabilities).toEqual([
      expect.objectContaining({ id: "check_prime", tags: expect.arrayContaining(["a2a", "adk"]) }),
    ]);
  });

  it("stores allowlisted A2A metadata on the canonical registry record", async () => {
    mockFetchCard();
    const { ingestA2aAgentCard } = await loadIngestion();

    const { agent } = await ingestA2aAgentCard({ cardUrl: CARD_URL, source: "adk" });
    const metadata = agent.metadata.a2a as Record<string, unknown>;

    expect(Object.keys(metadata).sort()).toEqual([
      "cardHash",
      "cardUrl",
      "endpointUrl",
      "inputModes",
      "lastFetchedAt",
      "outputModes",
      "securitySchemes",
      "source",
      "validationStatus",
      "version",
    ]);
    expect(metadata).toMatchObject({
      cardUrl: CARD_URL,
      endpointUrl: ADK_CARD.url,
      version: "1.0",
      validationStatus: "validated",
      source: "adk",
    });
  });

  it("uses deterministic default id a2a_${sha256(cardUrl).slice(0, 12)}", async () => {
    mockFetchCard();
    const { ingestA2aAgentCard } = await loadIngestion();

    const { agent } = await ingestA2aAgentCard({ cardUrl: CARD_URL, source: "adk" });
    const expected = `a2a_${crypto.createHash("sha256").update(CARD_URL).digest("hex").slice(0, 12)}`;

    expect(agent.id).toBe(expected);
  });

  it("rejects oversized, invalid, and non-ok fetch responses", async () => {
    const { fetchA2aAgentCard, isAllowedAgentCardUrl } = await loadIngestion();
    const publicCardUrl = "https://agent.example.test/.well-known/agent-card.json";
    expect(isAllowedAgentCardUrl(publicCardUrl)).toBe(true);

    if (!("timeout" in AbortSignal)) {
      Object.defineProperty(AbortSignal, "timeout", {
        value: (ms: number) => {
          const controller = new AbortController();
          setTimeout(() => controller.abort(), ms);
          return controller.signal;
        },
      });
    }

    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    await expect(fetchA2aAgentCard(publicCardUrl)).rejects.toMatchObject({
      message: "A2A agent card could not be fetched",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(ADK_CARD), {
          status: 200,
          headers: { "content-length": String(300_000) },
        })
      )
    );
    await expect(fetchA2aAgentCard(publicCardUrl)).rejects.toMatchObject({
      message: "A2A agent card response is too large",
    });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{not-json", { status: 200 })));
    await expect(fetchA2aAgentCard(publicCardUrl)).rejects.toMatchObject({
      message: "A2A agent card response is not valid JSON",
    });
  });

  it("ingests non-ADK cards as openclaw agents with stable memroos ids", async () => {
    const card = {
      ...ADK_CARD,
      name: "OpenClaw Agent",
      url: "https://agent.example.test/v1",
      extensions: { memroos: { id: "memroos-remote-1", profile: "custom", cardPaths: { canonical: "", compatibility: "" } } },
      skills: [{ id: "search", name: "Search", description: "Search the web", tags: ["web"] }],
    };
    mockFetchCard(card);
    const { ingestA2aAgentCard } = await loadIngestion();

    const { agent } = await ingestA2aAgentCard({
      cardUrl: "https://agent.example.test/.well-known/agent-card.json",
      source: "a2a",
    });

    expect(agent.platform).toBe("openclaw");
    expect(agent.id).toBe("memroos-remote-1");
    expect(agent.location).toBe("cloudflare");
    expect(agent.capabilities[0]?.tags).toEqual(expect.arrayContaining(["a2a"]));
  });

  it("rejects invalid card payloads during validation", async () => {
    const { validateA2aAgentCard } = await loadIngestion();

    expect(() => validateA2aAgentCard(null)).toThrow(/must be an object/);
    expect(() => validateA2aAgentCard({ ...ADK_CARD, url: "not-a-url" })).toThrow(/valid URL/);
    expect(() => validateA2aAgentCard({ ...ADK_CARD, version: "" })).toThrow(/version/i);
  });

  it("preserves JSON-RPC preferredTransport when supplied", async () => {
    const { validateA2aAgentCard } = await loadIngestion();
    const card = validateA2aAgentCard({
      ...ADK_CARD,
      preferredTransport: "JSON-RPC",
    });
    expect(card.preferredTransport).toBe("JSON-RPC");
  });

  it("fetchA2aAgentCard rejects disallowed card URLs before networking", async () => {
    const { fetchA2aAgentCard } = await loadIngestion();
    await expect(fetchA2aAgentCard("http://169.254.169.254/card.json")).rejects.toMatchObject({
      message: "A2A agent card URL is not allowed",
    });
  });

  it("allows localhost cards when private network cards are explicitly enabled", async () => {
    const { isAllowedAgentCardUrl } = await loadIngestion();
    expect(
      isAllowedAgentCardUrl("http://localhost:8001/.well-known/agent-card.json", {
        allowPrivateNetworkCards: true,
        remoteCardTimeoutMs: 5000,
      })
    ).toBe(true);
  });
});
