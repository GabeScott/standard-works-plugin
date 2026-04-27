import { build } from "esbuild";

build({
  entryPoints: ["main.ts"],
  bundle: true,
  outfile: "main.js",
  platform: "node",
  target: ["es2020"],
  external: ["obsidian"],
  format: "cjs",
  minify: true,
  sourcemap: false,
  logLevel: "info",
}).catch(() => process.exit(1));
