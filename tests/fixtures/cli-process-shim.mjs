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
} else {
  process.stderr.write(`unknown mode: ${String(mode)}\n`);
  process.exitCode = 2;
}
