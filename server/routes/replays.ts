import { Hono } from "hono";
import { getAllReplays, getReplayByFileName, getAllSetsWithReplays, renameSet, clearAllData } from "../db/index.js";
import { downloadFile, deleteAllFiles } from "../storage/local.js";

const app = new Hono()
  .get("/replays", async (c) => {
    const replays = getAllReplays();
    const merged = replays.map((r) => ({
      ...r,
      players: typeof r.players === "string" ? JSON.parse(r.players) : r.players,
    }));
    return c.json({ data: merged });
  })
  .get("/sets", async (c) => {
    const sets = getAllSetsWithReplays();
    const merged = sets.map((s) => ({
      ...s,
      replays: s.replays.map((r) => ({
        ...r,
        players: typeof r.players === "string" ? JSON.parse(r.players) : r.players,
      })),
    }));
    return c.json({ data: merged });
  })
  .delete("/replays", async (c) => {
    deleteAllFiles();
    clearAllData();
    return c.json({ ok: true });
  })
  .patch("/set/:id", async (c) => {
    const id = c.req.param("id");
    const { name } = await c.req.json<{ name: string }>();
    renameSet(id, name);
    return c.json({ ok: true });
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
