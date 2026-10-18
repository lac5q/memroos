// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildMemroosAgentCard } from "../agent-card";
import {
  A2A_CONTRACT_HEADER,
  A2A_CONTRACT_ID,
  a2aAgentCardSchema,
  a2aContractHeaders,
  a2aTaskEventSchema,
  a2aTaskSchema,
  buildA2aOpenApiDocument,
  parseA2aAgentCard,
  parseA2aTask,
  parseA2aTaskEvent,
} from "../contract";
import {
  A2A_CANONICAL_AGENT_CARD_PATH,
  A2A_COMPAT_AGENT_CARD_PATH,
  A2A_TASK_STATES,
} from "../types";

describe("A2A contract", () => {
  it("parses the generated MemRoOS agent card", () => {
    const card = buildMemroosAgentCard();

    expect(a2aAgentCardSchema.parse(card)).toEqual(card);
    expect(parseA2aAgentCard(card)).toEqual(card);
  });

  it("rejects invalid task state values", () => {
    expect(() =>
      a2aTaskSchema.parse({
        id: "task-1",
        status: { state: "done" },
      })
    ).toThrow();
  });

  it("parses task events against the shared task state list", () => {
    const event = {
      taskId: "task-1",
      kind: "status-update",
      sequence: 2,
      final: false,
      task: {
        id: "task-1",
        status: { state: A2A_TASK_STATES[1] },
        history: [
          {
            messageId: "msg-1",
            role: "user",
            parts: [{ kind: "text", text: "ping" }],
          },
        ],
      },
    };

    expect(a2aTaskEventSchema.parse(event)).toEqual(event);
    expect(parseA2aTaskEvent(event)).toEqual(event);
    expect(parseA2aTask(event.task)).toEqual(event.task);
  });

  it("builds an OpenAPI contract from the shared route constants", () => {
    const doc = buildA2aOpenApiDocument("https://memroos.example/");

    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.version).toBe(A2A_CONTRACT_ID);
    expect(doc["x-memroos-contract"]).toBe(A2A_CONTRACT_ID);
    expect(doc.servers).toEqual([{ url: "https://memroos.example" }]);
    expect(doc.paths[A2A_CANONICAL_AGENT_CARD_PATH].get.responses["200"].headers).toHaveProperty(
      A2A_CONTRACT_HEADER
    );
    expect(doc.paths[A2A_COMPAT_AGENT_CARD_PATH].get.responses["200"].headers).toHaveProperty(
      A2A_CONTRACT_HEADER
    );
    expect(doc.paths["/api/a2a"].post.requestBody.content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/JsonRpcRequest",
    });
    expect(doc.components.schemas.A2aTask.properties.status.properties.state.enum).toEqual(
      A2A_TASK_STATES
    );
  });

  it("emits the stable A2A contract header", () => {
    expect(a2aContractHeaders({ "Cache-Control": "no-store" })).toEqual({
      "Cache-Control": "no-store",
      [A2A_CONTRACT_HEADER]: A2A_CONTRACT_ID,
    });
  });
});
