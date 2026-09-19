import { Component, type ReactNode } from "react";
import { previewError } from "../lib/artifact-preview";

/** Parser and renderer failures must stay visible without taking down the chat. */
export class ArtifactReaderBoundary extends Component<{ readonly children: ReactNode }, { readonly error?: string }> {
  override state: { readonly error?: string } = {};
  static getDerivedStateFromError(cause: unknown) { return { error: previewError(cause) }; }
  override render() {
    return this.state.error ? <div className="file-preview__error" role="alert"><strong>阅读器无法显示此文件</strong><p>{this.state.error}</p><small>可通过上方刷新重新读取，或复制路径在本机检查原文件。</small></div> : this.props.children;
  }
}
