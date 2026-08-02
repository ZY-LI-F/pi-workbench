# Stella Pi Workbench

**English** | [简体中文](README.zh-CN.md)

> **A native Pi desktop workbench with an optional local Agent team control plane.** Use real Pi conversations, model routing, artifact previews, Kanban tasks, structured multi-Agent delegation, execution graphs, human approval, and local automation in one installable application.

Stella is a local-first Electron workbench for [earendil-works/pi](https://github.com/earendil-works/pi). It launches the bundled Pi JSONL RPC runtime directly: it does not simulate Agent responses and does not bypass Pi's sessions, models, Skills, extensions, or user configuration. The native Pi workbench remains independently usable, while Team, Kanban, Workflow, and Autopilot form an optional second capability surface with a separate failure boundary.

This is no longer a "Pi skin" project. Eight replaceable visual themes remain part of the desktop experience, but the product itself is an installable, auditable, and recoverable local AI workbench. Stella does not reproduce the server stacks of Multica or AgentTeams/HiClaw; it applies their Issue/Attempt, Room/Leader/Worker, explicit-trigger, dependency-scheduling, and result-acceptance ideas within a deliberately small single-machine architecture.

## Product Positioning

| Surface | What users get | Architectural boundary |
| --- | --- | --- |
| **Native Pi workbench** | Chat, session tree, model and Provider configuration, thinking level, extensions, Skills, terminal, attachments, and local artifact previews | Uses the real Pi RPC runtime directly; no Task or Team setup is required |
| **Agent team control plane** | Task Launchpad, Task Room, Kanban, LEAD/Worker delegation, Squads, Workflow DAGs, execution graphs, human acceptance, and Autopilot | Stella owns deterministic state, scheduling, and audit; every Agent still runs through an isolated Pi runtime |
| **Desktop experience** | Windows/macOS installers, globally visible model selection, responsive three-column layouts, eight themes, and replaceable artwork | Presentation never enters the domain model or changes execution semantics |

Team features are hidden by default and can be enabled under **Preferences → Feature Pages**. Disabling the surface hides its navigation without deleting existing tasks. Data remains local, credentials stay in Pi's standard configuration directory, and the application does not require PostgreSQL, Redis, a remote control plane, or a resident daemon.

![Stella Team Workspace with task channels, Task Room, and Agent Pulse](docs/team-chat-stella.png)

The current Team design is documented in the fixed-commit upstream study [`docs/research/team-multica-hiclaw-2026-08.md`](docs/research/team-multica-hiclaw-2026-08.md), the implemented reliability specification [`docs/specs/stella-team-reliability-v1.md`](docs/specs/stella-team-reliability-v1.md), [ADR 0005](docs/adr/0005-dependency-aware-agent-task-scheduling.md), and [ADR 0006](docs/adr/0006-use-one-typed-coordinator-protocol-for-team-leaders.md).

## Pi Model Routing and Provider Configuration

The **Model Configuration** page is a direct Pi model router. It does not maintain a second model database and does not require the user to enter the chat page first. It reads the bundled Pi Provider catalog, Pi's `get_available_models` result, and the recipient's standard Pi configuration directory.

- **One global model signal:** every page displays the same `Provider → Model → Context → Session / Team / Kanban` route. Only models actually returned by Pi can be selected. An Agent's explicit model override still takes precedence.
- **Provider status:** local credential discovery, remote connectivity, and saved configuration are shown as separate facts. Finding a Key never masquerades as a successful remote request.
- **API Key viewing and management:** initialization and refresh snapshots never contain secrets. A Key is returned through a narrow main-process IPC only after an explicit button click, and is cleared when hidden, when the Provider changes, after saving, or after 30 seconds. OAuth access tokens are not displayed. Dynamic `!command` credentials may be used for connection tests but are never executed by the view action.
- **Real connection tests:** users can select a model and send an isolated minimal request. The result shows success or failure, the actual Provider/model, latency, and test time. Tests do not enter chat history, change the global model, or restart the active Pi RPC session. A test may consume a very small number of billable tokens.
- **Model discovery from URL and Key:** OpenAI/Responses `data[]`, Anthropic-compatible catalogs, and paginated Gemini `models[]` responses are supported. Results can be searched, added, or removed before saving. A successful catalog request is not presented as proof that inference works; the real connection test remains separate.
- **Custom endpoints:** constrained forms support `openai-completions`, `openai-responses`, `anthropic-messages`, and `google-generative-ai`, including Base URL, bearer headers, model ID, context, output limit, reasoning, and image-input capabilities. Existing advanced fields are preserved.
- **Explicit apply semantics:** saving reloads the real Pi RPC runtime and restores the same `sessionFile`. “Saved,” “locally configured,” and “remotely verified” are independent states. OAuth and subscription login continue to use Pi's interactive `/login <provider>` flow.

![Stella Pi model configuration and Provider router](docs/model-configuration-stella.png)

## Session Artifact Preview

When Pi returns an absolute local path, the output card offers **Preview**. The file opens in a read-only inspector on the right without replacing the chat composer. All Assistant-delivered paths in the current session are deduplicated and sorted by their most recent mention; switching sessions closes the previous session's preview list.

Supported formats:

- Images: PNG, JPEG, GIF, WebP, AVIF, BMP, and sanitized SVG.
- Web and text: HTML, Markdown, JSON, CSV, TSV, XML, YAML, and plain text. HTML runs in a script-free sandbox with forms, network requests, external assets, and embedded objects isolated.
- PDF: rendered by Electron/Chromium's local PDF viewer without an Office plugin.
- Word: DOCX is rendered page by page with `docx-preview`, including text, tables, and common styles.
- PowerPoint: PPTX is converted to isolated HTML slides with `@jvmr/pptx-to-html`; animations, macros, and embedded programs are not executed.
- Excel: XLSX/XLSM is rendered with `@office-kit/xlsx`, including worksheets, merged cells, row/column sizing, hidden rows/columns, and common cell styles. Macros are not executed.

Legacy binary DOC/PPT/XLS files are not falsely reported as previewable and can still be opened with a system application. Office parsers are dynamically imported, so ordinary chat startup does not load them. Before every preview, the main process revalidates the canonical path and only reads ordinary files inside the current project, Pi data directory, or Stella application-data directory. Files are never uploaded.

The preview toolbar provides zoom, refresh, fit, system open for safe types, reveal in folder, and copy-path actions.

## A Small, Explicit Architecture

Stella keeps the native Pi workbench and Task Control as two first-class capability surfaces. It does not duplicate Pi or add a second Agent runtime.

- **Independent capability health:** Pi, Task, Schedule, and Webhook independently report `loading / ready / degraded / error`. A damaged Board cannot block Pi chat, and a Webhook port conflict only stops Webhook.
- **Deterministic Task lifecycle:** persisted Stella events move tasks through `planned / queued / running / review / blocked / completed`. Model prose cannot move cards.
- **Immutable execution identity:** every dispatch increments `executionAttempt` and snapshots the current Task specification. Stale runtimes cannot overwrite a newer execution or specification revision.
- **Explicit result acceptance:** a successful Agent or Workflow result becomes `reported + pending acceptance`. Only an explicit user acceptance completes the task.
- **Frozen plans:** Agent, Squad, and Workflow definitions are snapshotted at dispatch. Editing a catalog entry affects the next run, not history.
- **Shared workspace admission:** interactive Pi, Workflow, and AgentTask writers share a canonical-path write lease. Background writers wait FIFO; users can see the current owner and cancel queued work.
- **Live trust resolution:** every background execution re-reads the project's current trust before starting Pi. A stale Task snapshot never grants permissions.
- **Explicit Pi↔Task bridge:** a Pi session becomes a Task only through the visible “Save as Task” draft. A Task session returns to Pi only after the selected `sessionFile` is validated against that Task.
- **One durable conversation:** Task Room is a projection of Task, Message, Activity, Workflow Run, Step Run, AgentTask, and Artifact facts. Team Chat does not create a second message database.
- **One execution engine:** Workflow DAG and Agent execution graph are read-only projections of persisted runtime facts; selecting a node never changes execution state.

## Team Workspace and Task Launchpad

The permanent Task Launchpad does not require users to create a Kanban card first. Type `@` to inspect every Agent currently available to the project, then select exactly one owner:

- Use `@LEAD` for complex, cross-role, or insufficiently decomposed work.
- Use a specific `@Worker` when the objective, owner, and acceptance criteria are already clear.

Stella atomically creates the Task, the first user Message, and the first AgentTask, then opens the new Task Room. `@LEAD` creates a Coordinator root; a Worker mention creates a direct AgentTask. Validation failures leave no orphan Task or partial message.

![Task Launchpad with LEAD and Worker selection](docs/team-launch-room-stella.png)

The channel list provides three derived views:

- All
- Needs me
- Running

“Needs me” is derived from blocked tasks, a Coordinator waiting for the user, Workflow human gates, and execution reports awaiting acceptance. It is not a separately persisted inbox.

### Dependency-aware AgentTask scheduling

Queued AgentTasks are classified as ready, dependency-blocked, or structurally invalid. A child is runnable only when it belongs to the Task's current active root and its parent is waiting for children. A Coordinator review waits for every same-round Worker to reach a terminal state.

The single local Runner uses a starvation-free score:

```text
effectivePriority = priorityWeight + floor(waitingMs / 15 minutes)
order = effectivePriority DESC, createdAt ASC, durableInsertionIndex ASC
```

Priority weights are `low=0`, `medium=1`, `high=2`, and `urgent=3`. Aging is unbounded, so low-priority work cannot be starved indefinitely. Durable array order is the final tie-breaker; random UUID ordering has no execution meaning. Claiming recomputes the queue inside the repository transaction.

### Typed LEAD and Squad coordination

LEAD and Squad Leader share the terminating `coordinator_action` protocol:

- `delegate`
- `request_revision`
- `replan`
- `complete`
- `ask_human`

Only validated tool details can create Worker tasks or change control state. Natural-language prose, Markdown JSON, handwritten JSON, and textual `@mentions` have no control authority.

Every delegation, revision, or replan creates a monotonic `delegationRound`. A failed Worker records its original error without cancelling its siblings. When all Workers in the round terminate, the Leader receives both successful and failed reports and explicitly decides whether to revise, replan, ask the user, or complete. Coordinator protocol failures remain visible and block the root; there is no silent natural-language fallback.

At startup, Stella repairs a missing Coordinator review when all members of the latest round are already terminal. It does not run periodic model-based “health checks.”

### Agent execution graph

Task Room renders the current persisted Agent execution tree:

- Coordinator or direct root
- Delegation rounds
- Worker nodes
- Leader review nodes
- Runtime status
- Queue position
- Dependency reason
- Original failure

The graph is a read-only projection of `parentAgentTaskId`, `delegationRound`, status, and queue facts.

![Task Room, Workflow DAG, and mention impact preview](docs/task-room-stella.png)

## Kanban, Fixed Agents, and Workflow DAGs

The Kanban board is a durable process controller, not a card-shaped chat transcript. Stella owns recoverable state, while isolated Pi RPC sessions execute individual steps and write tool activity, output, failures, usage, and artifacts back to the same Task Room.

Built-in general-purpose roles include:

| Agent | Access | Responsibility |
| --- | --- | --- |
| **LEAD / General Coordinator** | Read-only | Clarify, decompose, delegate, review, revise, replan, or ask the user |
| **SCOUT / Project Scout** | Read-only | Inspect code, constraints, impact, and verification entry points |
| **PLAN / Solution Planner** | Read-only | Turn facts into an executable plan |
| **BUILD / Implementation Engineer** | Write | Modify the real project according to an approved plan |
| **VERIFY / Verification Engineer** | Write | Run tests, type checks, builds, and expose failures |
| **REVIEW / Code Reviewer** | Read-only | Independently review correctness, regressions, security, and acceptance criteria |

Built-in workflows include feature delivery, defect repair, and read-only review. Human gates, branch/join DAG nodes, version snapshots, isolated sessions, artifacts, token/cost statistics, cancellation, restart interruption, and final acceptance are persisted and visible.

## Early Drug Discovery Example

The repository includes a reproducible NLRP3 early-research scenario under [`examples/pharma-early-research`](examples/pharma-early-research). It evaluates whether to initiate a discovery program for an oral, brain-penetrant, selective NLRP3 inhibitor in an inflammation-enriched early Parkinson's disease population.

Project-local Skills are bundled under [`examples/pharma-early-research/.pi/skills`](examples/pharma-early-research/.pi/skills):

- `target-evidence`: Open Targets, Human Protein Atlas, and ChEMBL evidence.
- `clinical-landscape`: ClinicalTrials.gov asset and status analysis.
- `target-assessment-report`: a fixed decision scorecard and independent evidence audit.

The workflow uses target biology, clinical competitor, strategy, and evidence-audit Agents. Required Skills are checked by Pi's real Resource Loader before execution and again inside the runtime. Missing, disabled, or untrusted Skills fail explicitly; Stella does not generate a template report as a fake success.

```bash
# Deterministic UI and orchestration test; no model request
npm run test:e2e:pharma

# Real Agents, official data sources, human gates, report, and audit
npm run test:e2e:pharma:live
```

See [`examples/pharma-early-research/TEST_PLAN.md`](examples/pharma-early-research/TEST_PLAN.md) for input, failure paths, and acceptance criteria.

## Autopilot

Autopilot binds a Task template, project, and execution target to one of three explicit triggers:

- Manual
- Schedule while the Stella application is running
- Loopback Webhook bound to `127.0.0.1`

Every trigger creates a fresh Task and audit record before entering the same real dispatch path. Schedule downtime is recorded as `missed` and advanced to the next future occurrence; Stella never claims to have run while the desktop application was closed.

The default Webhook port is `43127`. Successful requests return HTTP `202` with real `autopilotId`, `runId`, and `taskId` values. Invalid routes, methods, tokens, content types, UTF-8, JSON, or oversized payloads return structured errors.

```bash
curl -X POST "http://127.0.0.1:43127/api/webhooks/<token>" \
  -H "Content-Type: application/json" \
  -d '{"ref":"refs/heads/main","action":"verify"}'
```

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `STELLA_WEBHOOK_PORT` | `43127` | Fixed loopback port, `1..65535` |
| `STELLA_WEBHOOK_MAX_BYTES` | `1048576` | Maximum JSON body size; set to `0` to explicitly remove the limit |

## Visual Themes

Themes change artwork, design tokens, materials, borders, geometry, empty states, suggestions, and the composer while preserving the same information architecture.

| Theme | Visual direction |
| --- | --- |
| **Stella · Night Navigation** | Iris star trails, soft glass, warm handwritten signature |
| **晨曦 · First Light on Paper** | Matte paper, layered mist, apricot dawn |
| **定阳 · Sundial Cartography** | Mineral engraving, solar scales, geometric order |
| **旭日 · Sunrise at Sea** | Vermilion sun, mineral mountains and sea, restrained gold foil |
| **月华 · Silver-blue Moon Lake** | Moon path, clouds, ice-crystal florals |
| **黑曜夜契 · Obsidian Night Pact** | Victorian silver, rainy manor, dark-red roses |
| **绮旅黄金 · Golden Journey** | Pink-purple streets, Italian gold, chromatic comic contrast |
| **棋境 · Moonlit Go Board** | Black and white stones, ginkgo ink mist, aged board |

![Chenxi theme](docs/chenxi-home.png)

![Dingyang theme](docs/dingyang-home.png)

Theme artwork is original, AI-assisted project material. Open-source projects were used only for design research; their images and runtime code are not redistributed. See [`ASSET-LICENSES.md`](ASSET-LICENSES.md) for file-level provenance and compatibility IDs.

## Development

Requirements:

- Node.js `>= 22.19.0`
- npm

Pi models, authentication, extensions, Skills, sessions, and user settings remain in Pi's standard user directory. Stella's model configuration page writes Pi's native `auth.json` and `models.json`; it does not create a second credential store.

```bash
npm install
npm run dev
```

Production build and preview:

```bash
npm run build
npm run preview
```

## Windows and macOS Installers

Installers bundle `@earendil-works/pi-coding-agent` and its production dependencies. The Electron main process uses Electron's Node runtime to launch the bundled RPC entry, so recipients do not need a global `pi` command or a particular Pi installation path.

Recipient configuration is still read from Pi's standard directory:

- Windows: `%USERPROFILE%\.pi\agent`
- macOS: `~/.pi/agent`
- Override: `PI_CODING_AGENT_DIR`

Do not package a developer's API Keys, OAuth credentials, or `.pi/agent` directory. A recipient without a separate Pi CLI can launch Stella, but must configure their own Provider credentials before the first model request.

Board state is stored under Electron user data as `board/board.json`, outside the opened repository. Schema migration creates a timestamped backup and follows the deterministic v1→v6 chain. Built-in roles never hardcode an API Key, model, or machine-specific Pi path.

### Local packaging

```bash
# Unpacked directory for the current operating system
npm run package:dir
npm run test:packaged

# Windows x64 NSIS
npm run dist:win

# Windows ARM64 NSIS
npm run dist:win:arm64

# Intel Mac DMG + ZIP
npm run dist:mac:x64

# Apple Silicon Mac DMG + ZIP
npm run dist:mac:arm64
```

Artifacts are written to `release/` and include version, OS, and architecture in the file name:

```text
Stella Pi Workbench-0.3.0-win-x64.exe
Stella Pi Workbench-0.3.0-mac-x64.dmg
Stella Pi Workbench-0.3.0-mac-arm64.dmg
```

Formal macOS signing must run on macOS. The repository includes [a GitHub Actions release workflow](.github/workflows/release.yml) for Windows x64, macOS Apple Silicon, and macOS Intel. Manual workflow runs may produce explicitly unsigned internal-test artifacts. A matching version tag requires signing, Apple notarization for macOS, and successful builds on every platform before creating the GitHub Release.

## Verification

```bash
npm run check
npm run build
npm run test:e2e
npm run test:packaged
```

The current deterministic suite contains **70 Vitest files and 290 tests**. It covers Team feature gating, schema migrations and backups, specification/execution-attempt isolation, live trust, typed Coordinator tools, Skill preflight, frozen plans, delegation rounds, Worker failure recovery, dependency-aware fair scheduling, stale-queue isolation, Presence and human-attention projections, execution graphs, RPC timeout shutdown, capability isolation, workspace leases, explicit result acceptance, Task Room projection, Pi session bridging, Workflow DAGs, Autopilot, Webhook, extension UI, font scaling, terminal cancellation, composer behavior, multi-file session previews, preview IPC, and a real ten-slide PPTX relationship-path regression.

Electron E2E launches the real bundled Pi RPC runtime and covers the default native workbench, Team feature persistence, global model visibility, LEAD/Worker Task Launchpad selection, Task Room, mention impact previews, Pi-to-Task drafts, Kanban drag and drop, orchestration catalog, Autopilot, themes, sessions, terminal behavior, attachments, artifact previews, keyboard focus, and responsive sidebars.

Aliyun Bailian/Qwen live inference is intentionally excluded from the default suite because it uses network access and billable tokens:

```bash
npm run test:e2e:qwen:live
```

It requires an `aliyun-maas` Provider and a configured Qwen model. Missing configuration, authentication failure, timeout, or unexpected output fails explicitly; the test never silently switches models.

## Project Structure

```text
src/
├─ main/                 Electron main process, capability health, admission, runners, and Pi RPC lifecycle
├─ preload/              Narrow contextBridge API
├─ renderer/src/
│  ├─ components/        Sessions, composer, inspector, terminal, dialogs, and navigation
│  ├─ features/kanban/   Kanban, Task Room, Workflow DAG, Agent execution graph, Pi bridge, and Autopilot
│  ├─ features/team/     Task Launchpad, channels, Agent Pulse, and attention projections
│  ├─ hooks/             Pi/Board state synchronization and local preferences
│  ├─ assets/skins/      Original replaceable theme artwork
│  ├─ lib/               Immutable runtime reducers and theme definitions
│  └─ styles/            Design tokens, layouts, themes, and responsive behavior
└─ shared/               Protocols, v6 domain model, scheduling, attention/presence/timeline/DAG projections, and catalog
```

The main process launches Pi with Electron's Node runtime and `ELECTRON_RUN_AS_NODE=1`. The renderer uses `contextIsolation` and sandboxing and only reaches local capabilities through the preload allowlist. External links are restricted to HTTP(S), and paths and IPC commands are validated in the main process.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + N` | Focus Team Launchpad, create a structured Kanban Task, or create a new Pi session depending on the active page |
| `Ctrl/Cmd + K` | Search and command palette |
| `Ctrl/Cmd + L` | Focus the active composer |
| <code>Ctrl/Cmd + `</code> | Toggle the local terminal drawer |
| `Ctrl/Cmd + I` | Toggle the session inspector |
| `Esc` | Stop generation or close the active dialog |

## Project Trust

When a directory contains project-level `.pi` settings, extensions, Skills, prompts, or themes, Stella asks the user to choose explicitly:

- **Trust and load:** starts Pi in approved mode and loads project resources.
- **Restricted open:** starts Pi without project approval and ignores project-level executable resources.

The choice is stored with recent-project metadata in Electron user data and is never written into the opened repository.

## License and Assets

Source code is licensed under the [MIT License](LICENSE). See [ASSET-LICENSES.md](ASSET-LICENSES.md) for original theme artwork, screenshots, compatibility IDs, and third-party boundaries. Pi, fonts, icons, and npm packages remain subject to their respective upstream licenses.
