import { spawn } from "node:child_process";

const children = [];

function run(name, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    stdio: ["inherit", "pipe", "pipe"],
    env: { ...process.env, ...extraEnv }
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${name}] ${chunk}`);
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${name}] ${chunk}`);
  });

  child.on("exit", (code) => {
    if (code && !process.exitCode) {
      process.exitCode = code;
    }
    shutdown();
  });

  children.push(child);
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

run("server", "node", ["server/index.js"], {
  NODE_ENV: "development",
  PORT: "3001"
});
run("vite", "vite", ["--host", "0.0.0.0"]);
