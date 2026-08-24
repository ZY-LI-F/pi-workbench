import { spawn } from "node:child_process";

const mode = process.argv[2];

if (mode === "jsonl") {
  const first = Buffer.from(`${JSON.stringify({ type: "hello", text: "你好" })}\n`, "utf8");
  process.stdout.write(first.subarray(0, first.length - 2));
  setTimeout(() => {
    process.stdout.write(first.subarray(first.length - 2));
    process.stdout.write(JSON.stringify({ type: "done", ok: true }));
  }, 5);
} else if (mode === "stdin") {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => process.stdout.write(JSON.stringify({ input })));
} else if (mode === "tails") {
  process.stdout.write(`head-${"x".repeat(900)}-tail`);
  process.stderr.write(`problem-${"y".repeat(900)}-end\n`);
} else if (mode === "invalid-jsonl") {
  process.stdout.write("{not-json}\n");
} else if (mode === "long-line") {
  process.stdout.write("x".repeat(600));
} else if (mode === "wait") {
  spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  setInterval(() => {}, 1000);
} else if (mode === "codex") {
  const argv = process.argv.slice(3);
  if (argv[0] === "--version") process.stdout.write("codex-cli 9.8.7\n");
  else if (argv[0] === "login" && argv[1] === "status") process.stderr.write("Logged in using ChatGPT\n");
  else process.exitCode = 2;
} else if (mode === "claude") {
  const argv = process.argv.slice(3);
  if (argv[0] === "--version") process.stdout.write("4.5.6 (Claude Code)\n");
  else if (argv[0] === "auth" && argv[1] === "status") {
    const loggedIn = process.env.FAKE_CLAUDE_LOGGED_IN === "1";
    process.stdout.write(JSON.stringify({ loggedIn }));
    if (!loggedIn) process.exitCode = 1;
  }
  else process.exitCode = 2;
} else if (mode === "codex-exec") {
  const behavior = process.argv[3];
  const argv = process.argv.slice(4);
  if (argv[0] === "--version") {
    process.stdout.write("codex-cli 7.6.5\n");
  } else if (argv[0] === "login" && argv[1] === "status") {
    process.stderr.write("Logged in using ChatGPT\n");
  } else if (argv[0] === "exec") {
    const sessionId = `thread-shim-${process.pid}`;
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      process.stdout.write(`${JSON.stringify({ type: "thread.started", thread_id: sessionId })}\n`);
      if (behavior === "wait") {
        setInterval(() => {}, 1000);
        return;
      }
      if (behavior === "invalid-jsonl") {
        process.stdout.write("{invalid-json}\n");
        return;
      }
      process.stdout.write(`${JSON.stringify({ type: "item.started", item: { id: "tool-1", type: "command_execution", command: "git status", status: "in_progress" } })}\n`);
      process.stdout.write(`${JSON.stringify({ type: "item.completed", item: { id: "tool-1", type: "command_execution", command: "git status", exit_code: 0, status: "completed" } })}\n`);
      process.stdout.write(`${JSON.stringify({ type: "item.completed", item: { id: "message-1", type: "agent_message", text: `Codex 完成：${input}` } })}\n`);
      if (behavior === "failure") {
        process.stdout.write(`${JSON.stringify({ type: "turn.failed", error: { message: "模型执行失败" } })}\n`);
        process.exitCode = 1;
      } else if (behavior !== "no-terminal") {
        process.stdout.write(`${JSON.stringify({ type: "turn.completed", usage: { input_tokens: 21, output_tokens: 34 } })}\n`);
      }
    });
  } else {
    process.exitCode = 2;
  }
} else if (mode === "claude-print") {
  const behavior = process.argv[3];
  const argv = process.argv.slice(4);
  if (argv[0] === "--version") {
    process.stdout.write("8.7.6 (Claude Code)\n");
  } else if (argv[0] === "auth" && argv[1] === "status") {
    process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: "shim" }));
  } else if (argv[0] === "-p") {
    const sessionId = `claude-session-shim-${process.pid}`;
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      process.stdout.write(`${JSON.stringify({ type: "system", subtype: "init", session_id: sessionId, model: "claude-shim", permissionMode: "acceptEdits" })}\n`);
      if (behavior === "wait") {
        setInterval(() => {}, 1000);
        return;
      }
      if (behavior === "invalid-jsonl") {
        process.stdout.write("{invalid-json}\n");
        return;
      }
      const toolName = behavior === "permission" ? "Write" : "Bash";
      process.stdout.write(`${JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu-shim", name: toolName, input: {} }], usage: { input_tokens: 10, output_tokens: 4 } }, session_id: sessionId })}\n`);
      process.stdout.write(`${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu-shim", is_error: behavior === "permission", content: behavior === "permission" ? "Claude requested permissions, but you haven't granted it yet." : "ok" }] }, session_id: sessionId })}\n`);
      const output = `Claude 完成：${input}`;
      process.stdout.write(`${JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: output }], usage: { input_tokens: 2, output_tokens: 8 } }, session_id: sessionId })}\n`);
      if (behavior === "failure") {
        process.stdout.write(`${JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["模型执行失败"], session_id: sessionId, total_cost_usd: 0.04, usage: { input_tokens: 12, output_tokens: 12 } })}\n`);
        process.exitCode = 1;
      } else if (behavior === "permission") {
        process.stdout.write(`${JSON.stringify({ type: "result", subtype: "success", is_error: false, result: output, session_id: sessionId, total_cost_usd: 0.04, usage: { input_tokens: 12, output_tokens: 12 }, permission_denials: [{ tool_name: "Write", tool_use_id: "toolu-shim", tool_input: {} }] })}\n`);
      } else if (behavior !== "no-terminal") {
        process.stdout.write(`${JSON.stringify({ type: "result", subtype: "success", is_error: false, result: output, session_id: sessionId, total_cost_usd: 0.04, usage: { input_tokens: 12, output_tokens: 12 }, permission_denials: [] })}\n`);
      }
    });
  } else {
    process.exitCode = 2;
  }
} else if (mode === "codex-app-server") {
  const thread = (id, source, status, parentThreadId) => ({
    id,
    sessionId: "session-tree-1",
    name: id === "thread-cli" ? "CLI 功能开发" : null,
    preview: `Preview for ${id}`,
    cwd: "/repo",
    path: `/tmp/${id}.jsonl`,
    source,
    status,
    parentThreadId: parentThreadId ?? null,
    forkedFromId: null,
    cliVersion: "0.149.0",
    modelProvider: "openai",
    ephemeral: false,
    projectId: null,
    turns: [],
    createdAt: 1787554800,
    updatedAt: 1787558400,
  });
  const response = (id, result) => process.stdout.write(`${JSON.stringify({ id, result })}\n`);
  let pending = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    pending += chunk;
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.method === "initialize") {
        response(message.id, { codexHome: "/tmp/codex-home", platformFamily: "unix", platformOs: "macos", userAgent: "codex-shim" });
      } else if (message.method === "initialized") {
        process.stdout.write(`${JSON.stringify({ method: "thread/status/changed", params: { threadId: "thread-cli", status: { type: "active", activeFlags: ["waitingOnUserInput"] } } })}\n`);
      } else if (message.method === "thread/list") {
        if (message.params?.cursor === "page-2") {
          response(message.id, {
            data: [thread("thread-sub", { subAgent: { thread_spawn: { depth: 1, parent_thread_id: "thread-cli" } } }, { type: "idle" }, "thread-cli")],
            nextCursor: null,
          });
        } else {
          response(message.id, {
            data: [
              thread("thread-cli", "cli", { type: "idle" }),
              thread("thread-exec", "exec", { type: "active", activeFlags: [] }),
              thread("thread-app", "appServer", { type: "systemError" }),
            ],
            nextCursor: "page-2",
          });
        }
      } else if (message.method === "thread/read") {
        response(message.id, { thread: thread(message.params.threadId, "cli", { type: "idle" }) });
      } else if (message.method === "thread/turns/list") {
        if (message.params?.cursor === "turn-page-2") {
          response(message.id, {
            data: [{ id: "turn-older", status: "completed", startedAt: 1787554700, completedAt: 1787554750, items: [{ id: "compact-1", type: "contextCompaction" }] }],
            nextCursor: null,
          });
        } else {
          response(message.id, {
            data: [{
              id: "turn-current",
              status: "completed",
              startedAt: 1787554800,
              completedAt: 1787554860,
              items: [
                { id: "user-1", type: "userMessage", content: [{ type: "text", text: "实现功能" }] },
                { id: "command-1", type: "commandExecution", command: "npm test", aggregatedOutput: "all passed", status: "completed", commandActions: [], cwd: "/repo" },
                { id: "agent-1", type: "agentMessage", text: "功能已完成" },
              ],
            }],
            nextCursor: "turn-page-2",
          });
        }
      } else if (message.method === "test/error") {
        process.stdout.write(`${JSON.stringify({ id: message.id, error: { code: -32000, message: "fixture failure" } })}\n`);
      } else if (message.method === "test/exit") {
        process.exit(0);
      } else if (message.method === "test/malformed") {
        process.stdout.write("{invalid-json}\n");
      } else if (message.method !== "test/timeout") {
        response(message.id, {});
      }
    }
  });
} else {
  process.stderr.write(`unknown mode: ${String(mode)}\n`);
  process.exitCode = 2;
}
