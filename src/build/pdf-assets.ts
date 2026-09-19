import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/** Keep PDF fonts/CMaps/decoders local in both Vite development and packaged builds. */
export function pdfAssets(): Plugin {
  const root = join(dirname(fileURLToPath(import.meta.resolve("pdfjs-dist"))), "..");
  const directories = ["cmaps", "standard_fonts", "wasm", "iccs"];
  const files = async () => (await Promise.all(directories.map(async (directory) =>
    (await readdir(join(root, directory), { withFileTypes: true })).filter((entry) => entry.isFile())
      .map((entry) => `${directory}/${entry.name}`)))).flat();
  return {
    name: "stella-local-pdf-assets",
    async generateBundle() {
      for (const file of await files()) this.emitFile({ type: "asset", fileName: `pdf-assets/${file}`, source: await readFile(join(root, file)) });
      this.emitFile({ type: "asset", fileName: "pdf-assets/LICENSE", source: await readFile(join(root, "LICENSE")) });
    },
    async configureServer(server) {
      const allowed = new Set(await files());
      server.middlewares.use("/pdf-assets", (request, response, next) => {
        const file = request.url?.slice(1).split("?")[0] ?? "";
        if (!allowed.has(file)) { next(); return; }
        void readFile(join(root, file)).then((bytes) => {
          response.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : file.endsWith(".js") ? "text/javascript" : "application/octet-stream");
          response.end(bytes);
        }, next);
      });
    },
  };
}
