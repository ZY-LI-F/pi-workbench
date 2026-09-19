import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import {
  ArrowUp,
  Command,
  FileImage,
  Paperclip,
  Square,
  TerminalSquare,
  X,
} from "lucide-react";
import type { SlashCommandSummary } from "@shared/contracts";
import type { RuntimeUiState } from "../lib/runtime-state";
import type { ComposerDraftPersistence, ComposerImage } from "../hooks/use-session-composer-draft";
import {
  AUTO_COMPOSER_EDITOR_MAX_HEIGHT,
  constrainComposerEditorHeight,
  maximumComposerEditorHeight,
  MIN_COMPOSER_EDITOR_HEIGHT,
} from "../lib/composer-layout";

export type { ComposerImage } from "../hooks/use-session-composer-draft";

interface ComposerProps {
  readonly draft: string;
  readonly onDraftChange: Dispatch<SetStateAction<string>>;
  readonly images: readonly ComposerImage[];
  readonly onImagesChange: Dispatch<SetStateAction<readonly ComposerImage[]>>;
  readonly editorInjection?: { readonly id: string; readonly text: string };
  readonly onEditorInjectionApplied?: (id: string) => void;
  readonly commands: readonly SlashCommandSummary[];
  readonly widgets: RuntimeUiState["extensionWidgets"];
  readonly streaming: boolean;
  readonly queueMode: "steer" | "followUp";
  readonly onQueueModeChange: (mode: "steer" | "followUp") => void;
  /** The session owner captures and consumes its draft only after Pi accepts. */
  readonly onSend: (message: string, images: readonly ComposerImage[]) => Promise<void>;
  readonly onStop: () => void;
  readonly onOpenTerminal: () => void;
  readonly onOpenPalette: () => void;
  readonly onError: (message: string) => void;
  readonly sendDisabled?: boolean;
  readonly sendDisabledReason?: string;
  readonly draftPersistence?: ComposerDraftPersistence;
  readonly height: number | null;
  readonly onHeightChange: (height: number | null) => void;
}

const SLASH_COMMAND_SOURCE_SEARCH = Object.freeze({
  extension: "extension 扩展",
  prompt: "prompt 提示词 命令",
  skill: "skill skills 技能",
} satisfies Record<SlashCommandSummary["source"], string>);

function slashCommandKey(command: SlashCommandSummary): string {
  return `${command.source}:${command.name}`;
}

function slashCommandSearchText(command: SlashCommandSummary): string {
  return `${command.name} ${command.description ?? ""} ${SLASH_COMMAND_SOURCE_SEARCH[command.source]}`.toLocaleLowerCase();
}

function fileToImage(file: File): Promise<ComposerImage> {
  if (!file.type.startsWith("image/")) return Promise.reject(new Error(`${file.name} 不是图片文件`));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`无法读取 ${file.name}`));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`无法读取 ${file.name}: FileReader 未返回 data URL`));
        return;
      }
      const comma = reader.result.indexOf(",");
      if (comma < 0) {
        reject(new Error(`无法读取 ${file.name}: data URL 格式无效`));
        return;
      }
      resolve(Object.freeze({ type: "image", data: reader.result.slice(comma + 1), mimeType: file.type, name: file.name }));
    };
    reader.readAsDataURL(file);
  });
}

export function Composer({
  draft,
  onDraftChange,
  images,
  onImagesChange,
  editorInjection,
  onEditorInjectionApplied,
  commands,
  widgets,
  streaming,
  queueMode,
  onQueueModeChange,
  onSend,
  onStop,
  onOpenTerminal,
  onOpenPalette,
  onError,
  sendDisabled = false,
  sendDisabledReason,
  draftPersistence = Object.freeze({ status: "saved" }),
  height,
  onHeightChange,
}: ComposerProps) {
  const slashListId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resizeStart = useRef<Readonly<{ clientY: number; height: number }> | null>(null);
  const slashOptionRefs = useRef(new Map<string, HTMLButtonElement>());
  const compositionActiveRef = useRef(false);
  const submittingRef = useRef(false);
  const [sending, setSending] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [activeSlashCommandKey, setActiveSlashCommandKey] = useState<string>();
  const [dismissedSlashDraft, setDismissedSlashDraft] = useState<string>();
  const slashBody = draft.startsWith("/") && !draft.includes("\n") ? draft.slice(1) : null;
  const slashQuery = slashBody !== null && !/\s/u.test(slashBody) ? slashBody : null;
  const matchingCommands = useMemo(
    () =>
      slashQuery === null
        ? []
        : commands
            .filter((command) => slashCommandSearchText(command).includes(slashQuery.toLocaleLowerCase())),
    [commands, slashQuery],
  );
  const slashMenuOpen = matchingCommands.length > 0 && dismissedSlashDraft !== draft;
  const storedActiveSlashIndex = matchingCommands.findIndex((command) => slashCommandKey(command) === activeSlashCommandKey);
  const activeSlashIndex = storedActiveSlashIndex >= 0 ? storedActiveSlashIndex : 0;
  const activeSlashCommand = slashMenuOpen ? matchingCommands[activeSlashIndex] : undefined;
  const resolvedActiveSlashKey = activeSlashCommand ? slashCommandKey(activeSlashCommand) : undefined;
  const slashMenuLabel = matchingCommands.every((command) => command.source === "skill") ? "Pi Skills" : "Pi 命令";
  const aboveWidgets = Object.entries(widgets).filter(([, widget]) => widget.placement === "aboveEditor");
  const belowWidgets = Object.entries(widgets).filter(([, widget]) => widget.placement === "belowEditor");
  const manualHeight = height === null ? null : constrainComposerEditorHeight(height, window.innerHeight);

  useEffect(() => {
    if (!editorInjection) return;
    setDismissedSlashDraft(undefined);
    setActiveSlashCommandKey(undefined);
    onDraftChange(editorInjection.text);
    onEditorInjectionApplied?.(editorInjection.id);
    textareaRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 每条注入只按 id 应用一次；跟踪对象或回调身份会在重渲染时覆盖用户草稿
  }, [editorInjection?.id]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (manualHeight !== null) {
      textarea.style.height = `${manualHeight}px`;
      return;
    }
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, AUTO_COMPOSER_EDITOR_MAX_HEIGHT)}px`;
  }, [draft, manualHeight]);

  useEffect(() => {
    if (!resizing) return;
    const handlePointerMove = (event: PointerEvent): void => {
      const start = resizeStart.current;
      if (!start) return;
      onHeightChange(constrainComposerEditorHeight(start.height + start.clientY - event.clientY, window.innerHeight));
    };
    const stopResizing = (): void => {
      resizeStart.current = null;
      setResizing(false);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };
  }, [onHeightChange, resizing]);

  useEffect(() => {
    if (!slashMenuOpen || !resolvedActiveSlashKey) return;
    slashOptionRefs.current.get(resolvedActiveSlashKey)?.scrollIntoView?.({ block: "nearest" });
  }, [resolvedActiveSlashKey, slashMenuOpen]);

  const selectSlashCommand = (command: SlashCommandSummary): void => {
    setDismissedSlashDraft(undefined);
    setActiveSlashCommandKey(undefined);
    onDraftChange(`/${command.name} `);
    textareaRef.current?.focus();
  };

  const moveSlashSelection = (direction: 1 | -1): void => {
    if (matchingCommands.length === 0) return;
    const nextIndex = (activeSlashIndex + direction + matchingCommands.length) % matchingCommands.length;
    const nextCommand = matchingCommands[nextIndex];
    if (nextCommand) setActiveSlashCommandKey(slashCommandKey(nextCommand));
  };

  const measuredEditorHeight = (): number => {
    const measured = textareaRef.current?.getBoundingClientRect().height ?? 0;
    return Math.max(MIN_COMPOSER_EDITOR_HEIGHT, measured);
  };

  const startResizing = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    resizeStart.current = Object.freeze({ clientY: event.clientY, height: manualHeight ?? measuredEditorHeight() });
    setResizing(true);
  };

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 48 : 16;
    const current = manualHeight ?? measuredEditorHeight();
    const next = event.key === "ArrowUp"
      ? current + step
      : event.key === "ArrowDown"
        ? current - step
        : event.key === "Home"
          ? MIN_COMPOSER_EDITOR_HEIGHT
          : event.key === "End"
            ? maximumComposerEditorHeight(window.innerHeight)
            : undefined;
    if (next === undefined) return;
    event.preventDefault();
    onHeightChange(constrainComposerEditorHeight(next, window.innerHeight));
  };

  const submit = async () => {
    if (submittingRef.current) return;
    if (sendDisabled) {
      onError(`当前无法发送：${sendDisabledReason ?? "Pi Runtime 尚未就绪"}`);
      return;
    }
    if (!draft.trim() && images.length === 0) return;
    submittingRef.current = true;
    setSending(true);
    const submissionFocus = document.activeElement;
    try {
      await onSend(draft.trim(), images);
    } catch (error) {
      onError(`消息发送失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      submittingRef.current = false;
      setSending(false);
      if (document.activeElement === submissionFocus) textareaRef.current?.focus();
    }
  };

  return (
    <div className="composer-wrap">
      <div className="composer-orbit" aria-hidden="true"><i /><span /><span /></div>
      <div className={`composer ${streaming ? "is-streaming" : ""}${resizing ? " is-resizing" : ""}`}>
        <div
          className="composer__resize-handle"
          role="separator"
          tabIndex={0}
          aria-label="调整输入区高度"
          aria-orientation="horizontal"
          aria-valuemin={MIN_COMPOSER_EDITOR_HEIGHT}
          aria-valuemax={maximumComposerEditorHeight(window.innerHeight)}
          aria-valuenow={manualHeight ?? MIN_COMPOSER_EDITOR_HEIGHT}
          aria-valuetext={manualHeight === null ? "自动高度" : `${manualHeight} 像素`}
          title="上下拖动调整输入区高度；双击恢复自动高度"
          onPointerDown={startResizing}
          onKeyDown={resizeWithKeyboard}
          onDoubleClick={() => onHeightChange(null)}
        ><i /><i /><i /></div>
        {slashMenuOpen && (
          <div className="slash-menu popover-surface">
            <header className="slash-menu__header">
              <p className="popover-label">{slashMenuLabel}</p>
              <span className="slash-menu__navigation-hint" aria-hidden="true"><kbd>↑↓</kbd> 选择 · <kbd>Esc</kbd> 关闭</span>
            </header>
            <div className="slash-menu__list" id={slashListId} role="listbox" aria-label="斜杠命令候选">
              {matchingCommands.map((command, index) => {
                const commandKey = slashCommandKey(command);
                const active = index === activeSlashIndex;
                return (
                  <button
                    type="button"
                    role="option"
                    id={`${slashListId}-option-${index}`}
                    aria-selected={active}
                    tabIndex={-1}
                    className={active ? "is-active" : undefined}
                    key={commandKey}
                    ref={(node) => {
                      if (node) slashOptionRefs.current.set(commandKey, node);
                      else slashOptionRefs.current.delete(commandKey);
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveSlashCommandKey(commandKey)}
                    onClick={() => selectSlashCommand(command)}
                  >
                    <span className={`slash-menu__source slash-menu__source--${command.source}`}><Command size={13} /></span>
                    <span className="slash-menu__content"><strong>/{command.name}</strong><small>{command.description || command.source}</small></span>
                    {active && <span className="slash-menu__confirm" aria-hidden="true"><kbd>Enter</kbd><small>或 Tab</small></span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {images.length > 0 && (
          <div className="composer-images">
            {images.map((image, index) => (
              <div key={`${image.name}-${index}`}>
                <img src={`data:${image.mimeType};base64,${image.data}`} alt={image.name} />
                <button type="button" aria-label={`移除 ${image.name}`} onClick={() => onImagesChange((current) => Object.freeze(current.filter((_, imageIndex) => imageIndex !== index)))}><X size={12} /></button>
                <span>{image.name}</span>
              </div>
            ))}
          </div>
        )}

        {aboveWidgets.map(([key, widget]) => <div className="composer-widget" key={key}><strong>{key}</strong><pre>{widget.lines.join("\n")}</pre></div>)}

        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => {
            setDismissedSlashDraft(undefined);
            setActiveSlashCommandKey(undefined);
            onDraftChange(event.target.value);
          }}
          onCompositionStart={() => {
            compositionActiveRef.current = true;
          }}
          onCompositionEnd={() => {
            compositionActiveRef.current = false;
          }}
          onKeyDown={(event) => {
            // Chromium on Windows can leave nativeEvent.isComposing=true for the first
            // post-composition Enter. Track the actual composition lifecycle instead.
            if (compositionActiveRef.current) return;
            if (slashMenuOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
              event.preventDefault();
              moveSlashSelection(event.key === "ArrowDown" ? 1 : -1);
              return;
            }
            if (slashMenuOpen && ((event.key === "Enter" && !event.shiftKey) || (event.key === "Tab" && !event.shiftKey))) {
              if (!activeSlashCommand) return;
              event.preventDefault();
              selectSlashCommand(activeSlashCommand);
              return;
            }
            if (slashMenuOpen && event.key === "Escape") {
              event.preventDefault();
              setDismissedSlashDraft(draft);
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
              return;
            }
            if (event.key === "Escape" && streaming) onStop();
          }}
          placeholder={sendDisabled ? "Pi 正在恢复；可以先准备消息和附件…" : streaming ? "补充指令，或排到当前任务之后…" : "描述目标，添加图片，或输入 / 使用命令…"}
          rows={1}
          aria-label="给 Pi 的消息"
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-controls={slashMenuOpen ? slashListId : undefined}
          aria-expanded={slashMenuOpen}
          aria-activedescendant={slashMenuOpen ? `${slashListId}-option-${activeSlashIndex}` : undefined}
          style={manualHeight === null ? undefined : { height: `${manualHeight}px`, maxHeight: `${manualHeight}px` }}
        />

        {belowWidgets.map(([key, widget]) => <div className="composer-widget composer-widget--below" key={key}><strong>{key}</strong><pre>{widget.lines.join("\n")}</pre></div>)}

        <div className="composer__toolbar">
          <div className="composer__tools">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                void Promise.all(files.map(fileToImage))
                  .then((next) => onImagesChange((current) => Object.freeze([...current, ...next])))
                  .catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)));
                event.currentTarget.value = "";
              }}
            />
            <button type="button" className="composer-tool" aria-label="添加图片" title="添加图片" onClick={() => fileInputRef.current?.click()}><Paperclip size={17} /></button>
            <button type="button" className="composer-tool" aria-label="运行命令" title="运行命令" disabled={sendDisabled} onClick={onOpenTerminal}><TerminalSquare size={17} /></button>
            <button type="button" className="composer-tool composer-tool--commands" onClick={onOpenPalette}><Command size={15} /><span>命令</span></button>
            {streaming && (
              <div className="queue-mode" role="group" aria-label="消息发送方式">
                <button type="button" className={queueMode === "steer" ? "is-active" : ""} onClick={() => onQueueModeChange("steer")}>引导</button>
                <button type="button" className={queueMode === "followUp" ? "is-active" : ""} onClick={() => onQueueModeChange("followUp")}>排队</button>
              </div>
            )}
          </div>
          <div className="composer__send-area">
            <span className="composer__signature" aria-label="Stella 签名">Stella</span>
            <span className="composer__hint">Enter 发送 · Shift Enter 换行</span>
            {streaming ? (
              <button type="button" className="send-button send-button--stop" aria-label="停止" title="停止 Pi 与此运行实例派生的本机后台计算；远程或容器任务需另行核查" onClick={onStop}><Square size={15} fill="currentColor" /></button>
            ) : (
              <button type="button" className="send-button" disabled={sending || sendDisabled || (!draft.trim() && images.length === 0)} aria-label="发送" onClick={() => void submit()}><ArrowUp size={18} /></button>
            )}
          </div>
        </div>
        <div className="composer__attachment-note" aria-live="polite">
          <span><FileImage size={11} />{images.length > 0 ? `${images.length} 个附件已保留在当前会话草稿中` : "附件会随当前会话草稿保留，发送成功后进入消息记录"}</span>
          <small className={`composer__draft-state is-${draftPersistence.status}`} title={draftPersistence.status === "error" ? draftPersistence.message : undefined}>
            {draftPersistence.status === "loading"
              ? "正在恢复本机草稿…"
              : draftPersistence.status === "saving"
                ? "正在保存草稿…"
                : draftPersistence.status === "saved"
                  ? "草稿已保存至本机"
                  : draftPersistence.status === "recovered"
                    ? "已恢复上次未发送草稿"
                    : `草稿保存失败：${draftPersistence.message}`}
          </small>
          {sendDisabledReason && <strong>{sendDisabledReason}</strong>}
        </div>
      </div>
    </div>
  );
}
