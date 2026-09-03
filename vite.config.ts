import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const iconPath = fileURLToPath(new URL("./media/icon.png", import.meta.url));

function webIcon(): Plugin {
  return {
    name: "pi-webview-icon",
    configureServer(server) {
      server.middlewares.use("/icon.png", (_req, res) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "image/png");
        res.end(readFileSync(iconPath));
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "icon.png",
        source: readFileSync(iconPath),
      });
    },
  };
}

export default defineConfig({
  root: "src/web",
  plugins: [webIcon()],
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
