import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = resolve(root, "web", "vendor");

export async function buildOpenAITokenizer() {
  await mkdir(vendor, { recursive: true });
  await build({
    configFile: false,
    publicDir: false,
    logLevel: "warn",
    build: {
      emptyOutDir: false,
      lib: {
        entry: resolve(root, "scripts", "openai-tokenizer-entry.mjs"),
        name: "AICostLensTokenizerBundle",
        formats: ["iife"],
        fileName: () => "openai-tokenizer.js",
      },
      minify: "oxc",
      outDir: vendor,
      sourcemap: false,
    },
  });
  await copyFile(
    resolve(root, "node_modules", "gpt-tokenizer", "LICENSE"),
    resolve(vendor, "GPT-TOKENIZER-LICENSE.txt"),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildOpenAITokenizer();
  console.log("Built the local OpenAI o200k_base tokenizer");
}
