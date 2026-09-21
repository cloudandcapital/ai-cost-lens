import { countTokens } from "gpt-tokenizer/encoding/o200k_base";

globalThis.AICostLensOpenAITokenizer = Object.freeze({
  encoding: "o200k_base",
  package: "gpt-tokenizer",
  package_version: "4.0.0",
  scope: "OpenAI raw text only; chat, tool, image, audio, and provider wrapper tokens are excluded.",
  countTokens(value) {
    return countTokens(String(value ?? ""));
  },
});
