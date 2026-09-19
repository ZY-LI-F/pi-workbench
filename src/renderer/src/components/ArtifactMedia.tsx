import { useEffect, useState } from "react";
import { previewError, previewText } from "../lib/artifact-preview";
import { secureHtmlDocument } from "../lib/html-preview";

function externalCss(source: string): boolean {
  // Preserve ordinary scientific-figure styles and local gradients. Reject
  // imports/escapes and every resource URL other than an in-document reference.
  if (/\\|@import|@font-face/i.test(source)) return true;
  return [...source.matchAll(/url\s*\(([^)]*)\)/gi)].some((match) => !/^["']?#[\w.-]+["']?$/.test(match[1]!.trim()));
}
export function sanitizedSvg(source: string): string {
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (document.querySelector("parsererror") || document.documentElement.localName !== "svg") throw new Error("SVG 文件不是有效的 SVG XML");
  document.querySelectorAll("script, foreignObject, iframe, object, embed, audio, video").forEach((node) => node.remove());
  document.querySelectorAll("style").forEach((node) => { if (externalCss(node.textContent ?? "")) node.remove(); });
  document.querySelectorAll("*").forEach((node) => {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      const localImage = /^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,/i.test(value);
      if (name.startsWith("on") || (/(?:^|:)href$/.test(name) && !value.startsWith("#") && !localImage)
        || externalCss(value)) node.removeAttribute(attribute.name);
    }
  });
  return new XMLSerializer().serializeToString(document.documentElement);
}

export function ArtifactImage({ bytes, mimeType, name }: { readonly bytes: Uint8Array; readonly mimeType: string; readonly name: string }) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let next: string | undefined;
    setUrl(undefined); setError(undefined);
    try {
      const content = mimeType === "image/svg+xml" ? sanitizedSvg(previewText(bytes)) : new Uint8Array(bytes).buffer;
      next = URL.createObjectURL(new Blob([content], { type: mimeType }));
      setUrl(next);
    } catch (cause) { setError(previewError(cause)); }
    return () => { if (next) URL.revokeObjectURL(next); };
  }, [bytes, mimeType]);
  if (error) return <span className="artifact-error" role="alert">图片 {name} 无法显示：{error}</span>;
  return url ? <img src={url} alt={name} onError={() => setError("图像解码失败，文件可能损坏或格式不受支持")} /> : <span role="status">正在载入图片…</span>;
}

export function StaticArtifactHtml({ source, title }: { readonly source: string; readonly title: string }) {
  return <iframe className="artifact-static-html" title={title} sandbox="" srcDoc={secureHtmlDocument(source)} />;
}

export function embeddedImage(source: string): { bytes: Uint8Array; mimeType: string } {
  const match = /^data:(image\/(?:png|jpeg|gif|webp|svg\+xml));(base64),([\s\S]*)$/i.exec(source);
  if (!match) throw new Error("仅支持内嵌 PNG、JPEG、GIF、WebP 或 SVG 的 base64 图片");
  const raw = atob(match[3]!.replace(/\s/g, ""));
  return { bytes: Uint8Array.from(raw, (character) => character.charCodeAt(0)), mimeType: match[1]!.toLowerCase() };
}
