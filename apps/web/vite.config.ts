import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";

const repositoryRoot = resolve(import.meta.dirname, "../..");

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, repositoryRoot, "LUMEN_");
  const localServicePort = process.env.LUMEN_PORT ?? environment.LUMEN_PORT ?? "4312";

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 4311,
      proxy: {
        "/api": `http://127.0.0.1:${localServicePort}`,
      },
    },
  };
});
