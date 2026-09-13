import { memo, useState } from "react";
import {
  BookOpenCheck,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  FileText,
  GitFork,
  LoaderCircle,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  SerializableContentBlock,
  SerializableMessage,
  StellaDesktopApi,
} from "@shared/contracts";
import type { LocalPathInspection } from "@shared/local-path";
import type { ToolExecutionState } from "../lib/runtime-state";
import {
  parseExpandedSkillInvocation,
  skillInvocationCommand,
  type ExpandedSkillInvocation,
} from "../lib/skill-invocation";
import { LocalPathArtifacts } from "./LocalPathArtifacts";
import { useCopyFeedback } from "../hooks/use-copy-feedback";
import { formatTokenMillions } from "../lib/token-format";

interface MessageCardProps {
  readonly api: StellaDesktopApi;
  readonly message: SerializableMessage;
  readonly toolExecutions: Readonly<Record<string, ToolExecutionState>>;
  readonly entryId?: string;
  readonly onFork: (entryId: string) => void;
  readonly onPreviewFile: (inspection: LocalPathInspection) => void;
}

function formatTime(timestamp: number | undefined): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function textContent(blocks: readonly SerializableContentBlock[]): string {
  return blocks
    .flatMap((block) => {
      if (block.type === "text") return [block.text];
      if (block.type === "thinking") return [block.thinking];
      return [];
    })
    .join("\n");
}

function displayValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function toolHeadline(name: string, args: Readonly<Record<string, unknown>>): string {
  if (name === "bash" && typeof args.command === "string") return args.command;
  const path = args.path ?? args.file_path ?? args.filePath;
  if (typeof path === "string") return path;
  return Object.keys(args).length > 0 ? displayValue(args) : "无参数";
}

function ToolCallCard({
  block,
  execution,
}: {
  readonly block: Extract<SerializableContentBlock, { type: "toolCall" }>;
  readonly execution?: ToolExecutionState;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = execution?.status ?? "unknown";
  const statusLabel = status === "running" ? "执行中" : status === "error" ? "执行失败" : status === "complete" ? "已完成" : "未记录结果";
  const StatusIcon = status === "running" ? LoaderCircle : status === "complete" ? Check : CircleAlert;
  return (
    <div className={`tool-card tool-card--${status}`}>
      <button type="button" className="tool-card__summary" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <span className="tool-card__icon">{block.name === "bash" ? <TerminalSquare size={15} /> : <Wrench size={15} />}</span>
        <span className="tool-card__copy">
          <strong>{block.name}</strong>
          <small>{toolHeadline(block.name, block.arguments)}</small>
        </span>
        <span title={statusLabel} aria-label={statusLabel}><StatusIcon size={14} className={status === "running" ? "spin" : ""} /></span>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded && (
        <div className="tool-card__detail">
          <div><span>参数</span><pre>{displayValue(block.arguments)}</pre></div>
          {execution?.partialResult !== undefined && <div><span>实时输出</span><pre>{displayValue(execution.partialResult)}</pre></div>}
          {execution?.result !== undefined && <div><span>结果</span><pre>{displayValue(execution.result)}</pre></div>}
        </div>
      )}
    </div>
  );
}

function ToolResultCard({ message }: { readonly message: Extract<SerializableMessage, { role: "toolResult" }> }) {
  const [expanded, setExpanded] = useState(false);
  const output = textContent(message.content);
  const preview = output.split("\n").slice(0, 2).join(" ").trim() || "工具没有返回文本输出";
  return (
    <div className={`tool-result ${message.isError ? "is-error" : ""}`}>
      <button type="button" onClick={() => setExpanded((value) => !value)}>
        <FileText size={14} />
        <span><strong>{message.toolName} 返回</strong><small>{preview}</small></span>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded && <pre>{output}</pre>}
    </div>
  );
}

const MarkdownBody = memo(function MarkdownBody({ api, text }: { readonly api: StellaDesktopApi; readonly text: string }) {
  const [linkError, setLinkError] = useState<string>();
  return (
    <>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            onClick={(event) => {
              if (!href) return;
              event.preventDefault();
              setLinkError(undefined);
              void api.openExternal(href).catch((cause: unknown) => {
                setLinkError(`无法打开链接：${cause instanceof Error ? cause.message : String(cause)}`);
              });
            }}
          >
            {children}
          </a>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
    {linkError && <p className="assistant-error" role="alert">{linkError}</p>}
    </>
  );
});

function SkillInvocationCard({
  api,
  invocation,
}: {
  readonly api: StellaDesktopApi;
  readonly invocation: ExpandedSkillInvocation;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className={`skill-invocation ${expanded ? "is-expanded" : ""}`}>
      <button
        type="button"
        className="skill-invocation__summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="skill-invocation__icon"><BookOpenCheck size={15} /></span>
        <span className="skill-invocation__copy">
          <small>PI SKILL</small>
          <strong>/skill:{invocation.name}</strong>
        </span>
        <span className="skill-invocation__state">{expanded ? "收起指令" : "已加载 · 展开查看"}</span>
        <ChevronDown size={14} />
      </button>
      {expanded && (
        <div className="skill-invocation__instructions markdown-body">
          <MarkdownBody api={api} text={invocation.instructions} />
        </div>
      )}
    </section>
  );
}

export function MessageCard({ api, message, toolExecutions, entryId, onFork, onPreviewFile }: MessageCardProps) {
  const { copied, copyError, copy } = useCopyFeedback(api);
  if (message.role === "bashExecution") return null;
  if (message.role === "branchSummary" || message.role === "compactionSummary") {
    return (
      <details className="session-summary-card">
        <summary>{message.role === "branchSummary" ? "分支摘要" : "上下文压缩摘要"}<ChevronDown size={14} /></summary>
        <div className="markdown-body"><MarkdownBody api={api} text={message.summary} /></div>
      </details>
    );
  }
  if (message.role === "custom" && !message.display) return null;

  const blocks = Array.isArray(message.content) ? message.content : [];
  const text = typeof message.content === "string" ? message.content : textContent(blocks);
  const thinking = blocks.filter(
    (block): block is Extract<SerializableContentBlock, { type: "thinking" }> => block.type === "thinking",
  );
  const toolCalls = blocks.filter(
    (block): block is Extract<SerializableContentBlock, { type: "toolCall" }> => block.type === "toolCall",
  );
  const images = blocks.filter(
    (block): block is Extract<SerializableContentBlock, { type: "image" }> => block.type === "image",
  );
  const textOnly = blocks
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
  const skillInvocation = message.role === "user" ? parseExpandedSkillInvocation(textOnly || text) : undefined;

  if (message.role === "toolResult") return <ToolResultCard message={message} />;

  if (message.role === "custom") {
    return (
      <article className="custom-message">
        <span>{message.customType}</span>
        <div className="markdown-body"><MarkdownBody api={api} text={text} /></div>
      </article>
    );
  }

  const copyText = skillInvocation ? skillInvocationCommand(skillInvocation) : textOnly || text;
  if (message.role === "user") {
    return (
      <article className="message message--user">
        <div className="message__bubble">
          {images.length > 0 && (
            <div className="message-images">
              {images.map((image, index) => (
                <img key={`${image.mimeType}-${index}`} src={`data:${image.mimeType};base64,${image.data}`} alt={`附件 ${index + 1}`} />
              ))}
            </div>
          )}
          {skillInvocation ? (
            <>
              <SkillInvocationCard api={api} invocation={skillInvocation} />
              {skillInvocation.userMessage && <p className="skill-invocation__user-message">{skillInvocation.userMessage}</p>}
            </>
          ) : text ? <p>{text}</p> : null}
          <div className="message__meta">
            <span>{formatTime(message.timestamp)}</span>
            {entryId && <button type="button" onClick={() => onFork(entryId)} title="从这里分叉"><GitFork size={13} /> 分叉</button>}
            <button type="button" onClick={() => void copy(copyText)} title={copied ? "已复制" : "复制"}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>
          </div>
          {copyError && <p className="assistant-error" role="alert">{copyError}</p>}
        </div>
      </article>
    );
  }

  return (
    <article className="message message--assistant">
      <div className="assistant-avatar" aria-hidden="true"><span>π</span><i /></div>
      <div className="message__body">
        <div className="message__label">
          <strong>Pi</strong>
          {message.role === "assistant" && <span>{message.provider} / {message.model}</span>}
          <time>{formatTime(message.timestamp)}</time>
        </div>
        {thinking.length > 0 && (
          <details className="thinking-block">
            <summary><span className="thinking-orbit" />推理过程<ChevronDown size={14} /></summary>
            <div>{thinking.map((block, index) => <p key={index}>{block.redacted ? "推理内容已由提供方隐藏" : block.thinking}</p>)}</div>
          </details>
        )}
        {textOnly && (
          <>
            <div className="markdown-body"><MarkdownBody api={api} text={textOnly} /></div>
            <LocalPathArtifacts api={api} text={textOnly} onPreviewFile={onPreviewFile} />
          </>
        )}
        {toolCalls.length > 0 && (
          <div className="tool-stack">
            {toolCalls.map((block) => <ToolCallCard key={block.id} block={block} execution={toolExecutions[block.id]} />)}
          </div>
        )}
        {message.role === "assistant" && message.errorMessage && (
          <div className="assistant-error"><CircleAlert size={15} /><span>{message.errorMessage}</span></div>
        )}
        <div className="assistant-actions">
          <button type="button" onClick={() => void copy(copyText)}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "已复制" : "复制"}</button>
          {message.role === "assistant" && message.usage && <span title={`${message.usage.totalTokens.toLocaleString()} tokens`}>{formatTokenMillions(message.usage.totalTokens)} tokens</span>}
        </div>
        {copyError && <p className="assistant-error" role="alert">{copyError}</p>}
      </div>
    </article>
  );
}
