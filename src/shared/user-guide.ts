export interface UserGuideTopic {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly image: string;
  readonly imageAlt: string;
  readonly steps: readonly string[];
  readonly tip: string;
}

const illustrations = {
  projects: new URL("./user-guide-assets/projects.svg", import.meta.url).href,
  tasks: new URL("./user-guide-assets/tasks.svg", import.meta.url).href,
  scroll: new URL("./user-guide-assets/scroll.svg", import.meta.url).href,
  chat: new URL("./user-guide-assets/chat.svg", import.meta.url).href,
  review: new URL("./user-guide-assets/review.svg", import.meta.url).href,
  pairing: new URL("./user-guide-assets/pairing.svg", import.meta.url).href,
  activity: new URL("./user-guide-assets/activity.svg", import.meta.url).href,
  offline: new URL("./user-guide-assets/offline.svg", import.meta.url).href,
} as const;

export const DESKTOP_GUIDE: readonly UserGuideTopic[] = [
  {
    id: "projects", title: "整理项目", summary: "把长期项目放在一张看板里，随时了解进度。",
    image: illustrations.projects, imageAlt: "项目按待安排、进行中、已收尾分列，卡片可以调整阶段",
    steps: ["进入「任务栏 → 项目看板」，点「添加项目」选择已有目录。", "填写名称和说明；拖动卡片或使用阶段菜单整理计划。", "点开项目查看任务进度，再点「查看任务看板」处理具体任务。"],
    tip: "项目的「暂缓」「已收尾」是计划标记。任务执行和结果验收仍按各自状态推进。",
  },
  {
    id: "tasks", title: "不选项目也能记任务", summary: "先记下要做的事，确定工作目录后再绑定。",
    image: illustrations.tasks, imageAlt: "创建任务时选择不选择项目，后续可以绑定到实际工作区",
    steps: ["进入「任务看板」，点「新建任务」或按 Ctrl+N。", "在「任务所属项目」选择「不选择项目」，填写目标后创建。", "点开任务记录进展、手工移动阶段；需要自动执行时，打开工作区后点「绑定到…」。"],
    tip: "已打开项目时也可以不选项目。绑定会保留原任务、评论和阶段。",
  },
  {
    id: "scroll", title: "找到更多任务", summary: "任务多时滚动列表，用范围和搜索快速定位。",
    image: illustrations.scroll, imageAlt: "任务列内可以上下滚动，看板底部可以横向滚动到其他列",
    steps: ["把鼠标移到某个任务列中，滚轮上下查看这一列的任务。", "窗口较窄时，拖动看板底部的横向滚动条查看右侧阶段。", "用项目筛选或搜索缩小范围；项目详情的任务列表也可以单独滚动。"],
    tip: "「全部任务」跨项目显示，「未归属项目」只显示还没有绑定目录的任务。",
  },
  {
    id: "chat", title: "与 Pi 工作", summary: "在项目中提问、处理文件，再检查实际产物。",
    image: illustrations.chat, imageAlt: "在 Pi 会话发送需求，从回复中的文件入口打开预览",
    steps: ["在「模型配置」添加 Provider 和模型，完成连接测试。", "打开实际项目，在「PI 原生工作台」输入需求并发送。", "点击回复里的文件「预览」检查产物；Ctrl+K 可以搜索常用操作。"],
    tip: "切换会话会保存各自草稿。项目资源需要启用时，通过原有信任提示决定是否加载。",
  },
  {
    id: "review", title: "执行与验收", summary: "把工作交给执行环境，查看结果后再决定是否接受。",
    image: illustrations.review, imageAlt: "任务从执行到报告待验收，经检查后接受结果",
    steps: ["需要团队或自动化入口时，在设置开启「显示团队功能」，检查执行环境是否可用。", "为已绑定项目的任务选择执行方式，补充验收标准后分发。", "从项目的「需处理」或任务详情查看当前报告，再接受结果、要求修改或处理人工关卡。"],
    tip: "执行结束和验收通过是两个步骤。请根据报告与实际产物判断。",
  },
  {
    id: "pairing", title: "连接 Android", summary: "电脑执行工作，手机查看动态和处理待办。",
    image: illustrations.pairing, imageAlt: "电脑生成配对码，Android 扫描后连接到这台电脑",
    steps: ["让电脑和手机处于可互通的局域网，或已配置好的 Tailscale 私网。", "在电脑「偏好设置 → Android Companion」点「生成配对码」。", "打开 Android Companion 扫码，也可以粘贴配对链接；每台电脑分别配对。"],
    tip: "电脑上的 Stella 需要保持运行。配对码过期后可在电脑端重新生成。",
  },
];

export const ANDROID_GUIDE: readonly UserGuideTopic[] = [
  {
    id: "pairing", title: "连接你的电脑", summary: "配对一次，就能在手机上查看这台电脑的工作。",
    image: illustrations.pairing, imageAlt: "电脑生成配对码，Android 扫描后建立连接",
    steps: ["保持电脑上的 Stella 运行，让两端处于同一局域网或可互通的 Tailscale 私网。", "电脑进入「偏好设置 → Android Companion」，生成配对码。", "手机点「扫码配对」或粘贴链接。增加电脑后，用顶部名称切换范围。"],
    tip: "配对码过期就重新生成。每台电脑的连接和任务分别保存。",
  },
  {
    id: "activity", title: "查看工作动态", summary: "先看需要处理的事项，再查看执行中的工作。",
    image: illustrations.activity, imageAlt: "Attention 显示需处理事项，Tasks 显示 Agent 工作动态",
    steps: ["顶部选择一台电脑，或选择「全部电脑」汇总查看。", "底部 Attention 查看需处理事项，Tasks 查看 Agent 工作动态。", "点卡片上的「打开 Task Room」，查看关联任务、讨论和当前执行。"],
    tip: "手机展示电脑端的工作动态。新建项目、创建手工任务和绑定工作目录在桌面端完成。",
  },
  {
    id: "review", title: "回复与验收", summary: "在手机上回应问题、查看报告并处理人工关卡。",
    image: illustrations.review, imageAlt: "查看任务报告，核对操作后接受结果或要求修改",
    steps: ["打开 Task Room，先阅读任务目标、当前报告或等待原因。", "回复消息时先点「预览效果」，核对影响后再按预览提交。", "根据当前任务提供的按钮处理关卡、接受报告或要求修改，检查桌面返回的结果。"],
    tip: "需要中止工作时，先核对当前执行。网络断开时，页面会明确显示操作尚未发送或结果未知。",
  },
  {
    id: "offline", title: "外部活动与断线", summary: "查看 CLI 活动，并区分实时状态与上次记录。",
    image: illustrations.offline, imageAlt: "在线电脑显示实时更新，离线电脑保留上次记录并等待重连",
    steps: ["底部 External 查看电脑发现的外部 CLI 活动，可按来源筛选。", "有「查看只读详情」时点开阅读；有关联任务时可以进入 Task Room。", "看到离线提示时，检查电脑上的 Stella 和网络；连接恢复后重新核对当前状态。"],
    tip: "离线内容是上次记录。外部活动详情为只读，执行工作仍留在电脑上。",
  },
];
