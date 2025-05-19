import { build } from "esbuild";
import { dependencies } from "./package.json" assert { type: "json" };

const externals = ["obsidian", ...Object.keys(dependencies)];

build({
  entryPoints: ["main.ts"],
  bundle: true,
  outfile: "main.js",
  platform: "node",
  target: ["es2020"],
  external: externals,
  format: "cjs",
  logLevel: "info",
}).catch(() => process.exit(1));
