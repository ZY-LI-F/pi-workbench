const cdpPort = Number(process.env.STELLA_COMPANION_CDP_PORT ?? "9222");
const acceptanceMode = process.env.STELLA_COMPANION_AVD_MODE?.trim() || "full";
if (!Number.isSafeInteger(cdpPort) || cdpPort < 1 || cdpPort > 65_535) {
  throw new Error("STELLA_COMPANION_CDP_PORT 无效");
}
if (acceptanceMode !== "full" && acceptanceMode !== "reconnect") {
  throw new Error("STELLA_COMPANION_AVD_MODE 只支持 full 或 reconnect");
}

const targets = await fetch(`http://127.0.0.1:${cdpPort}/json`).then((response) => {
  if (!response.ok) throw new Error(`CDP target discovery failed: ${response.status}`);
  return response.json();
});
const target = targets.find((candidate) => candidate.type === "page" && candidate.title === "Stella Companion");
if (!target?.webSocketDebuggerUrl) throw new Error("没有找到已启动的 Stella Companion WebView");

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let requestId = 0;

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", () => reject(new Error("CDP WebSocket 连接失败")), { once: true });
});

function send(method, params = {}) {
  const id = ++requestId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(`${message.error.message} (${message.error.code})`));
    else request.resolve(message.result);
    return;
  }
  if (message.method === "Page.javascriptDialogOpening") {
    void send("Page.handleJavaScriptDialog", { accept: true });
  }
});

await Promise.all([send("Runtime.enable"), send("Page.enable")]);

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "WebView evaluate failed");
  return result.result?.value;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(label, predicate, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error(`等待超时: ${label}`);
}

async function bodyText() {
  return evaluate("document.body.innerText");
}

async function waitForText(text, timeoutMs) {
  await waitFor(text, async () => String(await bodyText()).includes(text), timeoutMs);
}

async function clickButton(label) {
  const clicked = await evaluate(`(() => {
    const label = ${JSON.stringify(label)};
    const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
    button?.click();
    return Boolean(button);
  })()`);
  if (!clicked) throw new Error(`没有找到按钮: ${label}`);
}

async function navigate(label) {
  const clicked = await evaluate(`(() => {
    const label = ${JSON.stringify(label)};
    const button = [...document.querySelectorAll(".bottom-nav button")].find((candidate) => candidate.textContent?.trim().endsWith(label));
    button?.click();
    return Boolean(button);
  })()`);
  if (!clicked) throw new Error(`没有找到导航: ${label}`);
}

async function openTask(title) {
  await navigate("Tasks");
  await waitFor(title, async () => String(await bodyText()).includes(title));
  const clicked = await evaluate(`(() => {
    const title = ${JSON.stringify(title)};
    const card = [...document.querySelectorAll(".task-card")].find((candidate) => candidate.querySelector("h3")?.textContent?.trim() === title);
    card?.querySelector("button")?.click();
    return Boolean(card?.querySelector("button"));
  })()`);
  if (!clicked) throw new Error(`没有找到 Task 卡片: ${title}`);
  await waitForText("TASK ROOM");
}

async function closeTask() {
  const closed = await evaluate(`(() => {
    const button = document.querySelector(".task-room__top button");
    button?.click();
    return Boolean(button);
  })()`);
  if (!closed) throw new Error("Task Room 关闭按钮不存在");
}

async function enterTaskMessage(value) {
  const updated = await evaluate(`(() => {
    const textarea = document.querySelector('textarea[aria-label="Task Room 消息"]');
    if (!(textarea instanceof HTMLTextAreaElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, ${JSON.stringify(value)});
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  if (!updated) throw new Error("Task Room 消息输入框不存在");
}

await waitForText("Stella Acceptance Host");
await waitForText("在线");
console.log("PASS paired release APK is online");

if (acceptanceMode === "reconnect") {
  await navigate("Tasks");
  await waitForText("Android Coordinator 回复验收");
  await waitForText("Android 执行报告验收");
  await navigate("External");
  await waitForText("Codex 外部 Thread 正在实现");
  console.log("PASS persisted pairing reconnected and replaced the authoritative snapshot");
  socket.close();
  process.exit(0);
}

await navigate("Attention");
await waitFor("Coordinator waiting", async () => String(await bodyText()).includes("Android Coordinator 回复验收"), 15_000);
await openTask("Android Coordinator 回复验收");
await enterTaskMessage("Android release acceptance reply");
await clickButton("预览效果");
await waitForText("下一轮 review");
await clickButton("按预览提交");
await waitForText("已接受");
await waitForText("Android 回复已创建且仅创建一个 Coordinator review");
console.log("PASS Coordinator reply created one review round");
await closeTask();

await openTask("Android 人工关卡验收");
await waitForText("人工关卡");
await clickButton("批准");
await waitForText("已接受");
console.log("PASS human gate approved");
await closeTask();

await openTask("Android 执行报告验收");
await waitForText("执行报告待验收");
await clickButton("接受");
await waitForText("已接受");
console.log("PASS execution report accepted");
await closeTask();

await openTask("Android 精确中止验收");
await waitForText("当前执行可中止");
await clickButton("确认后中止精确 execution");
await waitForText("已接受");
console.log("PASS exact execution aborted after confirmation");
await closeTask();

await navigate("External");
await waitForText("Claude / Codex 只读活动");
await waitForText("Claude Agents · Last good");
await waitForText("Codex 外部 Thread 正在实现");
const duplicateVisible = String(await bodyText()).includes("不应重复显示的 managed session");
if (duplicateVisible) throw new Error("managed external duplicate 仍然可见");
const openedDetail = await evaluate(`(() => {
  const card = [...document.querySelectorAll(".external-card")].find((candidate) => candidate.querySelector("h3")?.textContent?.includes("Codex 外部 Thread"));
  const button = [...(card?.querySelectorAll("button") ?? [])].find((candidate) => candidate.textContent?.trim() === "查看只读详情");
  button?.click();
  return Boolean(button);
})()`);
if (!openedDetail) throw new Error("Codex 只读详情按钮不存在");
await waitForText("已完成统一投影、筛选和只读详情");
const externalButtons = await evaluate(`[...document.querySelectorAll(".external-card button")].map((button) => button.textContent?.trim())`);
if (externalButtons.some((label) => /reply|continue|回复|继续/i.test(label ?? ""))) {
  throw new Error("External 页面出现了没有真实能力的回复/continue 控件");
}
console.log("PASS external last-good, de-duplication, and bounded read-only detail");

socket.close();
