import { Hono } from "hono";
import { getAllReplays, getReplayById } from "../db/index.js";
import { downloadFile } from "../storage/b2.js";

const app = new Hono()
  .get("/replays", async (c) => {
    const replays = await getAllReplays();
    const merged = replays.map((r) => ({
      ...r,
      players: typeof r.players === "string" ? JSON.parse(r.players) : r.players,
    }));
    return c.json({ data: merged });
  })
  .get("/replay/:id", async (c) => {
    const id = c.req.param("id");

    // Check if replay exists in database
    const replay = await getReplayById(id);
    if (!replay) {
      return c.notFound();
    }

    // Download from B2
    const fileData = await downloadFile(replay.file_name);
    if (!fileData) {
      return c.notFound();
    }

    return c.body(fileData);
  });

export default app;
