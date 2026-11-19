import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { LogViewer } from "../log-viewer";

describe("LogViewer", () => {
  it("shows empty state when no lines", () => {
    render(<LogViewer lines={[]} />);
    expect(screen.getByText(/No log data available/i)).toBeInTheDocument();
  });

  it("renders log lines with classification colors", () => {
    render(
      <LogViewer
        lines={[
          "INFO starting cycle",
          "ERROR failed to parse proposal",
          "SUCCESS DONE",
          "New PROPOSAL queued",
        ]}
      />
    );
    expect(screen.getByText(/starting cycle/i)).toBeInTheDocument();
    expect(screen.getByText(/failed to parse proposal/i)).toBeInTheDocument();
    expect(screen.getByText(/SUCCESS DONE/i)).toBeInTheDocument();
    expect(screen.getByText(/New PROPOSAL queued/i)).toBeInTheDocument();
  });
});
