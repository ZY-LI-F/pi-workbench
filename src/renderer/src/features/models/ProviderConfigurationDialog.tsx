import { useMemo, useState, type FormEvent } from "react";
import {
  Check,
  CirclePlus,
  Cpu,
  Eye,
  EyeOff,
  Radar,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  CUSTOM_MODEL_APIS,
  type CustomModelApi,
  type DiscoverPiModelsInput,
  type PiCustomProviderConfiguration,
  type PiDiscoveredModel,
  type PiModelConfigurationModel,
  type PiModelConfigurationProviderInput,
  type PiModelDiscoveryResult,
} from "@shared/model-configuration";
import { Modal } from "../../components/Modal";

interface ProviderConfigurationDialogProps {
  readonly provider?: PiCustomProviderConfiguration;
  readonly initialId?: string;
  readonly builtIn: boolean;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onDiscover: (input: DiscoverPiModelsInput) => Promise<PiModelDiscoveryResult>;
  readonly onSave: (input: PiModelConfigurationProviderInput, apiKey?: string) => Promise<void>;
  readonly onDelete: (providerId: string) => Promise<void>;
}

interface EditableModel {
  readonly key: string;
  readonly id: string;
  readonly name: string;
  readonly reasoning: boolean;
  readonly imageInput: boolean;
  readonly contextWindow: string;
  readonly maxTokens: string;
}

function editableModel(model?: PiModelConfigurationModel): EditableModel {
  return Object.freeze({
    key: crypto.randomUUID(),
    id: model?.id ?? "",
    name: model?.name ?? "",
    reasoning: model?.reasoning ?? false,
    imageInput: model?.imageInput ?? false,
    contextWindow: String(model?.contextWindow ?? 128_000),
    maxTokens: String(model?.maxTokens ?? 16_384),
  });
}

function editableDiscoveredModel(model: PiDiscoveredModel): EditableModel {
  return Object.freeze({
    key: crypto.randomUUID(),
    id: model.id,
    name: model.name ?? "",
    reasoning: model.reasoning ?? false,
    imageInput: model.imageInput ?? false,
    contextWindow: String(model.contextWindow ?? 128_000),
    maxTokens: String(model.maxTokens ?? 16_384),
  });
}

function modelInput(model: EditableModel): PiModelConfigurationModel {
  return Object.freeze({
    id: model.id,
    name: model.name || undefined,
    reasoning: model.reasoning,
    imageInput: model.imageInput,
    contextWindow: Number(model.contextWindow),
    maxTokens: Number(model.maxTokens),
  });
}

function compactTokens(tokens: number | undefined): string {
  if (!tokens) return "默认";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

function credentialSourceLabel(source: PiModelDiscoveryResult["credentialSource"]): string {
  if (source === "draft") return "使用本次输入 Key";
  if (source === "configured") return "使用已保存 Key";
  return "无鉴权请求";
}

export function ProviderConfigurationDialog({
  provider,
  initialId,
  builtIn,
  busy,
  onClose,
  onDiscover,
  onSave,
  onDelete,
}: ProviderConfigurationDialogProps) {
  const [id, setId] = useState(provider?.id ?? initialId ?? "");
  const [name, setName] = useState(provider?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [api, setApi] = useState<CustomModelApi | "">(provider?.api ?? (builtIn ? "" : "openai-completions"));
  const [authHeader, setAuthHeader] = useState(provider?.authHeader ?? false);
  const [models, setModels] = useState<readonly EditableModel[]>(
    Object.freeze((provider?.models ?? []).map(editableModel)),
  );
  const [setupApiKey, setSetupApiKey] = useState("");
  const [showSetupApiKey, setShowSetupApiKey] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discovery, setDiscovery] = useState<PiModelDiscoveryResult>();
  const [discoveryQuery, setDiscoveryQuery] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const visibleDiscoveredModels = useMemo(() => {
    const query = discoveryQuery.trim().toLocaleLowerCase();
    return (discovery?.models ?? []).filter((model) =>
      !query || `${model.name ?? ""} ${model.id} ${model.owner ?? ""}`.toLocaleLowerCase().includes(query));
  }, [discovery?.models, discoveryQuery]);
  const discoveredModelIds = useMemo(
    () => new Set((discovery?.models ?? []).map((model) => model.id)),
    [discovery?.models],
  );
  const selectedDiscoveryCount = models.filter((model) => discoveredModelIds.has(model.id)).length;
  const canDiscover = Boolean(id.trim() && baseUrl.trim() && api) && !discovering && !busy;
  const canSave = Boolean(id.trim()) && (builtIn || Boolean(baseUrl.trim() && api && models.length > 0));

  const clearDiscovery = () => {
    setDiscovery(undefined);
    setDiscoveryQuery("");
    setError("");
  };

  const updateModel = (key: string, patch: Partial<Omit<EditableModel, "key">>) => {
    setModels((current) => Object.freeze(current.map((model) =>
      model.key === key ? Object.freeze({ ...model, ...patch }) : model)));
  };

  const toggleDiscoveredModel = (model: PiDiscoveredModel) => {
    setModels((current) => {
      const selected = current.some((candidate) => candidate.id === model.id);
      return selected
        ? Object.freeze(current.filter((candidate) => candidate.id !== model.id))
        : Object.freeze([...current, editableDiscoveredModel(model)]);
    });
  };

  const selectVisibleModels = () => {
    setModels((current) => {
      const selected = new Set(current.map((model) => model.id));
      return Object.freeze([
        ...current,
        ...visibleDiscoveredModels.filter((model) => !selected.has(model.id)).map(editableDiscoveredModel),
      ]);
    });
  };

  const removeVisibleModels = () => {
    const visibleIds = new Set(visibleDiscoveredModels.map((model) => model.id));
    setModels((current) => Object.freeze(current.filter((model) => !visibleIds.has(model.id))));
  };

  const discoverModels = async () => {
    if (!api) return;
    setError("");
    setDiscovering(true);
    try {
      const result = await onDiscover(Object.freeze({
        providerId: id,
        baseUrl,
        api,
        ...(setupApiKey.trim() ? { apiKey: setupApiKey } : {}),
        authHeader,
      }));
      setDiscovery(result);
      setDiscoveryQuery("");
    } catch (cause) {
      setDiscovery(undefined);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDiscovering(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await onSave(Object.freeze({
        id,
        name: name || undefined,
        baseUrl: baseUrl || undefined,
        api: api || undefined,
        authHeader,
        models: Object.freeze(models.map(modelInput)),
      }), setupApiKey.trim() ? setupApiKey : undefined);
      setSetupApiKey("");
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <Modal
      title={provider ? `配置 ${provider.name ?? provider.id}` : "接入自定义 Provider"}
      eyebrow="PI MODEL ROUTE · MODELS.JSON"
      onClose={onClose}
      className="provider-configuration-dialog"
    >
      <form onSubmit={(event) => void submit(event)}>
        <div className="provider-editor__intro">
          <span><Cpu size={16} /></span>
          <div>
            <strong>{builtIn ? "内置 Provider 覆盖" : "自定义 OpenAI / Anthropic / Gemini 兼容端点"}</strong>
            <small>{builtIn ? "留空的字段继续使用 Pi 内置目录；发现模型需要明确填写 Base URL 与 API 协议。" : "输入端点与 Key 后先发现远端模型，再选择要加入 Pi 的模型。"}</small>
          </div>
        </div>

        {provider?.hasInlineApiKey && (
          <p className="provider-editor__notice"><ShieldCheck size={14} />该 Provider 在 models.json 中已有内联密钥或变量引用。页面不会读取或回显它，保存其它字段时会原样保留。</p>
        )}
        {provider?.hasAdvancedConfiguration && (
          <p className="provider-editor__notice">检测到 headers、compat、modelOverrides 或其它高级字段；本表单不会覆盖这些字段。</p>
        )}

        <div className="provider-editor__row">
          <label className="model-field"><span>Provider ID <i>必填</i></span><input autoFocus={!provider && !initialId} value={id} disabled={Boolean(provider || initialId) || discovering} onChange={(event) => { setId(event.target.value); clearDiscovery(); }} placeholder="例如：aliyun-qwen" /></label>
          <label className="model-field"><span>显示名称</span><input value={name} disabled={discovering} onChange={(event) => setName(event.target.value)} placeholder="例如：阿里百炼" /></label>
        </div>
        <label className="model-field"><span>Base URL {!builtIn && <i>必填</i>}</span><input value={baseUrl} disabled={discovering} onChange={(event) => { setBaseUrl(event.target.value); clearDiscovery(); }} placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" /></label>
        <div className="provider-editor__row">
          <label className="model-field"><span>API 协议 {!builtIn && <i>必填</i>}</span><select value={api} disabled={discovering} onChange={(event) => { setApi(event.target.value as CustomModelApi | ""); clearDiscovery(); }}>
            {builtIn && <option value="">继承 Pi 内置协议</option>}
            {CUSTOM_MODEL_APIS.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}
          </select></label>
          <label className="provider-editor__switch"><input type="checkbox" checked={authHeader} disabled={discovering} onChange={(event) => { setAuthHeader(event.target.checked); clearDiscovery(); }} /><span><strong>Bearer Auth Header</strong><small>为需要额外 Authorization 的兼容端点启用</small></span></label>
        </div>

        <section className={`provider-discovery ${discovery ? "has-result" : ""}`} aria-label="远端模型发现">
          <header>
            <span className="provider-discovery__radar"><Radar size={17} /></span>
            <div><small>REMOTE MODEL RADAR</small><strong>根据 URL 与 Key 发现模型</strong><p>目录连通只说明 Key 可以列出模型；保存后仍需在配置台发送真实模型请求。</p></div>
            {discovery && <em>{discovery.models.length} FOUND</em>}
          </header>
          <div className="provider-discovery__connect">
            <label className="provider-discovery__key">
              <span>API Key <i>{provider ? "留空使用当前凭据" : "本地端点可留空"}</i></span>
              <span><input aria-label="模型发现 API key" type={showSetupApiKey ? "text" : "password"} autoComplete="new-password" autoCapitalize="off" spellCheck={false} disabled={discovering || busy} value={setupApiKey} onChange={(event) => { setSetupApiKey(event.target.value); clearDiscovery(); }} placeholder={provider ? "输入新 Key，或留空使用已保存 Key" : "输入用于发现并保存的 API Key"} /><button type="button" aria-label={showSetupApiKey ? "隐藏模型发现 API key" : "显示模型发现 API key"} disabled={!setupApiKey || discovering} onClick={() => setShowSetupApiKey((current) => !current)}>{showSetupApiKey ? <EyeOff size={14} /> : <Eye size={14} />}</button></span>
            </label>
            <button type="button" className="button-primary" disabled={!canDiscover} onClick={() => void discoverModels()}><RefreshCw size={14} className={discovering ? "spin" : ""} />{discovering ? "正在读取目录…" : "发现远端模型"}</button>
          </div>

          {discovery && <>
            <div className="provider-discovery__result-meta">
              <span><Check size={12} />{credentialSourceLabel(discovery.credentialSource)} · {discovery.latencyMs} ms</span>
              <code title={discovery.endpoint}>{discovery.endpoint}</code>
            </div>
            <div className="provider-discovery__toolbar">
              <label><Search size={13} /><input aria-label="筛选发现的模型" value={discoveryQuery} onChange={(event) => setDiscoveryQuery(event.target.value)} placeholder="筛选模型名称或 ID" /></label>
              <span>{selectedDiscoveryCount}/{discovery.models.length} 已加入</span>
              <button type="button" className="button-secondary" disabled={visibleDiscoveredModels.length === 0} onClick={selectVisibleModels}>加入可见</button>
              <button type="button" className="button-secondary" disabled={visibleDiscoveredModels.length === 0} onClick={removeVisibleModels}>移除可见</button>
            </div>
            <div className="provider-discovery__models" role="list" aria-label="发现的模型列表">
              {visibleDiscoveredModels.map((model) => {
                const selected = models.some((candidate) => candidate.id === model.id);
                return <label className={`provider-discovery-model ${selected ? "is-selected" : ""}`} key={model.id} role="listitem">
                  <input type="checkbox" aria-label={`${selected ? "移除" : "添加"}模型 ${model.id}`} checked={selected} onChange={() => toggleDiscoveredModel(model)} />
                  <span className="provider-discovery-model__check">{selected && <Check size={11} />}</span>
                  <span className="provider-discovery-model__identity"><strong>{model.name ?? model.id}</strong><code>{model.id}</code></span>
                  <span className="provider-discovery-model__meta"><small>{model.owner ?? "REMOTE"}</small><strong>CTX {compactTokens(model.contextWindow ?? 128_000)} · OUT {compactTokens(model.maxTokens ?? 16_384)}</strong></span>
                </label>;
              })}
              {visibleDiscoveredModels.length === 0 && <p>{discovery.models.length === 0 ? "端点返回了空模型目录。" : "没有匹配的远端模型。"}</p>}
            </div>
          </>}
        </section>

        <section className="provider-model-editor">
          <header><div><small>PI MODEL MAP</small><strong>已加入模型 · {models.length}</strong></div><button type="button" className="button-secondary" onClick={() => setModels((current) => Object.freeze([...current, editableModel()]))}><CirclePlus size={13} />手工添加</button></header>
          {models.length === 0 && <p className="provider-model-editor__empty">尚未加入模型。使用上方远端模型雷达选择，或手工添加 Model ID。</p>}
          {models.map((model, index) => (
            <article className="provider-model-row" key={model.key}>
              <span className="provider-model-row__index">{String(index + 1).padStart(2, "0")}</span>
              <label className="model-field"><span>Model ID</span><input value={model.id} onChange={(event) => updateModel(model.key, { id: event.target.value })} placeholder="qwen-plus" /></label>
              <label className="model-field"><span>名称</span><input value={model.name} onChange={(event) => updateModel(model.key, { name: event.target.value })} placeholder="可选" /></label>
              <label className="model-field model-field--number"><span>Context</span><input type="number" min="1" value={model.contextWindow} onChange={(event) => updateModel(model.key, { contextWindow: event.target.value })} /></label>
              <label className="model-field model-field--number"><span>Max out</span><input type="number" min="1" value={model.maxTokens} onChange={(event) => updateModel(model.key, { maxTokens: event.target.value })} /></label>
              <div className="provider-model-row__flags">
                <label><input type="checkbox" checked={model.reasoning} onChange={(event) => updateModel(model.key, { reasoning: event.target.checked })} />推理</label>
                <label><input type="checkbox" checked={model.imageInput} onChange={(event) => updateModel(model.key, { imageInput: event.target.checked })} />图像</label>
              </div>
              <button type="button" className="icon-button" aria-label={`删除模型 ${model.id || index + 1}`} onClick={() => setModels((current) => Object.freeze(current.filter((candidate) => candidate.key !== model.key)))}><X size={14} /></button>
            </article>
          ))}
        </section>

        {!builtIn && models.length === 0 && <p className="provider-editor__requirement">自定义 Provider 至少需要加入一个模型后才能保存。</p>}
        {error && <p className="model-form-error" role="alert">{error}</p>}
        <div className="modal-actions provider-editor__actions">
          {provider && (!confirmDelete
            ? <button type="button" className="button-danger-soft" onClick={() => setConfirmDelete(true)}><Trash2 size={13} />移除配置</button>
            : <button type="button" className="button-danger-soft" disabled={busy || discovering} onClick={() => void onDelete(provider.id).then(onClose).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))}><Trash2 size={13} />确认移除</button>)}
          <span />
          <button type="button" className="button-secondary" disabled={busy || discovering} onClick={onClose}>取消</button>
          <button type="submit" className="button-primary" disabled={busy || discovering || !canSave}>{busy ? "应用并重载 Pi…" : setupApiKey.trim() ? "保存 Provider 与 Key" : "保存并应用"}</button>
        </div>
      </form>
    </Modal>
  );
}
