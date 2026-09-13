import { useMemo } from "react";
import { ArrowDown, ArrowUpRight, Code2, FileCode2, GitFork, Sparkles, WandSparkles } from "lucide-react";
import type {
  RuntimeBootstrap,
  SerializableContentBlock,
  SerializableMessage,
  StellaDesktopApi,
} from "@shared/contracts";
import type { LocalPathInspection } from "@shared/local-path";
import type { ToolExecutionState } from "../lib/runtime-state";
import { MessageCard } from "./MessageCard";
import { useConversationScroll, type ConversationScrollMemory } from "../hooks/use-conversation-scroll";

interface ConversationProps {
  readonly api: StellaDesktopApi;
  readonly bootstrap: RuntimeBootstrap;
  readonly messages: readonly SerializableMessage[];
  readonly tools: Readonly<Record<string, ToolExecutionState>>;
  readonly streaming: boolean;
  readonly scrollMemory: ConversationScrollMemory;
  readonly onPrefill: (text: string) => void;
  readonly onFork: (entryId: string) => void;
  readonly onPreviewFile: (inspection: LocalPathInspection) => void;
}

const SUGGESTIONS = Object.freeze([
  Object.freeze({ icon: FileCode2, label: "理解项目", prompt: "先阅读这个项目，概括架构、运行方式和最值得关注的风险。" }),
  Object.freeze({ icon: Code2, label: "实现功能", prompt: "请分析现有代码并实现下面的需求：\n" }),
  Object.freeze({ icon: GitFork, label: "检查改动", prompt: "检查当前未提交改动，指出问题并给出可执行的修复建议。" }),
]);

function EmptyConversation({ projectName, onPrefill }: { readonly projectName: string; readonly onPrefill: (text: string) => void }) {
  return (
    <div className="empty-conversation">
      <div className="empty-conversation__constellation" aria-hidden="true">
        <span /><span /><span /><i />
      </div>
      <div className="empty-conversation__eyebrow"><Sparkles size={13} /> STELLA / READY</div>
      <h1>今天想让 Pi<br /><em>完成什么？</em></h1>
      <p>已连接到 <strong>{projectName}</strong>。你可以直接描述目标，Pi 会读取、修改并验证本地代码。</p>
      <div className="suggestion-grid">
        {SUGGESTIONS.map(({ icon: Icon, label, prompt }) => (
          <button type="button" key={label} aria-label={label} onClick={() => onPrefill(prompt)}>
            <Icon size={17} />
            <span><strong>{label}</strong><small>{prompt.trim()}</small></span>
            <ArrowUpRight size={14} />
          </button>
        ))}
      </div>
      <div className="empty-conversation__signature" aria-label="Stella 签名">
        <WandSparkles size={14} /><span>Stella</span><i />
      </div>
    </div>
  );
}

export function Conversation({
  api,
  bootstrap,
  messages,
  tools,
  streaming,
  scrollMemory,
  onPrefill,
  onFork,
  onPreviewFile,
}: ConversationProps) {
  const { scrollerRef, contentRef, following, onScroll, jumpToLatest } = useConversationScroll(
    `${bootstrap.project.cwd}\u0000${bootstrap.state.sessionId}`, scrollMemory,
  );
  const visibleMessages = useMemo(
    () => messages.filter((message) =>
      message.role !== "bashExecution" && !(message.role === "custom" && !message.display),
    ),
    [messages],
  );

  return (
    <div className="conversation-viewport">
    <div
      className="conversation-scroll"
      ref={scrollerRef}
      onScroll={onScroll}
      role="region"
      aria-label="会话消息"
      tabIndex={0}
    >
      <div className="conversation-content" ref={contentRef}>
        {visibleMessages.length === 0 ? (
          <EmptyConversation projectName={bootstrap.project.name} onPrefill={onPrefill} />
        ) : (
          visibleMessages.map((message, index) => {
            const key = message.stella?.key ?? `snapshot:${bootstrap.state.sessionId}:${index}`;
            return (
              <div key={key} data-message-key={key} className="conversation-entry">
              <MessageCard
                api={api}
                message={message}
                toolExecutions={tools}
                entryId={message.role === "user" ? message.stella?.entryId : undefined}
                onFork={onFork}
                onPreviewFile={onPreviewFile}
              />
              </div>
            );
          })
        )}
        {streaming && visibleMessages.length > 0 && (
          <div className="stella-working" aria-live="polite">
            <span className="stella-working__star" />
            <span>Stella 正在沿着 Pi 的轨迹整理结果</span>
            <i /><i /><i />
          </div>
        )}
      </div>
    </div>
    {!following && visibleMessages.length > 0 && (
      <button type="button" className="conversation-jump" onClick={jumpToLatest}><ArrowDown size={15} />回到最新消息</button>
    )}
    </div>
  );
}

export function textFromBlocks(blocks: readonly SerializableContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<SerializableContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
