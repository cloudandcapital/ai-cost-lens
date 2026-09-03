import { cp, copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = resolve(root, "web");
const build = resolve(root, "build");

await import("./build-model-route-decision-preview.mjs");
await import("./build-web-preview.mjs");
await rm(build, { recursive: true, force: true });
await mkdir(build, { recursive: true });
await cp(web, build, { recursive: true });
await copyFile(resolve(web, "preview.html"), resolve(build, "index.html"));

console.log("Built the static Site with the illustrative review available on first paint");
