import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["source", "import", "module", "node", "default"]
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
