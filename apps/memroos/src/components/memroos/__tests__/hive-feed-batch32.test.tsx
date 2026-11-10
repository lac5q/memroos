/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/api-client", () => ({
  useHiveFeed: vi.fn(),
}));

import { useHiveFeed } from "@/lib/api-client";
import { HiveFeed } from "../hive-feed";

const mockUseHiveFeed = useHiveFeed as ReturnType<typeof vi.fn>;

describe("HiveFeed batch32", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back when Date parsing throws (lines 63-64)", () => {
    const RealDate = global.Date;
    const marker = "BATCH32_CATCH";
    class MockDate extends RealDate {
      constructor(...args: ConstructorParameters<typeof RealDate>) {
        if (args[0] === marker) {
          throw new Error("forced batch32");
        }
        super(...args);
      }
    }
    Object.assign(MockDate, RealDate);
    vi.spyOn(global, "Date").mockImplementation(MockDate as unknown as typeof Date);

    mockUseHiveFeed.mockReturnValue({
      data: {
        actions: [
          {
            id: 99,
            agent_id: "hive-b32",
            action_type: "continue",
            summary: "Catch path",
            artifacts: null,
            timestamp: marker,
          },
        ],
        timestamp: new RealDate().toISOString(),
      },
      isLoading: false,
    });

    render(<HiveFeed limit={5} />);
    expect(screen.getByText(marker.slice(0, 16))).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
