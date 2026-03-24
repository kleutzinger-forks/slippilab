import { createMemo, createSignal, Show } from "solid-js";
import * as fflate from "fflate";
import { PrimaryButton, WhiteButton } from "~/components/common/Button";
import { SpinnerCircle } from "~/components/common/SpinnerCircle";
import { downloadReplay } from "~/cloudClient";
import { cloudLibrary, cloudSets, currentSelectionStore } from "~/state/selectionStore";
import { Dialog } from "~/components/common/Dialog";
import { DownloadIcon } from "~/components/common/icons";

export function DownloadDialog() {
  const [state, setState] = createSignal<"idle" | "loading">("idle");

  const currentSet = createMemo(() => {
    if (currentSelectionStore() !== cloudLibrary) return null;
    const stub = currentSelectionStore().data.selectedFileAndStub?.[1];
    if (!stub) return null;
    return cloudSets().find((s) =>
      s.replays.some((r) => r.fileName === stub.fileName)
    ) ?? null;
  });

  async function downloadGame() {
    const file = currentSelectionStore().data.selectedFileAndStub?.[0];
    if (!file) return;
    const element = document.createElement("a");
    const url = URL.createObjectURL(file);
    element.href = url;
    element.setAttribute("download", file.name);
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  }

  async function downloadSet() {
    const set = currentSet();
    if (!set) return;
    setState("loading");
    try {
      const blobs = await Promise.all(
        set.replays.map((r) => downloadReplay(r.fileName))
      );
      const files: fflate.Zippable = {};
      for (let i = 0; i < set.replays.length; i++) {
        const { data } = blobs[i];
        if (data) {
          const buf = await data.arrayBuffer();
          const num = String(i + 1).padStart(2, "0");
          const key = `${num} - ${set.replays[i].fileName}`;
          files[key] = new Uint8Array(buf);
        }
      }
      const zip = fflate.zipSync(files);
      const blob = new Blob([zip], { type: "application/zip" });
      const name = set.name ?? `set-${set.id.slice(0, 8)}`;
      const element = document.createElement("a");
      element.href = URL.createObjectURL(blob);
      element.setAttribute("download", `${name}.zip`);
      element.style.display = "none";
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
    } finally {
      setState("idle");
    }
  }

  return (
    <div class="h-8">
      <Dialog onClose={() => setState("idle")}>
        <Dialog.Trigger>
          <DownloadIcon class="h-8 w-8" title="Download replay" />
        </Dialog.Trigger>
        <Dialog.Title>
          <h2 class="text-lg">Download Replay</h2>
        </Dialog.Title>
        <Dialog.Contents>
          <div
            onkeydown={(e: Event) => e.stopPropagation()}
            onkeyup={(e: Event) => e.stopPropagation()}
          >
            <Show
              when={state() === "idle"}
              fallback={
                <div class="flex flex-col items-center gap-2 py-2">
                  <div class="h-10 w-10">
                    <SpinnerCircle />
                  </div>
                  <p class="text-sm text-slate-500">Building ZIP…</p>
                </div>
              }
            >
              <div class="flex flex-col gap-4">
                <Show when={currentSet()} keyed>
                  {(set) => (
                    <div class="flex items-center justify-between gap-4">
                      <p class="text-sm">
                        Download all{" "}
                        <strong>{set.replays.length}</strong>{" "}
                        {set.replays.length === 1 ? "game" : "games"} in this
                        set as a ZIP
                      </p>
                      <PrimaryButton onClick={downloadSet}>
                        Download Set
                      </PrimaryButton>
                    </div>
                  )}
                </Show>
                <div class="flex items-center justify-between gap-4">
                  <p class="text-sm">
                    Download the current game:{" "}
                    <code class="underline">
                      {
                        currentSelectionStore().data
                          .selectedFileAndStub?.[0].name
                      }
                    </code>
                  </p>
                  <WhiteButton onClick={downloadGame}>
                    Download Game
                  </WhiteButton>
                </div>
              </div>
            </Show>
            <div class="mt-4 flex w-full justify-end">
              <Dialog.Close>
                <WhiteButton>Cancel</WhiteButton>
              </Dialog.Close>
            </div>
          </div>
        </Dialog.Contents>
      </Dialog>
    </div>
  );
}
