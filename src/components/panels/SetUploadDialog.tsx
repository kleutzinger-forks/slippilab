import { createSignal, For, Match, Show, Switch } from "solid-js";
import { PrimaryButton, WhiteButton } from "~/components/common/Button";
import { Dialog } from "~/components/common/Dialog";
import { PlusIcon } from "~/components/common/icons";
import { filterFiles } from "~/common/util";
import { uploadSet } from "~/cloudClient";
import { refreshCloudSets } from "~/state/selectionStore";

type State = "idle" | "uploading" | "done" | "error";

export function SetUploadDialog() {
  const [files, setFiles] = createSignal<File[]>([]);
  const [note, setNote] = createSignal("");
  const [state, setState] = createSignal<State>("idle");
  const [progress, setProgress] = createSignal(0);
  const [statusMsg, setStatusMsg] = createSignal("");
  const [errorMsg, setErrorMsg] = createSignal("");

  let inputRef: HTMLInputElement | undefined;

  function reset() {
    setFiles([]);
    setNote("");
    setState("idle");
    setProgress(0);
    setStatusMsg("");
    setErrorMsg("");
  }

  async function onPick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    if (!input.files) return;
    const picked = Array.from(input.files);
    setStatusMsg("Reading…");
    const filtered = await filterFiles(picked);
    setStatusMsg("");
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name));
      return [...prev, ...filtered.filter((f) => !seen.has(f.name))];
    });
    input.value = "";
  }

  function removeAt(i: number) {
    setFiles((prev) => prev.filter((_, j) => j !== i));
  }

  async function onUpload() {
    if (files().length === 0 || !note().trim()) return;
    setState("uploading");
    setProgress(0);
    setStatusMsg("Uploading…");
    setErrorMsg("");
    try {
      await uploadSet(files(), note().trim(), (pct) => setProgress(pct));
      setStatusMsg("");
      setState("done");
      await refreshCloudSets();
    } catch (err) {
      setErrorMsg(String(err));
      setState("error");
    }
  }

  return (
    <Dialog onClose={reset}>
      <Dialog.Trigger>
        <span class="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100">
          <PlusIcon class="h-4 w-4" title="Upload set" />
          Upload Set
        </span>
      </Dialog.Trigger>
      <Dialog.Title>
        <h2 class="text-lg">Upload Set</h2>
      </Dialog.Title>
      <Dialog.Contents>
        <div
          class="flex flex-col gap-4"
          onkeydown={(e: Event) => e.stopPropagation()}
          onkeyup={(e: Event) => e.stopPropagation()}
        >
          <Switch>
            <Match when={state() === "idle" || state() === "uploading"}>
              <div>
                <label class="mb-1 block text-sm font-medium text-slate-700">
                  Set name
                </label>
                <input
                  type="text"
                  class="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  placeholder="e.g. Friday night locals"
                  value={note()}
                  onInput={(e) => setNote(e.currentTarget.value)}
                  disabled={state() === "uploading"}
                />
              </div>

              <div>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept=".slp,.zip"
                  class="hidden"
                  onChange={onPick}
                />
                <div class="flex items-center gap-2">
                  <WhiteButton
                    onClick={() => inputRef?.click()}
                    disabled={state() === "uploading"}
                  >
                    Add files
                  </WhiteButton>
                  <span class="text-sm text-slate-500">
                    {files().length === 0
                      ? "Pick .slp files or a .zip"
                      : `${files().length} file${files().length === 1 ? "" : "s"} ready`}
                  </span>
                </div>
              </div>

              <Show when={files().length > 0}>
                <ul class="max-h-60 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                  <For each={files()}>
                    {(f, i) => (
                      <li class="flex items-center justify-between gap-2 py-0.5">
                        <span class="truncate" title={f.name}>
                          {f.name}
                        </span>
                        <button
                          class="shrink-0 text-slate-400 hover:text-red-600"
                          onClick={() => removeAt(i())}
                          disabled={state() === "uploading"}
                          title="Remove"
                        >
                          ×
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>

              <Show when={state() === "uploading"}>
                <div class="flex flex-col gap-1">
                  <div class="h-2 w-full overflow-hidden rounded bg-slate-200">
                    <div
                      class="h-full bg-slippi-400 transition-[width]"
                      style={{ width: `${progress()}%` }}
                    />
                  </div>
                  <div class="text-center text-xs text-slate-500">
                    {statusMsg()} {progress() > 0 ? `${progress()}%` : ""}
                  </div>
                </div>
              </Show>

              <div class="flex justify-end gap-2">
                <Dialog.Close>
                  <WhiteButton>Cancel</WhiteButton>
                </Dialog.Close>
                <PrimaryButton
                  onClick={onUpload}
                  disabled={
                    state() === "uploading" ||
                    files().length === 0 ||
                    !note().trim()
                  }
                >
                  Upload
                </PrimaryButton>
              </div>
            </Match>

            <Match when={state() === "done"}>
              <p class="text-sm text-green-700">
                Uploaded {files().length} file
                {files().length === 1 ? "" : "s"} to set{" "}
                <strong>{note().trim()}</strong>.
              </p>
              <div class="flex justify-end">
                <Dialog.Close>
                  <PrimaryButton>Done</PrimaryButton>
                </Dialog.Close>
              </div>
            </Match>

            <Match when={state() === "error"}>
              <pre class="max-h-40 overflow-auto rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                {errorMsg()}
              </pre>
              <div class="flex justify-end gap-2">
                <Dialog.Close>
                  <WhiteButton>Close</WhiteButton>
                </Dialog.Close>
                <PrimaryButton onClick={() => setState("idle")}>
                  Try again
                </PrimaryButton>
              </div>
            </Match>
          </Switch>
        </div>
      </Dialog.Contents>
    </Dialog>
  );
}
