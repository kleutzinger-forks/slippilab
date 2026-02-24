import { createOptions, Select } from "@thisbeyond/solid-select";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { characterNameByExternalId, stageNameByExternalId } from "~/common/ids";
import { Picker } from "~/components/common/Picker";
import { StageBadge } from "~/components/common/Badge";
import { ReplayStub, refreshCloudSets, SelectionStore } from "~/state/selectionStore";
import { clearCloudData, ReplaySet, renameCloudSet } from "~/cloudClient";

const filterProps = createOptions(
  [
    ...characterNameByExternalId.map((name) => ({
      type: "character",
      label: name,
    })),
    ...stageNameByExternalId.map((name) => ({ type: "stage", label: name })),
  ],
  {
    key: "label",
    createable: (code) => ({ type: "codeOrName", label: code }),
  }
);
export function Replays(props: { selectionStore: SelectionStore; sets?: ReplaySet[] }) {
  const hasSets = createMemo(() => props.sets !== undefined && props.sets.length > 0);

  return (
    <>
      <div class="flex max-h-96 w-full flex-col items-center gap-2 overflow-y-auto sm:h-full md:max-h-screen">
        <div
          class="w-full"
          // don't trigger global shortcuts when typing in the filter box
          onkeydown={(e: Event) => e.stopPropagation()}
          onkeyup={(e: Event) => e.stopPropagation()}
        >
          <Select
            class="w-full rounded border border-slate-600 bg-white"
            placeholder="Filter"
            multiple
            {...filterProps}
            initialValue={props.selectionStore.data.filters}
            onChange={props.selectionStore.setFilters}
          />
        </div>
        <Show
          when={hasSets()}
          fallback={
            <Show
              when={props.selectionStore.data.filteredStubs.length > 0}
              fallback={<div>No matching results</div>}
            >
              <Picker
                items={props.selectionStore.data.filteredStubs}
                render={(stub) => <GameInfo replayStub={stub} />}
                onClick={(fileAndSettings) =>
                  props.selectionStore.select(fileAndSettings)
                }
                selected={(stub) =>
                  props.selectionStore.data.selectedFileAndStub?.[1] === stub
                }
                estimateSize={(stub) =>
                  stub.playerSettings.filter(Boolean).length === 4 ? 56 : 32
                }
              />
            </Show>
          }
        >
          <Show
            when={props.selectionStore.data.filteredStubs.length > 0}
            fallback={<div>No matching results</div>}
          >
            <GroupedSetList sets={props.sets!} selectionStore={props.selectionStore} />
          </Show>
        </Show>
      </div>
      <Show when={props.sets !== undefined}>
        <button
          class="mt-2 w-full rounded border border-red-300 py-1 text-xs text-red-400 hover:bg-red-50"
          onClick={async () => {
            if (!confirm("Delete all replays and sets? This cannot be undone.")) return;
            await clearCloudData();
            await refreshCloudSets();
          }}
        >
          Delete all
        </button>
      </Show>
    </>
  );
}

function GroupedSetList(props: { sets: ReplaySet[]; selectionStore: SelectionStore }) {
  const filteredSet = createMemo(() =>
    new Set(props.selectionStore.data.filteredStubs)
  );
  const filtersActive = createMemo(
    () => props.selectionStore.data.filters.length > 0
  );

  return (
    <div class="w-full">
      <For each={props.sets}>
        {(set) => {
          const visibleReplays = createMemo(() => {
            const ordered = [...set.replays].reverse();
            return filtersActive()
              ? ordered.filter((r) => filteredSet().has(r))
              : ordered;
          });
          return (
            <Show when={visibleReplays().length > 0}>
              <SetHeader set={set} />
              <For each={visibleReplays()}>
                {(stub, i) => (
                  <div
                    class="flex w-full cursor-pointer items-center gap-1 pl-4 hover:bg-slate-100"
                    classList={{ "bg-slate-200": props.selectionStore.data.selectedFileAndStub?.[1] === stub }}
                    onClick={() => props.selectionStore.select(stub)}
                  >
                    <span class="shrink-0 text-xs text-slate-400">({i() + 1})</span>
                    <GameInfo replayStub={stub} />
                  </div>
                )}
              </For>
            </Show>
          );
        }}
      </For>
    </div>
  );
}

function SetHeader(props: { set: ReplaySet }) {
  const [editing, setEditing] = createSignal(false);
  const [draftName, setDraftName] = createSignal("");
  let inputRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (editing() && inputRef) inputRef.focus();
  });

  async function commit() {
    const trimmed = draftName().trim();
    await renameCloudSet(props.set.id, trimmed);
    await refreshCloudSets();
    setEditing(false);
  }

  return (
    <div class="flex items-center gap-2 border-t-2 border-slate-400 bg-slate-50 px-2 py-1 text-sm font-semibold text-slate-600">
      <Show
        when={editing()}
        fallback={
          <span
            class="flex-grow cursor-pointer hover:underline"
            onClick={() => {
              setDraftName(props.set.name ?? "");
              setEditing(true);
            }}
          >
            {props.set.name?.trim() || "Unnamed Set"}
          </span>
        }
      >
        <input
          ref={inputRef}
          class="flex-grow rounded border px-1 text-sm"
          value={draftName()}
          onInput={(e) => setDraftName(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      </Show>
      <span class="text-xs font-normal text-slate-400">
        {new Date(
          props.set.replays.map((r) => r.playedOn).filter(Boolean).sort()[0] ??
            props.set.createdAt
        ).toLocaleDateString()}
      </span>
    </div>
  );
}

function GameInfo(props: { replayStub: ReplayStub }) {
  function playerString(player: ReplayStub["playerSettings"][0]): string {
    const name = [player.displayName, player.connectCode, player.nametag].find(
      (s) => s?.length > 0
    );
    const character = characterNameByExternalId[player.externalCharacterId];
    return name !== undefined ? `${name}(${character})` : character;
  }

  const teams = createMemo(() => {
    const teams: ReplayStub["playerSettings"][0][][] = [[], [], []];
    props.replayStub.playerSettings
      .filter(Boolean)
      .forEach((player) => teams[player.teamId ?? 0].push(player));
    return teams.filter((team) => team.length > 0);
  });

  return (
    <>
      <div class="flex w-full items-center">
        <StageBadge stageId={props.replayStub.stageId} />
        <div class="flex flex-grow flex-col items-center">
          {props.replayStub.playerSettings.filter(Boolean).length === 4 ? (
            <For each={teams()}>
              {(team) => <div>{team.map(playerString).join(" + ")}</div>}
            </For>
          ) : (
            props.replayStub.playerSettings
              .filter((s) => s)
              .map(playerString)
              .join(" vs ")
          )}
        </div>
      </div>
    </>
  );
}
