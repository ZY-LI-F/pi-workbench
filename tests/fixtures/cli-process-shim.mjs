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
  else if (argv[0] === "auth" && argv[1] === "status") process.stdout.write(JSON.stringify({ loggedIn: process.env.FAKE_CLAUDE_LOGGED_IN === "1" }));
  else process.exitCode = 2;
} else if (mode === "codex-exec") {
  const behavior = process.argv[3];
  const argv = process.argv.slice(4);
  if (argv[0] === "--version") {
    process.stdout.write("codex-cli 7.6.5\n");
  } else if (argv[0] === "login" && argv[1] === "status") {
    process.stderr.write("Logged in using ChatGPT\n");
  } else if (argv[0] === "exec") {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      process.stdout.write(`${JSON.stringify({ type: "thread.started", thread_id: "thread-shim" })}\n`);
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
} else {
  process.stderr.write(`unknown mode: ${String(mode)}\n`);
  process.exitCode = 2;
}
