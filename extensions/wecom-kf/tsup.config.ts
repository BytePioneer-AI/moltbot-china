import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["index.ts"],
  format: ["esm"],
  target: "es2022",
  dts: { resolve: true },
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  outDir: "dist",
  tsconfig: "tsconfig.json",
  noExternal: ["@openclaw-china/shared", "zod"],
});
