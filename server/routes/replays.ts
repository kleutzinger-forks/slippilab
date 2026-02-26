import { Hono } from "hono";
import { getAllReplays, getReplayByFileName, getAllSetsWithReplays, renameSet, clearAllData, deleteSetWithReplays } from "../db/index.js";
import { downloadFile, deleteAllFiles, deleteFile } from "../storage/local.js";

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
    const files = deleteAllFiles();
    const counts = clearAllData();
    console.log(`[delete-all] removed ${counts.replays} replay(s), ${counts.sets} set(s)`);
    console.log(`[delete-all] deleted files:\n${files.map(f => `  ${f}`).join("\n")}`);
    return c.json({ ok: true });
  })
  .patch("/set/:id", async (c) => {
    const id = c.req.param("id");
    const { name } = await c.req.json<{ name: string }>();
    renameSet(id, name);
    return c.json({ ok: true });
  })
  .delete("/set/:id", async (c) => {
    const id = c.req.param("id");
    const { fileNames } = deleteSetWithReplays(id);
    for (const fileName of fileNames) {
      await deleteFile(fileName);
    }
    console.log(`[delete-set] deleted set ${id}, removed ${fileNames.length} file(s)`);
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
