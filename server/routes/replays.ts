import { Hono } from "hono";
import { getAllReplays, getReplayByFileName } from "../db/index.js";
import { downloadFile } from "../storage/local.js";

const app = new Hono()
  .get("/replays", async (c) => {
    const replays = getAllReplays();
    const merged = replays.map((r) => ({
      ...r,
      players: typeof r.players === "string" ? JSON.parse(r.players) : r.players,
    }));
    return c.json({ data: merged });
  })
  .get("/replay/:fileName", async (c) => {
    const fileName = c.req.param("fileName");

    // Check if replay exists in database
    const replay = getReplayByFileName(fileName);
    if (!replay) {
      return c.notFound();
    }

    const fileData = await downloadFile(replay.file_name);
    if (!fileData) {
      return c.notFound();
    }

    return c.body(fileData);
  });

export default app;
