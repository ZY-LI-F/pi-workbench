import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname } from "node:path";

export interface JsonFileStorage {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

/** Flush the complete replacement before rename. A failed write never replaces the last committed file. */
export class AtomicJsonFile implements JsonFileStorage {
  constructor(readonly path: string) {}
  async read(): Promise<unknown | undefined> {
    try { return JSON.parse(await readFile(this.path, "utf8")) as unknown; }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw cause;
    }
  }
  async write(value: unknown): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
      await handle.sync();
    } finally { await handle.close(); }
    await rename(temporaryPath, this.path);
  }
}
