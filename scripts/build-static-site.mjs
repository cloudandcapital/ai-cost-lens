import { cp, copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = resolve(root, "web");
const build = resolve(root, "build");
const vendor = resolve(web, "vendor");
const pdfjs = resolve(root, "node_modules", "pdfjs-dist");

await rm(vendor, { recursive: true, force: true });
await mkdir(resolve(vendor, "wasm"), { recursive: true });
await mkdir(resolve(vendor, "standard_fonts"), { recursive: true });
await copyFile(resolve(pdfjs, "build", "pdf.min.mjs"), resolve(vendor, "pdf.min.mjs"));
await copyFile(resolve(pdfjs, "build", "pdf.worker.min.mjs"), resolve(vendor, "pdf.worker.min.mjs"));
await copyFile(resolve(pdfjs, "LICENSE"), resolve(vendor, "PDFJS-LICENSE.txt"));
await cp(resolve(pdfjs, "wasm"), resolve(vendor, "wasm"), { recursive: true });
await cp(resolve(pdfjs, "standard_fonts"), resolve(vendor, "standard_fonts"), { recursive: true });

await import("./build-web-preview.mjs");
await rm(build, { recursive: true, force: true });
await mkdir(build, { recursive: true });
await cp(web, build, { recursive: true });
const nonPublicArtifacts = [
  "README.md",
  "preview.html",
  "model-route-decision-preview.html",
  "model-route-decision.css",
  "model-route-decision.html",
  "model-route-decision.js",
  "model-route-review-preview.html",
  "model-route-review.css",
  "model-route-review.html",
  "model-route-review.js",
  "data/model-route-decision-v1.js",
  "data/model-route-review-packet.js",
];
await Promise.all(nonPublicArtifacts.map((path) => rm(resolve(build, path), { recursive: true, force: true })));
console.log("Built the static Site with same-origin assets; the self-contained preview remains a repo-only artifact");
