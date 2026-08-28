export type MockHostConnection = "online" | "reconnecting" | "offline";
export type MockAgentState = "working" | "needs-input" | "completed" | "failed";

export interface MockTask {
  readonly id: string;
  readonly title: string;
  readonly project: string;
  readonly agent: string;
  readonly state: MockAgentState;
  readonly summary: string;
  readonly updatedAt: string;
}

export interface MockCompanionSnapshot {
  readonly sequence: number;
  readonly capturedAt: string;
  readonly connection: MockHostConnection;
  readonly stale: boolean;
  readonly hostName: string;
  readonly tasks: readonly MockTask[];
}

export const MOCK_SCENARIOS = ["working", "needs-input", "completed", "failed", "offline"] as const;
export type MockScenario = (typeof MOCK_SCENARIOS)[number];

const COPY: Readonly<Record<MockAgentState, { readonly title: string; readonly summary: string; readonly agent: string }>> = Object.freeze({
  working: { title: "实现 Android Companion", summary: "正在构建移动端状态卡片", agent: "Builder" },
  "needs-input": { title: "确认工作区策略", summary: "需要选择保留或清理执行工作区", agent: "Coordinator" },
  completed: { title: "统一 Agent 状态投影", summary: "全部验收项已通过", agent: "Reviewer" },
  failed: { title: "运行跨 Provider 测试", summary: "Codex Adapter 返回非零退出码", agent: "Tester" },
});

export function mockSnapshot(scenario: MockScenario, sequence = 1, capturedAt = new Date().toISOString()): MockCompanionSnapshot {
  const offline = scenario === "offline";
  const states: readonly MockAgentState[] = offline
    ? ["needs-input", "working"]
    : scenario === "working"
      ? ["working", "completed"]
      : [scenario, "working"];
  return Object.freeze({
    sequence,
    capturedAt,
    connection: offline ? "offline" : "online",
    stale: offline,
    hostName: "Stella · MacBook Pro",
    tasks: Object.freeze(states.map((state, index) => Object.freeze({
      id: `mock-${state}-${index}`,
      title: COPY[state].title,
      project: index === 0 ? "pi-workbench" : "research-lab",
      agent: COPY[state].agent,
      state,
      summary: COPY[state].summary,
      updatedAt: capturedAt,
    }))),
  });
}

export interface MockCompanionHost {
  snapshot(): MockCompanionSnapshot;
  select(scenario: MockScenario): void;
  subscribe(listener: (snapshot: MockCompanionSnapshot) => void): () => void;
  start(intervalMs?: number): () => void;
}

export function createMockCompanionHost(initial: MockScenario = "working"): MockCompanionHost {
  let scenario = initial;
  let sequence = 0;
  let current = mockSnapshot(scenario, ++sequence);
  const listeners = new Set<(snapshot: MockCompanionSnapshot) => void>();
  const publish = () => {
    current = mockSnapshot(scenario, ++sequence);
    for (const listener of listeners) listener(current);
  };
  return Object.freeze({
    snapshot: () => current,
    select: (next: MockScenario) => { scenario = next; publish(); },
    subscribe: (listener: (snapshot: MockCompanionSnapshot) => void) => {
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
    start: (intervalMs = 6_000) => {
      let index = MOCK_SCENARIOS.indexOf(scenario);
      const timer = window.setInterval(() => {
        index = (index + 1) % MOCK_SCENARIOS.length;
        scenario = MOCK_SCENARIOS[index] ?? "working";
        publish();
      }, intervalMs);
      return () => window.clearInterval(timer);
    },
  });
}
