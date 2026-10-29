import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@pipi\/llm$/, replacement: src("./packages/llm/src/index.ts") },
      { find: /^@pipi\/agent$/, replacement: src("./packages/agent/src/index.ts") },
      { find: /^@pipi\/tui$/, replacement: src("./packages/tui/src/index.ts") },
      { find: /^@pipi\/harness$/, replacement: src("./packages/harness/src/index.ts") },
      { find: /^@pipi\/eval$/, replacement: src("./packages/eval/src/index.ts") },
    ],
  },
  test: {
    environment: "node",
    testTimeout: 30_000,
  },
});
