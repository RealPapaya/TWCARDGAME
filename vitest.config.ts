import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Workspace packages publish a `source` exports condition pointing at their
// `src/index.ts`, so tests can run without a prior `tsc -b`. Vitest 8's SSR
// resolver does not honour that condition when `dist/` is absent (e.g. on a
// fresh CI checkout), so resolve the bare specifiers to source explicitly.
const pkg = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    conditions: ["source", "import", "module", "node", "default"],
    alias: {
      "@twcardgame/shared": pkg("./packages/shared/src/index.ts"),
      "@twcardgame/cards": pkg("./packages/cards/src/index.ts"),
      "@twcardgame/rules": pkg("./packages/rules/src/index.ts"),
      "@twcardgame/db": pkg("./packages/db/src/index.ts"),
      "@twcardgame/test-utils": pkg("./packages/test-utils/src/index.ts")
    }
  },
  test: {
    globals: true,
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    environment: "node",
    server: {
      deps: {
        inline: [/@twcardgame\//]
      }
    }
  }
});
