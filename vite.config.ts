import { defineConfig, loadEnv, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";

// Serves the Vercel-style /api/chat handler under `vite dev`, loading .env.local into
// process.env so the serverless proxy can read ANTHROPIC_API_KEY. Prod uses Vercel's own
// runtime + env; this plugin only runs in dev.
function devApi(mode: string): PluginOption {
  const env = loadEnv(mode, process.cwd(), "");
  for (const [key, value] of Object.entries(env)) {
    if (!(key in process.env)) process.env[key] = value;
  }
  return {
    name: "dev-api-chat",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/chat", async (req, res, next) => {
        try {
          const mod = await server.ssrLoadModule("/api/chat.ts");
          await mod.default(req, res);
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), devApi(mode)],
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: false,
  },
}));
