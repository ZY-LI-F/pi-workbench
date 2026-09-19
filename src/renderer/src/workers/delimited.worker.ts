import { parseDelimited } from "../lib/delimited-data";
import { previewError } from "../lib/artifact-preview";

self.onmessage = (event: MessageEvent<{ bytes: Uint8Array; delimiter: "," | "\t"; encoding: string }>) => {
  try { self.postMessage({ data: parseDelimited(event.data.bytes, event.data.delimiter, event.data.encoding) }); }
  catch (cause) { self.postMessage({ error: previewError(cause) }); }
};
