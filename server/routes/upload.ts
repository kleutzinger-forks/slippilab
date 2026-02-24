import { Hono } from "hono";
import { createHash } from "crypto";
import { gunzipSync } from "zlib";
import { UbjsonDecoder } from "@jsonjoy.com/json-pack/lib/ubjson/index.js";
import { parseReplay } from "../../src/parser/parser.js";
import { insertReplay, insertSet, getReplayByHash, updateReplayBatch } from "../db/index.js";
import { uploadFile } from "../storage/local.js";
// @ts-ignore: zoo-ids doesn't ship types
import { generateId } from "zoo-ids";

function maybeDecompress(bytes: Uint8Array): Uint8Array {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return new Uint8Array(gunzipSync(bytes));
  }
  return bytes;
}

// Returns { id, duplicate } — duplicate is true if the file was already uploaded.
async function processSingleFile(
  bytes: Uint8Array,
  batchId: string | null,
  batchOrder: number | null
): Promise<{ id: string; duplicate: boolean }> {
  bytes = maybeDecompress(bytes);
  const fileHash = createHash("sha256").update(bytes).digest("hex");

  const existing = getReplayByHash(fileHash);
  if (existing) {
    console.log(`[upload] duplicate detected, existing id: ${existing.id}, reassigning to batch`);
    if (batchId !== null && batchOrder !== null) {
      updateReplayBatch(existing.id, batchId, batchOrder);
    }
    return { id: existing.id, duplicate: true };
  }

  const replay = parseReplay(new UbjsonDecoder().decode(bytes));
  const id: string = generateId(`${Date.now()}`);
  const fileName = `${id}.slp`;

  await uploadFile(fileName, bytes);
  insertReplay({
    id,
    file_name: fileName,
    played_on: replay.settings.startTimestamp ?? null,
    num_frames: replay.frames.length,
    external_stage_id: replay.settings.stageId,
    is_teams: replay.settings.isTeams,
    players: replay.settings.playerSettings.filter(Boolean).map((p) => ({
      player_index: p.playerIndex,
      connect_code: p.connectCode ?? "",
      display_name: p.displayName ?? "",
      nametag: p.nametag ?? "",
      external_character_id: p.externalCharacterId,
      team_id: p.teamId,
    })),
    batch_id: batchId,
    batch_order: batchOrder,
    file_hash: fileHash,
  });

  return { id, duplicate: false };
}

const app = new Hono()
  // Single file: raw binary body. Optional ?note=... query param.
  .post("/replay", async (c) => {
    console.log("[upload] received single file request");
    try {
      const note = c.req.query("note") ?? null;
      const batchId: string = generateId(`${Date.now()}-batch`);
      insertSet(batchId, note);

      const blob = await c.req.blob();
      console.log(`[upload] blob size: ${blob.size} bytes`);
      const { id, duplicate } = await processSingleFile(
        new Uint8Array(await blob.arrayBuffer()),
        batchId,
        0
      );
      console.log(`[upload] done: ${id} (duplicate: ${duplicate})`);
      return c.json({ id, data: id, batch_id: batchId, duplicate });
    } catch (err) {
      console.error("[upload] error:", err);
      return c.json({ error: String(err) }, 500);
    }
  })
  // Multiple files: multipart/form-data.
  // Fields: "files" (one or more), "note" (optional string).
  .post("/replays", async (c) => {
    console.log("[upload] received multi-file request");
    try {
      const formData = await c.req.formData();
      const note = (formData.get("note") as string | null) ?? null;
      const files = formData.getAll("files") as File[];
      console.log(`[upload] ${files.length} file(s) received, note: ${note}`);

      const batchId: string = generateId(`${Date.now()}-batch`);
      insertSet(batchId, note);

      const results = await Promise.all(
        files.map(async (file, index) => {
          const bytes = new Uint8Array(await file.arrayBuffer());
          try {
            const { id, duplicate } = await processSingleFile(bytes, batchId, index);
            console.log(`[upload] done [${index}]: ${id} (duplicate: ${duplicate})`);
            return { id, duplicate, error: null };
          } catch (err) {
            console.error(`[upload] error on ${file.name}:`, err);
            return { id: null, duplicate: false, error: String(err) };
          }
        })
      );

      return c.json({ batch_id: batchId, data: results });
    } catch (err) {
      console.error("[upload] error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

export default app;
