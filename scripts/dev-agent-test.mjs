import { spawn } from "node:child_process";

const windows = process.platform === "win32";
const executable = windows ? process.env.ComSpec ?? "cmd.exe" : "pnpm";
const arguments_ = windows ? ["/d", "/s", "/c", "pnpm.cmd run dev"] : ["run", "dev"];
const child = spawn(executable, arguments_, {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    LUMEN_AGENT_TEST: "true",
    VITE_AGENT_TEST: "true",
    LUMEN_PORT: process.env.LUMEN_AGENT_TEST_PORT ?? "4412",
    LUMEN_WEB_PORT: process.env.LUMEN_AGENT_TEST_WEB_PORT ?? "4411",
  },
  shell: false,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
child.once("exit", (code) => { process.exitCode = code ?? 1; });
