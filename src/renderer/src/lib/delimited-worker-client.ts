import type { DelimitedData } from "./delimited-data";

export function readDelimitedData(bytes: Uint8Array, delimiter: "," | "\t", encoding: string, signal: AbortSignal): Promise<DelimitedData> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/delimited.worker.ts", import.meta.url), { type: "module" });
    const dispose = () => { worker.terminate(); signal.removeEventListener("abort", abort); };
    const abort = () => { dispose(); reject(new DOMException("文件读取已取消", "AbortError")); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ data?: DelimitedData; error?: string }>) => {
      dispose();
      if (event.data.data) resolve(event.data.data);
      else reject(new Error(event.data.error ?? "表格解析器没有返回数据"));
    };
    worker.onerror = (event) => { dispose(); reject(new Error(`表格解析器失败：${event.message}`)); };
    try { worker.postMessage({ bytes, delimiter, encoding }); }
    catch (cause) { dispose(); reject(cause); }
  });
}
