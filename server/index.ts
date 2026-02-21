import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { runMigrations } from "./db/index.js";
import replaysRoutes from "./routes/replays.js";
import uploadRoutes from "./routes/upload.js";

const app = new Hono();

// API routes
app.route("/api", replaysRoutes);
app.route("/api", uploadRoutes);

// Serve static files from dist/
app.use("/*", serveStatic({ root: "./dist" }));

// Fallback to index.html for SPA routing
app.get("/*", serveStatic({ path: "./dist/index.html" }));

const port = parseInt(process.env.PORT || "3000", 10);

async function main() {
  // Run database migrations
  await runMigrations();
  console.log("Database migrations completed");

  serve(
    {
      fetch: app.fetch,
      port,
    },
    (info) => {
      console.log(`Server running at http://localhost:${info.port}`);
    }
  );
}

main().catch(console.error);
