import { resolve } from "node:path";
import type { TestInfo } from "@playwright/test";

export function e2eScreenshotPath(testInfo: TestInfo, fileName: string): string {
  if (process.env.STELLA_UPDATE_DOCS_SCREENSHOTS === "1") {
    return resolve(process.cwd(), "docs", fileName);
  }
  return testInfo.outputPath(fileName);
}
