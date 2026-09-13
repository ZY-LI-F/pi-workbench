import { useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import type { StellaDesktopApi } from "@shared/contracts";
import type { NativeSubmissionReceipt, NativeSubmissionStatus } from "@shared/native-submission";

const LABELS: Record<NativeSubmissionStatus, string> = {
  pending: "正在提交", accepted: "Pi 已接收", rejected: "Pi 已拒绝", unknown: "发送结果未知",
};

export function NativeSubmissionPanel({ api, receipts, error, onRefresh }: {
  readonly api: StellaDesktopApi;
  readonly receipts: readonly NativeSubmissionReceipt[];
  readonly error?: string;
  readonly onRefresh: () => void;
}) {
  const [feedback, setFeedback] = useState<string>();
  return <section className="native-submissions" aria-label="原生提交回执">
    <header><strong>提交回执</strong><button type="button" className="icon-button" aria-label="刷新提交回执" onClick={onRefresh}><RefreshCw size={14} /></button></header>
    <p>接收状态不等于任务完成。中断后不会自动重发。</p>
    {error && <p role="alert">{error}</p>}
    {feedback && <p role="status">{feedback}</p>}
    {receipts.length === 0 && !error && <p>本会话还没有 GUI 提交回执。</p>}
    {receipts.map((receipt) => <details key={receipt.id} className={`native-receipt native-receipt--${receipt.status}`}>
      <summary><span>{LABELS[receipt.status]}</span><time dateTime={receipt.createdAt}>{new Date(receipt.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></summary>
      <dl><dt>提交 ID</dt><dd>{receipt.id}</dd><dt>会话 ID</dt><dd>{receipt.sessionId}</dd><dt>运行代际</dt><dd>{receipt.generation}</dd></dl>
      {receipt.error && <p>{receipt.error}</p>}
      <button type="button" className="button-secondary" onClick={() => {
        void api.copyText(JSON.stringify(receipt, null, 2)).then(() => setFeedback("已复制提交追踪信息"), (cause: unknown) => setFeedback(`复制失败：${String(cause)}`));
      }}><Copy size={13} />复制追踪信息</button>
    </details>)}
  </section>;
}
