// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import Schema from "typebox/schema";

describe("coordinator-action Pi extension", () => {
  it("loads through Pi 0.83 and compiles its TypeBox 1.3 schema", async () => {
    const isolatedDirectory = await mkdtemp(join(tmpdir(), "stella-coordinator-extension-"));
    try {
      const extensionPath = resolve("resources/extensions/coordinator-action.ts");
      const loaded = await discoverAndLoadExtensions(
        [extensionPath],
        isolatedDirectory,
        isolatedDirectory,
      );

      expect(loaded.errors).toEqual([]);
      const extension = loaded.extensions.find((candidate) => candidate.resolvedPath === extensionPath);
      expect(extension).toBeDefined();
      const tool = extension?.tools.get("coordinator_action");
      expect(tool?.definition.name).toBe("coordinator_action");

      const validator = Schema.Compile(tool?.definition.parameters);
      expect(validator.Check({
        action: "delegate",
        summary: "拆分并分发靶点评估任务",
        delegations: [{
          agentId: "bio",
          objective: "评估靶点生物学证据",
          acceptanceCriteria: "给出可追溯证据与结论",
        }],
      })).toBe(true);
      expect(validator.Check({
        action: "delegate",
        delegations: [{ agentId: "bio", objective: "缺少验收标准" }],
      })).toBe(false);
      expect(validator.Check({
        action: "complete",
        summary: "完成",
        delegations: [],
        unexpected: true,
      })).toBe(false);
    } finally {
      await rm(isolatedDirectory, { recursive: true, force: true });
    }
  });
});
