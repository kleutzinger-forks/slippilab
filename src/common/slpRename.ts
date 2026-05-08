// Generates filenames in the slp_rename convention:
//   YYYYMMDD - <players> - <stage>.slp
// where players is "Char (id) vs Char (id)" (or 4-player teams variant) and
// id falls back through nametag → display name → costume color index.
//
// Ported from slpIngestAndroid src/services/replayPatchService.ts but
// adapted to consume parser output (PlayerSettings) directly.

import { characterNameByExternalId, stageNameByExternalId } from "./ids";
import type { PlayerSettings } from "./types";

function sanitize(s: string): string {
  return s.replace(/[/\\:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
}

function playerLabel(p: PlayerSettings): string {
  const charName = characterNameByExternalId[p.externalCharacterId] ?? "Unknown";
  const tag = p.nametag?.trim() || p.displayName?.trim();
  const id = tag ?? (p.costumeIndex != null ? String(p.costumeIndex) : null);
  return id ? `${charName} (${id})` : charName;
}

export function generateSlpFilename(
  players: PlayerSettings[],
  stageId: number,
  date: Date
): string {
  const datePrefix = date.toISOString().slice(0, 10).replace(/-/g, "");
  const stage = sanitize(stageNameByExternalId[stageId] ?? "Unknown Stage");

  const active = players.filter(Boolean);
  let label: string;
  if (active.length === 4) {
    const teams: PlayerSettings[][] = [[], []];
    for (const p of active) {
      const team = p.teamId === 0 || p.teamId === 1 ? p.teamId : p.playerIndex < 2 ? 0 : 1;
      teams[team]!.push(p);
    }
    if (teams[0].length === 2 && teams[1].length === 2) {
      label = `${playerLabel(teams[0]![0]!)} & ${playerLabel(teams[0]![1]!)} vs ${playerLabel(teams[1]![0]!)} & ${playerLabel(teams[1]![1]!)}`;
    } else {
      label = active.map(playerLabel).join(" vs ");
    }
  } else if (active.length === 2) {
    label = `${playerLabel(active[0]!)} vs ${playerLabel(active[1]!)}`;
  } else if (active.length === 1) {
    label = playerLabel(active[0]!);
  } else {
    label = "Unknown";
  }

  return `${datePrefix} - ${sanitize(label)} - ${stage}.slp`;
}

// Append "(2)", "(3)" etc. when a name is already taken.
export function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const base = dot >= 0 ? name.slice(0, dot) : name;
  const ext = dot >= 0 ? name.slice(dot) : "";
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}
