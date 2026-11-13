import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app's interface lives in web/ and builds into dist/, which server.mjs serves.
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  server: { port: 5173, proxy: { "/api": "http://localhost:3000", "/auth": "http://localhost:3000", "/logout": "http://localhost:3000" } },
});
