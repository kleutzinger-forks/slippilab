import { createSignal, createMemo, For, Show } from "solid-js";
import * as fflate from "fflate";
import { decode } from "@shelacek/ubjson";
import { parseGameSettings } from "~/parser/parser";
import { patchSlpStartAt } from "~/common/patchSlpTimestamp";
import { generateSlpFilename, uniqueName } from "~/common/slpRename";
import { stageNameByExternalId, characterNameByExternalId } from "~/common/ids";
import type { GameSettings, PlayerSettings } from "~/common/types";

type TimeMode = "set" | "same" | "none";

interface ParsedFile {
  name: string;            // basename for display
  relativePath: string;    // path inside the input set, including any subdirs from a zip
  bytes: Uint8Array;
  settings: GameSettings | null;
  startAt: string | null;
  startAtDate: Date | null;
  error: string | null;
}

function maybeDecompress(bytes: Uint8Array): Uint8Array {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return fflate.gunzipSync(bytes);
  }
  return bytes;
}

// Strip "./" prefix and ignore zip metadata directories like __MACOSX.
function normalizeZipPath(p: string): string | null {
  let s = p.replace(/\\/g, "/");
  while (s.startsWith("./")) s = s.slice(2);
  if (s.startsWith("__MACOSX/") || s.includes("/__MACOSX/")) return null;
  if (s.split("/").some((seg) => seg.startsWith("."))) return null;
  if (s.endsWith("/")) return null; // directory entry
  return s;
}

async function loadInputFiles(files: File[]): Promise<{ relativePath: string; bytes: Uint8Array }[]> {
  const out: { relativePath: string; bytes: Uint8Array }[] = [];
  for (const f of files) {
    const lower = f.name.toLowerCase();
    if (lower.endsWith(".zip")) {
      const buf = new Uint8Array(await f.arrayBuffer());
      const entries = fflate.unzipSync(buf);
      for (const [path, entryBytes] of Object.entries(entries)) {
        const norm = normalizeZipPath(path);
        if (!norm || !norm.toLowerCase().endsWith(".slp")) continue;
        out.push({ relativePath: norm, bytes: entryBytes });
      }
    } else if (lower.endsWith(".slp")) {
      out.push({ relativePath: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    }
  }
  return out;
}

function parseOne(relativePath: string, bytesIn: Uint8Array): ParsedFile {
  const name = relativePath.split("/").pop() || relativePath;
  try {
    const bytes = maybeDecompress(bytesIn);
    const settings = parseGameSettings(decode(bytes, { useTypedArrays: true }));
    const startAt = (settings as GameSettings & { startTimestamp?: string }).startTimestamp ?? null;
    const startAtDate = startAt ? new Date(startAt) : null;
    return {
      name,
      relativePath,
      bytes,
      settings,
      startAt,
      startAtDate: startAtDate && !isNaN(startAtDate.getTime()) ? startAtDate : null,
      error: null,
    };
  } catch (err) {
    return {
      name,
      relativePath,
      bytes: bytesIn,
      settings: null,
      startAt: null,
      startAtDate: null,
      error: String(err),
    };
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function shortIso(d: Date): string {
  return d.toISOString().slice(0, 19) + "Z";
}

function describePlayers(players: PlayerSettings[]): string {
  const active = players.filter(Boolean);
  return active
    .map((p) => {
      const c = characterNameByExternalId[p.externalCharacterId] ?? "?";
      const tag = p.nametag?.trim() || p.displayName?.trim();
      return tag ? `${c} (${tag})` : c;
    })
    .join(" vs ");
}

function sanitizeFilenameSegment(s: string): string {
  return s.replace(/[/\\:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
}

// "Mr. Motion vs Freezus" if tags exist, else "Fox vs Falco" character names.
function summarizePlayersForArchive(players: PlayerSettings[]): string {
  const active = players.filter(Boolean);
  if (active.length === 0) return "";
  const labels = active.map((p) => {
    const tag = p.nametag?.trim() || p.displayName?.trim() || p.connectCode?.trim();
    return tag || characterNameByExternalId[p.externalCharacterId] || "?";
  });
  if (labels.length === 4) {
    return `${labels[0]} & ${labels[1]} vs ${labels[2]} & ${labels[3]}`;
  }
  return labels.join(" vs ");
}

function archiveZipName(firstFile: ParsedFile | undefined): string {
  const stamp = toLocalInput(new Date()).replace(/[-:T]/g, "").slice(0, 12);
  if (!firstFile?.settings) return `slippi-corrected-${stamp}.zip`;
  const players = sanitizeFilenameSegment(
    summarizePlayersForArchive(firstFile.settings.playerSettings)
  );
  const datePart = (firstFile.startAtDate ?? new Date()).toISOString().slice(0, 10);
  if (!players) return `slippi-corrected-${stamp}.zip`;
  return `${datePart} - ${players}.zip`;
}

// Replace the basename of `relativePath` while keeping any subdirectory prefix.
function withReplacedBasename(relativePath: string, newBasename: string): string {
  const idx = relativePath.lastIndexOf("/");
  return idx === -1 ? newBasename : `${relativePath.slice(0, idx + 1)}${newBasename}`;
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function Corrector() {
  const [parsed, setParsed] = createSignal<ParsedFile[]>([]);
  const [timeMode, setTimeMode] = createSignal<TimeMode>("set");
  const [rename, setRename] = createSignal(false);
  const [localTime, setLocalTime] = createSignal<string>(toLocalInput(new Date()));
  const [busy, setBusy] = createSignal(false);
  const [statusMsg, setStatusMsg] = createSignal<string>("");
  const [errorMsg, setErrorMsg] = createSignal<string>("");

  const earliestDate = createMemo(() => {
    const dates = parsed()
      .map((p) => p.startAtDate)
      .filter((d): d is Date => d !== null);
    if (dates.length === 0) return null;
    return dates.reduce((min, d) => (d < min ? d : min));
  });

  const orderedParsed = createMemo(() => {
    const list = parsed().slice();
    list.sort((a, b) => {
      if (a.startAtDate && b.startAtDate) return a.startAtDate.getTime() - b.startAtDate.getTime();
      if (a.startAtDate) return -1;
      if (b.startAtDate) return 1;
      return 0;
    });
    return list;
  });

  async function handleFiles(files: File[] | FileList) {
    setErrorMsg("");
    setStatusMsg("Reading files…");
    try {
      const flat = await loadInputFiles(Array.from(files));
      const next: ParsedFile[] = flat.map((f) => parseOne(f.relativePath, f.bytes));
      setParsed(next);
      const failed = next.filter((p) => p.error).length;
      setStatusMsg(`${next.length} replay(s) loaded${failed ? `, ${failed} failed to parse` : ""}.`);
      const earliest = next
        .map((p) => p.startAtDate)
        .filter((d): d is Date => d !== null)
        .reduce<Date | null>((min, d) => (min === null || d < min ? d : min), null);
      if (earliest) setLocalTime(toLocalInput(earliest));
    } catch (e) {
      setErrorMsg(String(e));
      setStatusMsg("");
    }
  }

  function setToToday() {
    setLocalTime(toLocalInput(new Date()));
  }

  // Compute the new startAt date for a given file under the current settings,
  // or null if timestamps should be left alone.
  function computeNewDate(p: ParsedFile, idx: number): Date | null {
    if (timeMode() === "none") return null;
    const corrected = new Date(localTime());
    if (isNaN(corrected.getTime())) return null;
    if (timeMode() === "same") return corrected;
    // "set" — preserve relative timing
    const earliest = earliestDate();
    if (earliest && p.startAtDate) {
      const offsetMs = corrected.getTime() - earliest.getTime();
      return new Date(p.startAtDate.getTime() + offsetMs);
    }
    return new Date(corrected.getTime() + idx * 5 * 60 * 1000);
  }

  function previewTimestamp(p: ParsedFile, idx: number): string {
    if (timeMode() === "none") return p.startAt ?? "—";
    const d = computeNewDate(p, idx);
    return d ? shortIso(d) : "(invalid time)";
  }

  function previewName(p: ParsedFile, idx: number, used: Set<string>): string {
    if (!rename()) return uniqueName(p.relativePath, used);
    if (!p.settings) return uniqueName(p.relativePath, used);
    const dateForName =
      computeNewDate(p, idx) ?? p.startAtDate ?? new Date();
    const newBasename = generateSlpFilename(
      p.settings.playerSettings,
      p.settings.stageId,
      dateForName
    );
    return uniqueName(withReplacedBasename(p.relativePath, newBasename), used);
  }

  async function processAndDownload() {
    setErrorMsg("");
    if (parsed().length === 0) {
      setErrorMsg("Add some .slp files first.");
      return;
    }
    if (timeMode() !== "none") {
      const d = new Date(localTime());
      if (isNaN(d.getTime())) {
        setErrorMsg("Invalid corrected time.");
        return;
      }
    }

    setBusy(true);
    try {
      setStatusMsg("Patching…");
      const used = new Set<string>();
      const zipFiles: fflate.Zippable = {};

      const list = orderedParsed();
      for (let i = 0; i < list.length; i++) {
        const p = list[i]!;
        let outBytes = p.bytes;

        const newDate = computeNewDate(p, i);
        if (newDate && p.startAt) {
          const patched = patchSlpStartAt(p.bytes, p.startAt, newDate.toISOString());
          if (patched) outBytes = patched;
        }

        let outPath: string;
        if (rename() && p.settings) {
          const dateForName = newDate ?? p.startAtDate ?? new Date();
          const newBasename = generateSlpFilename(
            p.settings.playerSettings,
            p.settings.stageId,
            dateForName
          );
          outPath = withReplacedBasename(p.relativePath, newBasename);
        } else {
          outPath = p.relativePath;
        }
        zipFiles[uniqueName(outPath, used)] = outBytes;
      }

      setStatusMsg("Zipping…");
      const zipBytes = fflate.zipSync(zipFiles);
      const blob = new Blob([zipBytes], { type: "application/zip" });
      downloadBlob(archiveZipName(orderedParsed()[0]), blob);
      setStatusMsg(`Downloaded ${Object.keys(zipFiles).length} file(s).`);
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  function clearAll() {
    setParsed([]);
    setStatusMsg("");
    setErrorMsg("");
  }

  let dropRef: HTMLDivElement | undefined;

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    dropRef?.classList.add("border-blue-500", "bg-blue-50");
  }
  function onDragLeave() {
    dropRef?.classList.remove("border-blue-500", "bg-blue-50");
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    dropRef?.classList.remove("border-blue-500", "bg-blue-50");
    if (e.dataTransfer?.files?.length) {
      void handleFiles(e.dataTransfer.files);
    }
  }

  const previewRows = createMemo(() => {
    const used = new Set<string>();
    return orderedParsed().map((p, i) => {
      const name = previewName(p, i, used);
      const ts = previewTimestamp(p, i);
      return { p, name, ts };
    });
  });

  const renameExample = createMemo(() => {
    const first = orderedParsed()[0];
    if (first?.settings) {
      const date = first.startAtDate ?? new Date();
      return generateSlpFilename(first.settings.playerSettings, first.settings.stageId, date);
    }
    return "20260508 - Fox (Mr. Motion) vs Fox (Freezus) - Yoshi's Story.slp";
  });

  return (
    <div class="min-h-screen bg-gray-50 text-gray-900">
      <header class="bg-white border-b border-gray-200 px-6 py-4">
        <div class="max-w-5xl mx-auto flex items-center justify-between">
          <h1 class="text-xl font-bold tracking-tight">Slippi Time Corrector</h1>
          <a href="/" class="text-sm text-blue-600 hover:underline">← SlippiLab</a>
        </div>
      </header>

      <main class="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <p class="text-sm text-gray-600 max-w-2xl">
          Fix the timestamps (and optionally the filenames) on a batch of <code class="bg-gray-200 px-1 rounded">.slp</code> replays
          without uploading them anywhere — everything happens in your browser. Drop files (or a <code class="bg-gray-200 px-1 rounded">.zip</code>,
          including ones with subfolders), pick options, and download a zip back.
        </p>

        <div
          ref={dropRef}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center bg-white transition-colors"
        >
          <p class="text-gray-700 mb-3">Drop .slp files or a .zip here</p>
          <label class="inline-block">
            <span class="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded cursor-pointer">
              Choose files
            </span>
            <input
              type="file"
              multiple
              accept=".slp,.zip"
              class="hidden"
              onChange={(e) => {
                const files = e.currentTarget.files;
                if (files) void handleFiles(files);
              }}
            />
          </label>
          <Show when={parsed().length > 0}>
            <button
              type="button"
              onClick={clearAll}
              class="ml-3 text-sm text-gray-500 hover:text-gray-800"
            >
              Clear
            </button>
          </Show>
        </div>

        <Show when={statusMsg()}>
          <div class="text-sm text-gray-600">{statusMsg()}</div>
        </Show>
        <Show when={errorMsg()}>
          <div class="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{errorMsg()}</div>
        </Show>

        <Show when={parsed().length > 0}>
          <section class="bg-white rounded-lg border border-gray-200 p-5 space-y-5">
            <div>
              <h2 class="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-2">Time correction</h2>
              <div class="space-y-2">
                <label class="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="time-mode"
                    value="set"
                    checked={timeMode() === "set"}
                    onChange={() => setTimeMode("set")}
                    class="mt-1"
                  />
                  <div>
                    <div class="font-medium">Treat as one set (preserve relative times)</div>
                    <div class="text-xs text-gray-500">First game lands at the time below; later games keep their original spacing.</div>
                  </div>
                </label>
                <label class="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="time-mode"
                    value="same"
                    checked={timeMode() === "same"}
                    onChange={() => setTimeMode("same")}
                    class="mt-1"
                  />
                  <div>
                    <div class="font-medium">Set all replays to the same timestamp</div>
                    <div class="text-xs text-gray-500">Every file's startAt becomes exactly the time below.</div>
                  </div>
                </label>
                <label class="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="time-mode"
                    value="none"
                    checked={timeMode() === "none"}
                    onChange={() => setTimeMode("none")}
                    class="mt-1"
                  />
                  <div>
                    <div class="font-medium">Don't change timestamps</div>
                    <div class="text-xs text-gray-500">Leave each file's startAt alone.</div>
                  </div>
                </label>
              </div>
            </div>

            <Show when={timeMode() !== "none"}>
              <div>
                <h2 class="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-2">
                  {timeMode() === "set" ? "Time of first game (your local time)" : "Timestamp for all replays (your local time)"}
                </h2>
                <div class="flex flex-wrap items-center gap-2">
                  <input
                    type="datetime-local"
                    step="1"
                    value={localTime()}
                    onInput={(e) => setLocalTime(e.currentTarget.value)}
                    class="border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={setToToday}
                    class="bg-gray-200 hover:bg-gray-300 text-gray-800 text-sm px-3 py-2 rounded"
                  >
                    Set to today
                  </button>
                  <Show when={earliestDate()}>
                    <span class="text-xs text-gray-500">
                      Detected earliest: <span class="font-mono">{shortIso(earliestDate()!)}</span>
                    </span>
                  </Show>
                </div>
              </div>
            </Show>

            <div>
              <label class="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rename()}
                  onChange={(e) => setRename(e.currentTarget.checked)}
                  class="mt-1"
                />
                <div>
                  <div class="font-medium">Rename files (slp_rename style)</div>
                  <div class="text-xs text-gray-500">
                    Off by default. Example: <code class="bg-gray-100 px-1 rounded font-mono">{renameExample()}</code>
                  </div>
                </div>
              </label>
            </div>

            <div>
              <button
                type="button"
                disabled={busy()}
                onClick={processAndDownload}
                class="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white text-sm font-medium px-4 py-2 rounded"
              >
                {busy() ? "Working…" : "Process & Download .zip"}
              </button>
            </div>
          </section>

          <section class="bg-white rounded-lg border border-gray-200 overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-100 text-xs uppercase text-gray-500 tracking-wider">
                <tr>
                  <th class="text-left py-2 px-3">#</th>
                  <th class="text-left py-2 px-3">Path</th>
                  <th class="text-left py-2 px-3">Players</th>
                  <th class="text-left py-2 px-3">Stage</th>
                  <th class="text-left py-2 px-3">Original startAt</th>
                  <th class="text-left py-2 px-3">New startAt</th>
                  <th class="text-left py-2 px-3">Output path</th>
                </tr>
              </thead>
              <tbody>
                <For each={previewRows()}>
                  {(row, i) => (
                    <tr class="border-t border-gray-100">
                      <td class="py-1.5 px-3 text-gray-500">{i() + 1}</td>
                      <td class="py-1.5 px-3 font-mono text-xs text-gray-600 truncate max-w-[24ch]" title={row.p.relativePath}>
                        {row.p.relativePath}
                      </td>
                      <td class="py-1.5 px-3">
                        <Show when={row.p.settings} fallback={<span class="text-red-500">{row.p.error ?? "—"}</span>}>
                          {describePlayers(row.p.settings!.playerSettings)}
                        </Show>
                      </td>
                      <td class="py-1.5 px-3">
                        <Show when={row.p.settings}>
                          {stageNameByExternalId[row.p.settings!.stageId] ?? "?"}
                        </Show>
                      </td>
                      <td class="py-1.5 px-3 font-mono text-xs text-gray-500">{row.p.startAt ?? "—"}</td>
                      <td class="py-1.5 px-3 font-mono text-xs">{row.ts}</td>
                      <td class="py-1.5 px-3 font-mono text-xs">{row.name}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </section>
        </Show>
      </main>
    </div>
  );
}
