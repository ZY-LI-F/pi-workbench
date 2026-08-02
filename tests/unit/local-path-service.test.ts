// @vitest-environment node
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LocalPathService, type LocalPathServiceDependencies } from "../../src/main/local-path-service";

function serviceFixture(
  kind: "file" | "directory" | "other",
  overrides: Partial<LocalPathServiceDependencies> = {},
) {
  const openWithSystem = vi.fn(async () => "");
  const revealWithSystem = vi.fn();
  const dependencies: LocalPathServiceDependencies = {
    allowedRoots: () => [resolve("workspace")],
    canonicalizeWithinRoots: vi.fn(async (candidatePath) => candidatePath),
    inspectPath: vi.fn(async () => ({
      isFile: () => kind === "file",
      isDirectory: () => kind === "directory",
    })),
    openWithSystem,
    revealWithSystem,
    ...overrides,
  };
  return Object.freeze({ service: new LocalPathService(dependencies), openWithSystem, revealWithSystem, dependencies });
}

describe("LocalPathService", () => {
  it("inspects and directly opens a generated presentation", async () => {
    const fixture = serviceFixture("file");
    const path = resolve("workspace", "PI-GUI_产品能力与交互说明.pptx");

    await expect(fixture.service.inspect(path)).resolves.toMatchObject({
      canonicalPath: path,
      name: "PI-GUI_产品能力与交互说明.pptx",
      kind: "file",
      directOpenAllowed: true,
    });
    await fixture.service.open(path);
    expect(fixture.openWithSystem).toHaveBeenCalledWith(path);
  });

  it("opens a directory and reveals an ordinary file with the system file manager", async () => {
    const directory = serviceFixture("directory");
    const directoryPath = resolve("workspace", "test-results", "pi-gui-pptx");
    await directory.service.reveal(directoryPath);
    expect(directory.openWithSystem).toHaveBeenCalledWith(directoryPath);
    expect(directory.revealWithSystem).not.toHaveBeenCalled();

    const file = serviceFixture("file");
    const filePath = resolve(directoryPath, "report.pdf");
    await file.service.reveal(filePath);
    expect(file.revealWithSystem).toHaveBeenCalledWith(filePath);
    expect(file.openWithSystem).not.toHaveBeenCalled();
  });

  it("directly opens only allowlisted document/media types and still permits revealing other files", async () => {
    const fixture = serviceFixture("file");
    const scriptPath = resolve("workspace", "run-analysis.ps1");

    await expect(fixture.service.inspect(scriptPath)).resolves.toMatchObject({
      directOpenAllowed: false,
      directOpenBlockedReason: expect.stringContaining("安全清单"),
    });
    await expect(fixture.service.open(scriptPath)).rejects.toThrow("请先打开所在位置");
    expect(fixture.openWithSystem).not.toHaveBeenCalled();

    await fixture.service.reveal(scriptPath);
    expect(fixture.revealWithSystem).toHaveBeenCalledWith(scriptPath);

    await expect(fixture.service.inspect(resolve("workspace", "design.py"))).resolves.toMatchObject({
      directOpenAllowed: false,
    });
    await expect(fixture.service.inspect(resolve("workspace", "unknown.bin"))).resolves.toMatchObject({
      directOpenAllowed: false,
    });
  });

  it("exposes invalid, network and out-of-scope paths as explicit failures", async () => {
    const outside = serviceFixture("file", { canonicalizeWithinRoots: vi.fn(async () => null) });
    await expect(outside.service.inspect(resolve("outside", "report.pptx"))).rejects.toThrow("只允许访问当前项目");
    await expect(outside.service.inspect("reports/report.pptx")).rejects.toThrow("只允许打开绝对本地路径");
    await expect(outside.service.inspect("\\\\server\\share\\report.pptx")).rejects.toThrow("UNC");
  });

  it("surfaces the operating-system open error", async () => {
    const fixture = serviceFixture("file", { openWithSystem: vi.fn(async () => "没有关联的应用") });
    await expect(fixture.service.open(resolve("workspace", "report.pptx"))).rejects.toThrow("没有关联的应用");
  });
});
