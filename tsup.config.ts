import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  entry: ["src/index.ts", "src/validate.ts", "src/connect.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  // Single source of truth for the version: package.json, inlined at build
  // time so the report stamp and the MCP clientInfo can never drift from it.
  define: { __TIREKICK_VERSION__: JSON.stringify(version) },
});
