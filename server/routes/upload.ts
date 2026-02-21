import { Hono } from "hono";
import { UbjsonDecoder } from "@jsonjoy.com/json-pack/lib/ubjson/index.js";
import { parseReplay } from "../../src/parser/parser.js";
import { insertReplay } from "../db/index.js";
import { uploadFile } from "../storage/b2.js";
// @ts-ignore: zoo-ids doesn't ship types
import { generateId } from "zoo-ids";

const app = new Hono().post("/upload", async (c) => {
  const file = await c.req.blob();
  const buffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(buffer);

  // Parse the SLP file
  const replay = parseReplay(new UbjsonDecoder().decode(uint8Array));

  // Generate a unique ID
  const id: string = generateId(`${Date.now()}`);
  const fileName = `${id}.slp`;

  // Upload to B2
  await uploadFile(fileName, uint8Array);

  // Store metadata in PostgreSQL
  await insertReplay({
    id,
    file_name: fileName,
    played_on: replay.settings.startTimestamp ?? null,
    num_frames: replay.frames.length,
    stage_id: replay.settings.stageId,
    is_teams: replay.settings.isTeams,
    players: replay.settings.playerSettings.filter(Boolean).map((p) => ({
      player_index: p.playerIndex,
      connect_code: p.connectCode ?? "",
      display_name: p.displayName ?? "",
      nametag: p.nametag ?? "",
      external_character_id: p.externalCharacterId,
      team_id: p.teamId,
    })),
  });

  return c.json({ id, data: id });
});

export default app;
