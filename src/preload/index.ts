import { contextBridge, ipcRenderer } from "electron";
import type {
  BridgeEvent,
  PiCommand,
  PiExtensionResponse,
  ProjectSelection,
  RuntimeBootstrap,
  StellaDesktopApi,
} from "../shared/contracts";
import type { CapabilityHealthSnapshot, CapabilityName } from "../shared/capabilities";
import type { ConfigureExecutionBackendInput, ExecutionBackendCatalogSnapshot, ExecutionBackendId } from "../shared/execution-profile";
import type { SkinArtworkDescriptor, SkinId } from "../shared/skin-artwork";
import type {
  DiscoverPiModelsInput,
  PiModelConfigurationProviderInput,
  PiModelConfigurationSnapshot,
  PiApiKeyRevealResult,
  PiModelDiscoveryResult,
  PiModelConnectionTestResult,
  SavePiApiKeyInput,
  SavePiProviderSetupInput,
  TestPiModelConnectionInput,
} from "../shared/model-configuration";
import type {
  BoardBootstrap,
  CreateAutopilotInput,
  CreateProjectAgentInput,
  CreateTaskCommentInput,
  CreateSquadInput,
  CreateTaskInput,
  LaunchTeamTaskInput,
  ManualTaskStage,
  OpenTaskSessionInput,
  ReviewExecutionInput,
  ResolveGateInput,
  UpdateTaskInput,
  UpdateAutopilotInput,
  UpdateProjectAgentInput,
  UpdateSquadInput,
} from "../shared/kanban";
import type { ComposerDraftSnapshot, SaveComposerDraftInput } from "../shared/composer-draft";
import type { PiSkillInstallResult, PiSkillInstallScope } from "../shared/pi-skill";
import type {
  ContinueExternalExecutionInput,
  ExternalExecutionScope,
  ImportExternalExecutionInput,
  ReadExternalExecutionDetailsInput,
} from "../shared/external-execution";

const api: StellaDesktopApi = Object.freeze({
  capabilities: () => ipcRenderer.invoke("stella:capabilities") as Promise<CapabilityHealthSnapshot>,
  retryCapability: (name: CapabilityName) => ipcRenderer.invoke("stella:capability:retry", name) as Promise<CapabilityHealthSnapshot>,
  executionBackendsInitialize: () => ipcRenderer.invoke("stella:execution-backends:initialize") as Promise<ExecutionBackendCatalogSnapshot>,
  executionBackendConfigure: (input: ConfigureExecutionBackendInput) =>
    ipcRenderer.invoke("stella:execution-backends:configure", input) as Promise<ExecutionBackendCatalogSnapshot>,
  executionBackendRetry: (backendId: ExecutionBackendId) =>
    ipcRenderer.invoke("stella:execution-backends:retry", backendId) as Promise<ExecutionBackendCatalogSnapshot>,
  companionGatewayStatus: () =>
    ipcRenderer.invoke("stella:companion:status") as ReturnType<StellaDesktopApi["companionGatewayStatus"]>,
  companionCreatePairingOffer: () =>
    ipcRenderer.invoke("stella:companion:create-pairing-offer") as ReturnType<StellaDesktopApi["companionCreatePairingOffer"]>,
  companionRevokeDevice: (deviceId: string) =>
    ipcRenderer.invoke("stella:companion:revoke-device", deviceId) as ReturnType<StellaDesktopApi["companionRevokeDevice"]>,
  externalExecutionsRefresh: (scope: ExternalExecutionScope) =>
    ipcRenderer.invoke("stella:external-executions:refresh", scope) as ReturnType<StellaDesktopApi["externalExecutionsRefresh"]>,
  externalExecutionImport: (input: ImportExternalExecutionInput) =>
    ipcRenderer.invoke("stella:external-executions:import", input) as ReturnType<StellaDesktopApi["externalExecutionImport"]>,
  externalExecutionContinue: (input: ContinueExternalExecutionInput) =>
    ipcRenderer.invoke("stella:external-executions:continue", input) as ReturnType<StellaDesktopApi["externalExecutionContinue"]>,
  externalExecutionDetails: (input: ReadExternalExecutionDetailsInput) =>
    ipcRenderer.invoke("stella:external-executions:details", input) as ReturnType<StellaDesktopApi["externalExecutionDetails"]>,
  initialize: () => ipcRenderer.invoke("stella:initialize") as Promise<RuntimeBootstrap>,
  command: (command: PiCommand) => ipcRenderer.invoke("stella:command", command),
  refresh: () => ipcRenderer.invoke("stella:refresh") as Promise<RuntimeBootstrap>,
  respondToExtension: (response: PiExtensionResponse) =>
    ipcRenderer.invoke("stella:extension-response", response) as Promise<void>,
  chooseProject: () => ipcRenderer.invoke("stella:choose-project") as Promise<ProjectSelection | null>,
  skinArtworkInitialize: () =>
    ipcRenderer.invoke("stella:skin-artwork:initialize") as Promise<readonly SkinArtworkDescriptor[]>,
  chooseSkinArtwork: (skin: SkinId) =>
    ipcRenderer.invoke("stella:skin-artwork:choose", skin) as Promise<SkinArtworkDescriptor | null>,
  resetSkinArtwork: (skin: SkinId) =>
    ipcRenderer.invoke("stella:skin-artwork:reset", skin) as Promise<void>,
  openProject: (path: string, trusted: boolean) =>
    ipcRenderer.invoke("stella:open-project", path, trusted) as Promise<RuntimeBootstrap | null>,
  inspectLocalPath: (path: string) =>
    ipcRenderer.invoke("stella:local-path:inspect", path) as ReturnType<StellaDesktopApi["inspectLocalPath"]>,
  readLocalFilePreview: (path: string) =>
    ipcRenderer.invoke("stella:local-file:preview", path) as ReturnType<StellaDesktopApi["readLocalFilePreview"]>,
  openPath: (path: string) => ipcRenderer.invoke("stella:open-path", path) as Promise<void>,
  revealPath: (path: string) => ipcRenderer.invoke("stella:reveal-path", path) as Promise<void>,
  openExternal: (url: string) => ipcRenderer.invoke("stella:open-external", url) as Promise<void>,
  copyText: (value: string) => ipcRenderer.invoke("stella:copy-text", value) as Promise<void>,
  composerDraftLoad: (key: string) =>
    ipcRenderer.invoke("stella:composer-draft:load", key) as Promise<ComposerDraftSnapshot | undefined>,
  composerDraftSave: (input: SaveComposerDraftInput) =>
    ipcRenderer.invoke("stella:composer-draft:save", input) as Promise<void>,
  installPiSkillFolder: (scope: PiSkillInstallScope) =>
    ipcRenderer.invoke("stella:skills:install-folder", scope) as Promise<PiSkillInstallResult>,
  modelConfigurationInitialize: () =>
    ipcRenderer.invoke("stella:model-configuration:initialize") as Promise<PiModelConfigurationSnapshot>,
  modelConfigurationRevealApiKey: (providerId: string) =>
    ipcRenderer.invoke("stella:model-configuration:reveal-api-key", providerId) as Promise<PiApiKeyRevealResult>,
  modelConfigurationTestConnection: (input: TestPiModelConnectionInput) =>
    ipcRenderer.invoke("stella:model-configuration:test-connection", input) as Promise<PiModelConnectionTestResult>,
  modelConfigurationDiscoverModels: (input: DiscoverPiModelsInput) =>
    ipcRenderer.invoke("stella:model-configuration:discover-models", input) as Promise<PiModelDiscoveryResult>,
  modelConfigurationSaveApiKey: (input: SavePiApiKeyInput) =>
    ipcRenderer.invoke("stella:model-configuration:save-api-key", input) as Promise<PiModelConfigurationSnapshot>,
  modelConfigurationDeleteCredential: (providerId: string) =>
    ipcRenderer.invoke("stella:model-configuration:delete-credential", providerId) as Promise<PiModelConfigurationSnapshot>,
  modelConfigurationUpsertProvider: (input: PiModelConfigurationProviderInput) =>
    ipcRenderer.invoke("stella:model-configuration:upsert-provider", input) as Promise<PiModelConfigurationSnapshot>,
  modelConfigurationSaveProviderSetup: (input: SavePiProviderSetupInput) =>
    ipcRenderer.invoke("stella:model-configuration:save-provider-setup", input) as Promise<PiModelConfigurationSnapshot>,
  modelConfigurationDeleteProvider: (providerId: string) =>
    ipcRenderer.invoke("stella:model-configuration:delete-provider", providerId) as Promise<PiModelConfigurationSnapshot>,
  boardInitialize: () => ipcRenderer.invoke("stella:board:initialize") as Promise<BoardBootstrap>,
  boardCreateTask: (input: CreateTaskInput) =>
    ipcRenderer.invoke("stella:board:create-task", input) as Promise<BoardBootstrap>,
  boardLaunchTeamTask: (input: LaunchTeamTaskInput) =>
    ipcRenderer.invoke("stella:board:launch-team-task", input) as Promise<BoardBootstrap>,
  boardUpdateTask: (input: UpdateTaskInput) =>
    ipcRenderer.invoke("stella:board:update-task", input) as Promise<BoardBootstrap>,
  boardMoveTask: (taskId: string, stage: ManualTaskStage) =>
    ipcRenderer.invoke("stella:board:move-task", taskId, stage) as Promise<BoardBootstrap>,
  boardDeleteTask: (taskId: string) =>
    ipcRenderer.invoke("stella:board:delete-task", taskId) as Promise<BoardBootstrap>,
  boardAddComment: (input: CreateTaskCommentInput) =>
    ipcRenderer.invoke("stella:board:add-comment", input) as Promise<BoardBootstrap>,
  boardCreateAgent: (input: CreateProjectAgentInput) =>
    ipcRenderer.invoke("stella:board:create-agent", input) as Promise<BoardBootstrap>,
  boardUpdateAgent: (input: UpdateProjectAgentInput) =>
    ipcRenderer.invoke("stella:board:update-agent", input) as Promise<BoardBootstrap>,
  boardDeleteAgent: (agentId: string) =>
    ipcRenderer.invoke("stella:board:delete-agent", agentId) as Promise<BoardBootstrap>,
  boardCreateSquad: (input: CreateSquadInput) =>
    ipcRenderer.invoke("stella:board:create-squad", input) as Promise<BoardBootstrap>,
  boardUpdateSquad: (input: UpdateSquadInput) =>
    ipcRenderer.invoke("stella:board:update-squad", input) as Promise<BoardBootstrap>,
  boardDeleteSquad: (squadId: string) =>
    ipcRenderer.invoke("stella:board:delete-squad", squadId) as Promise<BoardBootstrap>,
  boardCreateAutopilot: (input: CreateAutopilotInput) =>
    ipcRenderer.invoke("stella:board:create-autopilot", input) as Promise<BoardBootstrap>,
  boardUpdateAutopilot: (input: UpdateAutopilotInput) =>
    ipcRenderer.invoke("stella:board:update-autopilot", input) as Promise<BoardBootstrap>,
  boardDeleteAutopilot: (autopilotId: string) =>
    ipcRenderer.invoke("stella:board:delete-autopilot", autopilotId) as Promise<BoardBootstrap>,
  boardTriggerAutopilot: (autopilotId: string) =>
    ipcRenderer.invoke("stella:board:trigger-autopilot", autopilotId) as Promise<BoardBootstrap>,
  boardDispatchTask: (taskId: string) =>
    ipcRenderer.invoke("stella:board:dispatch-task", taskId) as Promise<BoardBootstrap>,
  boardResolveGate: (input: ResolveGateInput) =>
    ipcRenderer.invoke("stella:board:resolve-gate", input) as Promise<BoardBootstrap>,
  boardReviewExecution: (input: ReviewExecutionInput) =>
    ipcRenderer.invoke("stella:board:review-execution", input) as Promise<BoardBootstrap>,
  boardAbortTask: (taskId: string) =>
    ipcRenderer.invoke("stella:board:abort-task", taskId) as Promise<BoardBootstrap>,
  openTaskSession: (input: OpenTaskSessionInput) =>
    ipcRenderer.invoke("stella:board:open-session", input) as Promise<RuntimeBootstrap>,
  windowAction: (action: "minimize" | "maximize" | "close") =>
    ipcRenderer.invoke("stella:window-action", action) as Promise<void>,
  onEvent: (listener: (event: BridgeEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: BridgeEvent) => listener(value);
    ipcRenderer.on("stella:event", handler);
    return () => ipcRenderer.removeListener("stella:event", handler);
  },
});

contextBridge.exposeInMainWorld("stella", api);
