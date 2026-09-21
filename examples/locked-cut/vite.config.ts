import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { chooseStory } from "./decision.js";
export default defineConfig({
  root: "examples/locked-cut", plugins: [react(), { name: "local-story-decision", configureServer(server) {
    server.middlewares.use("/api/story", async (req, res) => {
      res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
      if (req.method !== "POST" || req.headers.origin !== "http://127.0.0.1:5188" || !req.headers["content-type"]?.startsWith("application/json")) { res.statusCode = 403; res.end('{"error":"Use the local demo page."}'); return; }
      try {
        const chunks: Buffer[] = []; let bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 40000) throw new Error("Request too large."); chunks.push(Buffer.from(chunk)); }
        const { apiKey, ...input } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const result = await chooseStory(input, typeof apiKey === "string" ? apiKey : process.env.TYPESAFE_API_KEY ?? "");
        res.end(JSON.stringify(result));
      } catch { res.statusCode = 422; res.end(JSON.stringify({ error: "The decision could not be validated. Your cut is unchanged. Check tags, key, and connection before trying again." })); }
    });
  } }], server: { host: "127.0.0.1", port: 5188, strictPort: true },
});
