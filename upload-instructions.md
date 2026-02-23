# Uploading .slp files to slippilab

Base URL: `http://localhost:3000` (or wherever the server is hosted)

---

## Single file — `POST /api/replay`

Send the raw `.slp` bytes as the request body. An optional `note` query parameter
becomes the name of the set in the UI.

Every upload (single or multi-file) creates a **set** (`batch_id`) that groups the
files together. Sets are displayed in the sidebar newest-first and can be renamed.

**JavaScript**
```js
const bytes = fs.readFileSync("game.slp");
const res = await fetch("http://localhost:3000/api/replay?note=tournament+grand+finals", {
  method: "POST",
  body: bytes,
});
const { id, batch_id, duplicate, error } = await res.json();
```

**Python**
```python
import requests

with open("game.slp", "rb") as f:
    res = requests.post(
        "http://localhost:3000/api/replay",
        data=f.read(),
        params={"note": "tournament grand finals"},
    )
result = res.json()
```

**Response**
```json
{
  "id": "SpotlessGiantPeafowl",
  "data": "SpotlessGiantPeafowl",
  "batch_id": "GleamingTinyChicken",
  "duplicate": false
}
```

- `duplicate: true` means this exact file was already uploaded. The `id` returned is the original upload's ID — no new record is created.
- On failure: `{ "error": "<message>" }` with HTTP 500.

---

## Multiple files — `POST /api/replays`

Send as `multipart/form-data`. All files go under the field name `files` and are
stored in the order submitted. An optional `note` field becomes the set name in the UI.

**JavaScript**
```js
const form = new FormData();
form.append("note", "week 3 session");
form.append("files", new Blob([fs.readFileSync("game1.slp")]), "game1.slp");
form.append("files", new Blob([fs.readFileSync("game2.slp")]), "game2.slp");
form.append("files", new Blob([fs.readFileSync("game3.slp")]), "game3.slp");

const res = await fetch("http://localhost:3000/api/replays", {
  method: "POST",
  body: form,
});
const { batch_id, data } = await res.json();
```

**Python**
```python
import requests

files = [
    ("files", ("game1.slp", open("game1.slp", "rb"), "application/octet-stream")),
    ("files", ("game2.slp", open("game2.slp", "rb"), "application/octet-stream")),
    ("files", ("game3.slp", open("game3.slp", "rb"), "application/octet-stream")),
]
res = requests.post(
    "http://localhost:3000/api/replays",
    data={"note": "week 3 session"},
    files=files,
)
result = res.json()
batch_id = result["batch_id"]
```

**Response**
```json
{
  "batch_id": "GleamingTinyChicken",
  "data": [
    { "id": "SpotlessGiantPeafowl", "duplicate": false, "error": null },
    { "id": "RadiantSmallFlamingo", "duplicate": false, "error": null },
    { "id": "SpotlessGiantPeafowl", "duplicate": true,  "error": null }
  ]
}
```

- Results are returned in the same order the files were submitted.
- `duplicate: true` means that file was already in the database. The existing ID is returned and no new record is created.
- Per-file errors are returned in `error` and do not abort the rest of the batch.

---

## Downloading a replay — `GET /api/replay/<filename>`

The filename is the `id` returned from upload with `.slp` appended.

```js
const res = await fetch("http://localhost:3000/api/replay/SpotlessGiantPeafowl.slp");
const bytes = await res.arrayBuffer();
```

```python
res = requests.get("http://localhost:3000/api/replay/SpotlessGiantPeafowl.slp")
slp_bytes = res.content
```

Returns the raw `.slp` bytes with HTTP 200, or HTTP 404 if not found.

---

## Listing all replays — `GET /api/replays`

```js
const res = await fetch("http://localhost:3000/api/replays");
const { data } = await res.json();
```

**Response**
```json
{
  "data": [
    {
      "id": "SpotlessGiantPeafowl",
      "file_name": "SpotlessGiantPeafowl.slp",
      "created_at": "2024-01-01 12:00:00",
      "played_on": "2024-01-01T11:59:00Z",
      "num_frames": 3600,
      "external_stage_id": 2,
      "is_teams": 0,
      "batch_id": "GleamingTinyChicken",
      "batch_order": 0,
      "file_hash": "e3b0c44298fc1c149afb...",
      "players": [
        {
          "player_index": 0,
          "connect_code": "ABCD#123",
          "display_name": "Player 1",
          "nametag": "",
          "external_character_id": 20,
          "team_id": 0
        }
      ]
    }
  ]
}
```

Replays within the same `batch_id` were uploaded together and are ordered by `batch_order`.

---

## Listing sets — `GET /api/sets`

Returns all sets (uploads grouped together) newest-first, with each set's replays
ordered by upload position.

```js
const res = await fetch("http://localhost:3000/api/sets");
const { data } = await res.json();
```

**Response**
```json
{
  "data": [
    {
      "id": "GleamingTinyChicken",
      "created_at": "2024-01-01 12:00:00",
      "name": "tournament grand finals",
      "replays": [
        {
          "id": "SpotlessGiantPeafowl",
          "file_name": "SpotlessGiantPeafowl.slp",
          "batch_order": 0,
          "...": "same fields as /api/replays"
        }
      ]
    }
  ]
}
```

---

## Renaming a set — `PATCH /api/set/<set_id>`

```js
await fetch("http://localhost:3000/api/set/GleamingTinyChicken", {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "grand finals set 1" }),
});
```

**Response:** `{ "ok": true }`
