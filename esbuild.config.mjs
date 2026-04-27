import { build } from "esbuild";
import pkg from "./package.json" assert { type: "json" };

const externals = ["obsidian", ...Object.keys(pkg.dependencies)];

build({
  entryPoints: ["main.ts"],
  bundle: true,
  outfile: "main.js",
  platform: "node",
  target: ["es2020"],
  external: externals,
  format: "cjs",
  minify: true,
  sourcemap: false,
  logLevel: "info",
}).catch(() => process.exit(1));
