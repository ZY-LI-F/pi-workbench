// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactDetails } from "../../src/renderer/src/features/kanban/ArtifactDetails";

afterEach(() => cleanup());

describe("ArtifactDetails runtime metrics", () => {
  it("shows AgentTask tokens in M and exposes elapsed runtime", () => {
    render(
      <ArtifactDetails
        artifact={Object.freeze({
          title: "Agent 最终产物与运行指标",
          content: "报告内容",
          inputTokens: 1_250_000,
          outputTokens: 250_000,
          startedAt: "2026-07-18T00:00:00.000Z",
          completedAt: "2026-07-18T00:01:30.000Z",
        })}
        onRevealPath={() => undefined}
      />,
    );

    expect(screen.getByText(/1\.25M 输入/)).toBeTruthy();
    expect(screen.getByText(/0\.250M 输出/)).toBeTruthy();
    expect(screen.getByText(/运行 1m 30s/)).toBeTruthy();
  });
});
