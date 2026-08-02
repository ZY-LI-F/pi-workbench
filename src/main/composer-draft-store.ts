import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, resolve, sep } from "node:path";
import type {
  ComposerDraftImage,
  ComposerDraftSnapshot,
  SaveComposerDraftInput,
} from "../shared/composer-draft";

const STORE_VERSION = 1;
const METADATA_FILE = "draft.json";
const DRAFT_DIRECTORY_PATTERN = /^[a-f0-9]{64}$/u;
const IMAGE_FILE_PATTERN = /^image-[a-f0-9]{64}\.bin$/u;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

interface StoredImage {
  readonly file: string;
  readonly mimeType: string;
  readonly name: string;
}

interface StoredDraft {
  readonly version: 1;
  readonly key: string;
  readonly text: string;
  readonly images: readonly StoredImage[];
  readonly updatedAt: number;
}

interface StoredDraftLocation {
  readonly directory: string;
  readonly draft: StoredDraft;
}

interface DraftKeyParts {
  readonly project: string;
  readonly sessionIdentity: string;
}

function requiredString(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string") throw new Error(`${label} 必须是字符串`);
  if (!allowEmpty && value.trim().length === 0) throw new Error(`${label} 不能为空`);
  return value;
}

function validImage(value: unknown, index: number): ComposerDraftImage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`草稿附件 ${index + 1} 必须是对象`);
  }
  const image = value as Readonly<Record<string, unknown>>;
  if (image.type !== "image") throw new Error(`草稿附件 ${index + 1} 类型必须是 image`);
  const data = requiredString(image.data, `草稿附件 ${index + 1} data`);
  if (!BASE64_PATTERN.test(data)) throw new Error(`草稿附件 ${index + 1} 不是有效 Base64`);
  const mimeType = requiredString(image.mimeType, `草稿附件 ${index + 1} MIME`);
  if (!mimeType.toLocaleLowerCase("en-US").startsWith("image/")) {
    throw new Error(`草稿附件 ${index + 1} MIME 必须是图片类型`);
  }
  return Object.freeze({
    type: "image",
    data,
    mimeType,
    name: requiredString(image.name, `草稿附件 ${index + 1} 名称`),
  });
}

function validSaveInput(value: unknown): SaveComposerDraftInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("会话草稿必须是对象");
  }
  const draft = value as Readonly<Record<string, unknown>>;
  if (!Array.isArray(draft.images)) throw new Error("会话草稿 images 必须是数组");
  return Object.freeze({
    key: requiredString(draft.key, "会话草稿 key"),
    text: requiredString(draft.text, "会话草稿 text", true),
    images: Object.freeze(draft.images.map(validImage)),
  });
}

function parseStoredDraft(contents: string, path: string, expectedKey?: string): StoredDraft {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch (cause) {
    throw new Error(`无法解析会话草稿 ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`会话草稿 ${path} 必须是对象`);
  }
  const draft = value as Readonly<Record<string, unknown>>;
  if (draft.version !== STORE_VERSION) throw new Error(`会话草稿 ${path} 版本无效`);
  const key = requiredString(draft.key, `会话草稿 ${path} key`);
  if (expectedKey !== undefined && key !== expectedKey) throw new Error(`会话草稿 ${path} identity 不匹配`);
  if (!Array.isArray(draft.images)) throw new Error(`会话草稿 ${path} images 无效`);
  const images = draft.images.map((candidate, index): StoredImage => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new Error(`会话草稿 ${path} 附件 ${index + 1} 无效`);
    }
    const image = candidate as Readonly<Record<string, unknown>>;
    const file = requiredString(image.file, `会话草稿附件 ${index + 1} file`);
    if (!IMAGE_FILE_PATTERN.test(file)) throw new Error(`会话草稿附件 ${index + 1} file 无效`);
    const mimeType = requiredString(image.mimeType, `会话草稿附件 ${index + 1} MIME`);
    if (!mimeType.toLocaleLowerCase("en-US").startsWith("image/")) {
      throw new Error(`会话草稿附件 ${index + 1} MIME 必须是图片类型`);
    }
    return Object.freeze({ file, mimeType, name: requiredString(image.name, `会话草稿附件 ${index + 1} 名称`) });
  });
  if (typeof draft.updatedAt !== "number" || !Number.isFinite(draft.updatedAt)) {
    throw new Error(`会话草稿 ${path} updatedAt 无效`);
  }
  return Object.freeze({
    version: STORE_VERSION,
    key,
    text: requiredString(draft.text, `会话草稿 ${path} text`, true),
    images: Object.freeze(images),
    updatedAt: draft.updatedAt,
  });
}

function splitDraftKey(key: string): DraftKeyParts | undefined {
  const separator = key.indexOf("\0");
  if (separator <= 0 || separator === key.length - 1 || key.indexOf("\0", separator + 1) >= 0) return undefined;
  return Object.freeze({ project: key.slice(0, separator), sessionIdentity: key.slice(separator + 1) });
}

function isSessionFileIdentity(identity: string): boolean {
  return isAbsolute(identity) && extname(identity).toLocaleLowerCase("en-US") === ".jsonl";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw cause;
  }
}

export class ComposerDraftStore {
  readonly #root: string;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(root: string) {
    this.#root = resolve(root);
  }

  async load(keyValue: unknown): Promise<ComposerDraftSnapshot | undefined> {
    const key = requiredString(keyValue, "会话草稿 key");
    const operation = this.#writeQueue.then(() => this.#load(key));
    this.#writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async #load(key: string): Promise<ComposerDraftSnapshot | undefined> {
    const exact = await this.#readStoredDraft(key);
    if (exact) return this.#snapshot(exact);

    const recovery = await this.#findOrphanedSessionDraft(key);
    if (!recovery) return undefined;
    const recovered = await this.#snapshot(recovery);
    await this.#save(Object.freeze({ key, text: recovered.text, images: recovered.images }));
    await rm(recovery.directory, { recursive: true, force: true });
    return Object.freeze({
      ...recovered,
      key,
      recoveredFromPreviousSession: true,
    });
  }

  async #readStoredDraft(key: string): Promise<StoredDraftLocation | undefined> {
    const directory = this.#directory(key);
    const metadataPath = join(directory, METADATA_FILE);
    let contents: string;
    try {
      contents = await readFile(metadataPath, "utf8");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw cause;
    }
    return Object.freeze({ directory, draft: parseStoredDraft(contents, metadataPath, key) });
  }

  async #snapshot(location: StoredDraftLocation): Promise<ComposerDraftSnapshot> {
    const images = await Promise.all(location.draft.images.map(async (image): Promise<ComposerDraftImage> => Object.freeze({
      type: "image",
      data: (await readFile(join(location.directory, image.file))).toString("base64"),
      mimeType: image.mimeType,
      name: image.name,
    })));
    return Object.freeze({
      key: location.draft.key,
      text: location.draft.text,
      images: Object.freeze(images),
      updatedAt: location.draft.updatedAt,
    });
  }

  async #findOrphanedSessionDraft(targetKey: string): Promise<StoredDraftLocation | undefined> {
    const target = splitDraftKey(targetKey);
    if (!target || !isSessionFileIdentity(target.sessionIdentity) || await pathExists(target.sessionIdentity)) return undefined;

    let entries: Dirent[];
    try {
      entries = await readdir(this.#root, { withFileTypes: true });
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw cause;
    }

    let newest: StoredDraftLocation | undefined;
    for (const entry of entries) {
      if (!entry.isDirectory() || !DRAFT_DIRECTORY_PATTERN.test(entry.name)) continue;
      const directory = join(this.#root, entry.name);
      const metadataPath = join(directory, METADATA_FILE);
      let contents: string;
      try {
        contents = await readFile(metadataPath, "utf8");
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw cause;
      }
      const draft = parseStoredDraft(contents, metadataPath);
      if (draft.key === targetKey) continue;
      const candidate = splitDraftKey(draft.key);
      if (!candidate || candidate.project !== target.project || !isSessionFileIdentity(candidate.sessionIdentity)) continue;
      if (await pathExists(candidate.sessionIdentity)) continue;
      if (!newest || draft.updatedAt > newest.draft.updatedAt) newest = Object.freeze({ directory, draft });
    }
    return newest;
  }

  async save(value: unknown): Promise<void> {
    const input = validSaveInput(value);
    const operation = this.#writeQueue.then(() => this.#save(input));
    this.#writeQueue = operation.catch(() => undefined);
    await operation;
  }

  async drain(): Promise<void> {
    await this.#writeQueue;
  }

  #directory(key: string): string {
    const hash = createHash("sha256").update(key).digest("hex");
    const directory = resolve(this.#root, hash);
    if (!directory.startsWith(`${this.#root}${sep}`)) throw new Error("会话草稿目录越界");
    return directory;
  }

  async #save(input: SaveComposerDraftInput): Promise<void> {
    const directory = this.#directory(input.key);
    if (input.text.length === 0 && input.images.length === 0) {
      await rm(directory, { recursive: true, force: true });
      return;
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });

    const storedImages: StoredImage[] = [];
    for (const image of input.images) {
      const bytes = Buffer.from(image.data, "base64");
      const digest = createHash("sha256").update(image.mimeType).update("\0").update(bytes).digest("hex");
      const file = `image-${digest}.bin`;
      try {
        await writeFile(join(directory, file), bytes, { flag: "wx", mode: 0o600 });
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
      }
      storedImages.push(Object.freeze({ file, mimeType: image.mimeType, name: image.name }));
    }

    const metadata: StoredDraft = Object.freeze({
      version: STORE_VERSION,
      key: input.key,
      text: input.text,
      images: Object.freeze(storedImages),
      updatedAt: Date.now(),
    });
    const temporaryPath = join(directory, `${METADATA_FILE}.${randomUUID()}.tmp`);
    await writeFile(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, join(directory, METADATA_FILE));

    const referenced = new Set(storedImages.map((image) => image.file));
    for (const name of await readdir(directory)) {
      if ((IMAGE_FILE_PATTERN.test(name) && !referenced.has(name)) || name.endsWith(".tmp")) {
        await rm(join(directory, name), { force: true });
      }
    }
  }
}
