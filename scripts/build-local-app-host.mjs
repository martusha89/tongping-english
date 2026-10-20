import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [path.join(root, "src", "local-app-host-client.ts")],
  outfile: path.join(root, "assets", "local-app-host-v1.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome120", "safari17"],
  minify: true,
  sourcemap: false,
  legalComments: "none",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});

console.log("Built assets/local-app-host-v1.js");
