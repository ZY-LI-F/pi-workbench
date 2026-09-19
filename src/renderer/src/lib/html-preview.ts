const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "img-src data: blob:",
  "style-src 'unsafe-inline'",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/** Shared with HTML and PPTX previews; callers must also use an empty iframe sandbox. */
export function secureHtmlDocument(source: string, extraStyle = ""): string {
  const document = new DOMParser().parseFromString(source, "text/html");
  document.querySelectorAll('meta[http-equiv="Content-Security-Policy"], base').forEach((node) => node.remove());
  const policy = document.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = HTML_PREVIEW_CSP;
  document.head.prepend(policy);
  const charset = document.createElement("meta");
  charset.setAttribute("charset", "UTF-8");
  document.head.prepend(charset);
  if (extraStyle) {
    const style = document.createElement("style");
    style.textContent = extraStyle;
    document.head.append(style);
  }
  return `<!doctype html>${document.documentElement.outerHTML}`;
}
