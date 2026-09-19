// Launch the unchanged Pi entrypoint only after the host has attached process supervision.
// This is a host lifecycle adapter, not a second Pi core or an extension override.
const { pathToFileURL } = require("node:url");
const [entrypoint, ...args] = process.argv.slice(2);
if (!entrypoint || !process.send) throw new Error("Stella Pi launcher requires its host IPC handshake");
process.once("message", (message) => {
  if (message?.type !== "stella:start") throw new Error("Invalid Stella launch handshake");
  process.argv = [process.argv[0], entrypoint, ...args];
  // Sol uses this host-only channel to cancel a pending stage continuation.
  // Keep ordinary Pi launches unchanged, and do not let the channel itself
  // keep an otherwise finished runtime alive.
  if (process.env.STELLA_SOL_MODE) process.channel.unref();
  else process.disconnect();
  void import(pathToFileURL(entrypoint).href).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
});
