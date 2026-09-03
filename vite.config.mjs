import { defineConfig } from "vite";

export default defineConfig({
  root: "build",
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
  },
});
