import { Hono } from "hono";
import { createHash } from "crypto";
import { db, getAllSetsWithReplays, deleteSetWithReplays, clearAllData, getSetReplays } from "../db/index.js";
import { deleteFile, deleteAllFiles, downloadFile, uploadFile } from "../storage/local.js";
import { patchSlpStartAt } from "../../src/common/patchSlpTimestamp.js";

type ColInfo = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
};

function getTables(): string[] {
  return (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as { name: string }[]
  ).map((r) => r.name);
}

function getColumns(table: string): ColInfo[] {
  return db.prepare(`PRAGMA table_info("${table}")`).all() as ColInfo[];
}

function esc(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(title: string, tables: string[], content: string, currentTable?: string, currentSection?: string): string {
  const sidebarLinks = tables
    .map((t) => {
      const active = t === currentTable ? "bg-gray-700 text-white" : "text-gray-400 hover:bg-gray-700 hover:text-white";
      return `<a href="/admin/table/${esc(t)}" class="block px-3 py-1.5 rounded text-sm ${active}">${esc(t)}</a>`;
    })
    .join("");

  const setsActive = currentSection === "sets" ? "bg-gray-700 text-white" : "text-gray-400 hover:bg-gray-700 hover:text-white";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)} – Admin</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-950 text-gray-100 min-h-screen flex flex-col">
  <header class="bg-gray-900 border-b border-gray-700 px-6 py-3 flex items-center gap-4 flex-shrink-0">
    <a href="/admin" class="text-lg font-bold text-white tracking-tight">SlippiLab Admin</a>
  </header>
  <div class="flex flex-1 min-h-0">
    <nav class="w-48 bg-gray-900 border-r border-gray-700 p-4 flex-shrink-0 space-y-4">
      <div>
        <p class="text-xs font-semibold uppercase text-gray-500 mb-2 tracking-wider">Tables</p>
        <div class="space-y-0.5">${sidebarLinks}</div>
      </div>
      <div>
        <p class="text-xs font-semibold uppercase text-gray-500 mb-2 tracking-wider">Tools</p>
        <div class="space-y-0.5">
          <a href="/admin/sets" class="block px-3 py-1.5 rounded text-sm ${setsActive}">Sets Manager</a>
        </div>
      </div>
    </nav>
    <main class="flex-1 p-6 overflow-auto">${content}</main>
  </div>
</body>
</html>`;
}

const admin = new Hono();

// Dashboard
admin.get("/", (c) => {
  const tables = getTables();
  const rows = tables
    .map((t) => {
      const count = (db.prepare(`SELECT COUNT(*) as n FROM "${t}"`).get() as { n: number }).n;
      return `<tr class="border-b border-gray-800 hover:bg-gray-800/50">
        <td class="py-2.5 px-4">
          <a href="/admin/table/${esc(t)}" class="text-blue-400 hover:underline font-medium">${esc(t)}</a>
        </td>
        <td class="py-2.5 px-4 text-gray-400 text-sm">${count} rows</td>
      </tr>`;
    })
    .join("");

  const content = `
    <h2 class="text-xl font-semibold mb-6">Database Overview</h2>
    <div class="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden max-w-md">
      <table class="w-full">
        <thead class="bg-gray-800">
          <tr>
            <th class="py-2 px-4 text-left text-xs uppercase text-gray-500 font-semibold tracking-wider">Table</th>
            <th class="py-2 px-4 text-left text-xs uppercase text-gray-500 font-semibold tracking-wider">Rows</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="2" class="py-6 text-center text-gray-500">No tables found</td></tr>`}</tbody>
      </table>
    </div>`;

  return c.html(layout("Dashboard", tables, content));
});

// List rows
admin.get("/table/:table", (c) => {
  const tableName = c.req.param("table");
  const tables = getTables();
  if (!tables.includes(tableName)) return c.notFound();

  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
  const limit = 50;
  const offset = (page - 1) * limit;
  const search = c.req.query("search") || "";

  const columns = getColumns(tableName);
  const pkCol = columns.find((col) => col.pk === 1)?.name ?? "rowid";

  let rows: Record<string, unknown>[];
  let total: number;

  if (search) {
    const textCols = columns.filter((col) =>
      ["TEXT", "VARCHAR", "CHAR", "CLOB", ""].some((t) => col.type.toUpperCase().includes(t))
    );
    if (textCols.length > 0) {
      const where = textCols.map((col) => `"${col.name}" LIKE ?`).join(" OR ");
      const param = `%${search}%`;
      const params = textCols.map(() => param);
      rows = db.prepare(`SELECT * FROM "${tableName}" WHERE ${where} LIMIT ? OFFSET ?`).all(...params, limit, offset) as Record<string, unknown>[];
      total = (db.prepare(`SELECT COUNT(*) as n FROM "${tableName}" WHERE ${where}`).get(...params) as { n: number }).n;
    } else {
      rows = db.prepare(`SELECT * FROM "${tableName}" LIMIT ? OFFSET ?`).all(limit, offset) as Record<string, unknown>[];
      total = (db.prepare(`SELECT COUNT(*) as n FROM "${tableName}"`).get() as { n: number }).n;
    }
  } else {
    rows = db.prepare(`SELECT * FROM "${tableName}" LIMIT ? OFFSET ?`).all(limit, offset) as Record<string, unknown>[];
    total = (db.prepare(`SELECT COUNT(*) as n FROM "${tableName}"`).get() as { n: number }).n;
  }

  const totalPages = Math.ceil(total / limit) || 1;

  const colHeaders = columns
    .map((col) => `<th class="py-2 px-3 text-left text-xs uppercase text-gray-500 font-semibold tracking-wider whitespace-nowrap">${esc(col.name)}</th>`)
    .join("") + `<th class="py-2 px-3 text-left text-xs uppercase text-gray-500 font-semibold tracking-wider">Actions</th>`;

  const rowsHtml = rows
    .map((row) => {
      const cells = columns
        .map((col) => {
          const val = row[col.name];
          const str = val === null || val === undefined ? "" : String(val);
          const display =
            val === null || val === undefined
              ? `<span class="text-gray-600 italic text-xs">null</span>`
              : `<span class="block max-w-xs truncate" title="${esc(str)}">${esc(str.length > 60 ? str.slice(0, 60) + "…" : str)}</span>`;
          return `<td class="py-2 px-3 text-sm">${display}</td>`;
        })
        .join("");
      const pkVal = row[pkCol];
      const actions = `<td class="py-2 px-3 whitespace-nowrap">
        <a href="/admin/table/${esc(tableName)}/${encodeURIComponent(String(pkVal))}/edit" class="text-blue-400 hover:underline text-sm mr-3">Edit</a>
        <form method="POST" action="/admin/table/${esc(tableName)}/${encodeURIComponent(String(pkVal))}/delete" class="inline" onsubmit="return confirm('Delete this row?')">
          <button type="submit" class="text-red-400 hover:underline text-sm">Delete</button>
        </form>
      </td>`;
      return `<tr class="border-b border-gray-800 hover:bg-gray-800/50">${cells}${actions}</tr>`;
    })
    .join("");

  const pageBase = `/admin/table/${esc(tableName)}?search=${encodeURIComponent(search)}&page=`;
  const pagination = `
    <div class="flex items-center gap-4 mt-4 text-sm text-gray-400">
      <span>${total} row${total !== 1 ? "s" : ""}</span>
      <div class="flex items-center gap-2">
        ${page > 1 ? `<a href="${pageBase}${page - 1}" class="text-blue-400 hover:underline">← Prev</a>` : `<span class="text-gray-700">← Prev</span>`}
        <span>Page ${page} / ${totalPages}</span>
        ${page < totalPages ? `<a href="${pageBase}${page + 1}" class="text-blue-400 hover:underline">Next →</a>` : `<span class="text-gray-700">Next →</span>`}
      </div>
    </div>`;

  const content = `
    <div class="flex items-center justify-between mb-5">
      <h2 class="text-xl font-semibold">${esc(tableName)}</h2>
      <a href="/admin/table/${esc(tableName)}/new" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-sm font-medium">+ Add Row</a>
    </div>
    <form method="GET" class="mb-4 flex gap-2">
      <input type="text" name="search" value="${esc(search)}" placeholder="Search text columns…"
        class="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 w-64">
      <button type="submit" class="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded text-sm">Search</button>
      ${search ? `<a href="/admin/table/${esc(tableName)}" class="text-gray-400 hover:text-white px-2 py-1.5 text-sm">Clear</a>` : ""}
    </form>
    <div class="bg-gray-900 rounded-lg border border-gray-700 overflow-x-auto">
      <table class="w-full">
        <thead class="bg-gray-800"><tr>${colHeaders}</tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="${columns.length + 1}" class="py-8 text-center text-gray-500">No rows</td></tr>`}</tbody>
      </table>
    </div>
    ${pagination}`;

  return c.html(layout(tableName, tables, content, tableName));
});

// Edit form
admin.get("/table/:table/:id/edit", (c) => {
  const tableName = c.req.param("table");
  const tables = getTables();
  if (!tables.includes(tableName)) return c.notFound();

  const columns = getColumns(tableName);
  const pkCol = columns.find((col) => col.pk === 1)?.name ?? "rowid";
  const id = c.req.param("id");

  const row = db.prepare(`SELECT * FROM "${tableName}" WHERE "${pkCol}" = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return c.notFound();

  const fields = columns
    .map((col) => {
      const val = row[col.name];
      const isPk = col.pk === 1;
      const meta = [col.type, isPk ? "PK" : null, col.notnull ? "NOT NULL" : null]
        .filter(Boolean)
        .join(" · ");
      return `
        <div class="mb-5">
          <label class="block text-sm font-medium text-gray-300 mb-1">
            ${esc(col.name)}
            <span class="text-xs text-gray-500 ml-1.5 font-normal">${esc(meta)}</span>
          </label>
          ${
            isPk
              ? `<input type="text" value="${esc(val)}" disabled
                  class="w-full bg-gray-800/40 border border-gray-700 rounded px-3 py-2 text-sm text-gray-500 cursor-not-allowed">`
              : `<textarea name="${esc(col.name)}" rows="2"
                  class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono resize-y">${esc(val ?? "")}</textarea>`
          }
        </div>`;
    })
    .join("");

  const content = `
    <div class="flex items-center gap-3 mb-5">
      <a href="/admin/table/${esc(tableName)}" class="text-gray-400 hover:text-white text-sm">← ${esc(tableName)}</a>
      <span class="text-gray-700">/</span>
      <h2 class="text-xl font-semibold">Edit Row</h2>
    </div>
    <form method="POST" action="/admin/table/${esc(tableName)}/${encodeURIComponent(id)}" class="max-w-2xl">
      ${fields}
      <div class="flex gap-3 mt-6 pt-4 border-t border-gray-800">
        <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium">Save Changes</button>
        <a href="/admin/table/${esc(tableName)}" class="text-gray-400 hover:text-white px-4 py-2 text-sm">Cancel</a>
      </div>
    </form>`;

  return c.html(layout(`Edit – ${tableName}`, tables, content, tableName));
});

// Update row
admin.post("/table/:table/:id", async (c) => {
  const tableName = c.req.param("table");
  const tables = getTables();
  if (!tables.includes(tableName)) return c.notFound();

  const columns = getColumns(tableName);
  const pkCol = columns.find((col) => col.pk === 1)?.name ?? "rowid";
  const id = c.req.param("id");

  const body = await c.req.parseBody();
  const editableCols = columns.filter((col) => col.pk !== 1);

  if (editableCols.length > 0) {
    const sets = editableCols.map((col) => `"${col.name}" = ?`).join(", ");
    const values = editableCols.map((col) => {
      const v = body[col.name] as string | undefined;
      return v === "" || v === undefined ? null : v;
    });
    db.prepare(`UPDATE "${tableName}" SET ${sets} WHERE "${pkCol}" = ?`).run(...values, id);
  }

  return c.redirect(`/admin/table/${tableName}`);
});

// Delete row
admin.post("/table/:table/:id/delete", (c) => {
  const tableName = c.req.param("table");
  const tables = getTables();
  if (!tables.includes(tableName)) return c.notFound();

  const columns = getColumns(tableName);
  const pkCol = columns.find((col) => col.pk === 1)?.name ?? "rowid";
  const id = c.req.param("id");

  db.prepare(`DELETE FROM "${tableName}" WHERE "${pkCol}" = ?`).run(id);
  return c.redirect(`/admin/table/${tableName}`);
});

// New row form
admin.get("/table/:table/new", (c) => {
  const tableName = c.req.param("table");
  const tables = getTables();
  if (!tables.includes(tableName)) return c.notFound();

  const columns = getColumns(tableName);

  const fields = columns
    .map((col) => {
      const isIntPk = col.pk === 1 && col.type.toUpperCase() === "INTEGER";
      const meta = [col.type, col.pk === 1 ? "PK" : null, col.notnull ? "NOT NULL" : null]
        .filter(Boolean)
        .join(" · ");
      return `
        <div class="mb-5">
          <label class="block text-sm font-medium text-gray-300 mb-1">
            ${esc(col.name)}
            <span class="text-xs text-gray-500 ml-1.5 font-normal">${esc(meta)}</span>
          </label>
          ${
            isIntPk
              ? `<input type="text" placeholder="auto" disabled
                  class="w-full bg-gray-800/40 border border-gray-700 rounded px-3 py-2 text-sm text-gray-500 cursor-not-allowed">`
              : `<textarea name="${esc(col.name)}" rows="2"
                  class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono resize-y"></textarea>`
          }
        </div>`;
    })
    .join("");

  const content = `
    <div class="flex items-center gap-3 mb-5">
      <a href="/admin/table/${esc(tableName)}" class="text-gray-400 hover:text-white text-sm">← ${esc(tableName)}</a>
      <span class="text-gray-700">/</span>
      <h2 class="text-xl font-semibold">New Row</h2>
    </div>
    <form method="POST" action="/admin/table/${esc(tableName)}/new" class="max-w-2xl">
      ${fields}
      <div class="flex gap-3 mt-6 pt-4 border-t border-gray-800">
        <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium">Create Row</button>
        <a href="/admin/table/${esc(tableName)}" class="text-gray-400 hover:text-white px-4 py-2 text-sm">Cancel</a>
      </div>
    </form>`;

  return c.html(layout(`New – ${tableName}`, tables, content, tableName));
});

// Create row
admin.post("/table/:table/new", async (c) => {
  const tableName = c.req.param("table");
  const tables = getTables();
  if (!tables.includes(tableName)) return c.notFound();

  const columns = getColumns(tableName);
  const body = await c.req.parseBody();

  // Skip INTEGER PKs (auto-increment), include TEXT PKs
  const insertCols = columns.filter(
    (col) => !(col.pk === 1 && col.type.toUpperCase() === "INTEGER")
  );

  const colNames = insertCols.map((col) => `"${col.name}"`).join(", ");
  const placeholders = insertCols.map(() => "?").join(", ");
  const values = insertCols.map((col) => {
    const v = body[col.name] as string | undefined;
    return v === "" || v === undefined ? null : v;
  });

  db.prepare(`INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders})`).run(...values);
  return c.redirect(`/admin/table/${tableName}`);
});

// Sets Manager
admin.get("/sets", (c) => {
  const tables = getTables();
  const sets = getAllSetsWithReplays();

  const rows = sets
    .map((set) => {
      const displayName = set.name?.trim() || "Unnamed Set";
      const replayCount = set.replays.length;
      return `<tr class="border-b border-gray-800 hover:bg-gray-800/50">
        <td class="py-2.5 px-4 font-medium">${esc(displayName)}</td>
        <td class="py-2.5 px-4 text-gray-400 text-sm">${esc(set.created_at)}</td>
        <td class="py-2.5 px-4 text-gray-400 text-sm">${replayCount} replay${replayCount !== 1 ? "s" : ""}</td>
        <td class="py-2.5 px-4 whitespace-nowrap">
          <a href="/admin/sets/${encodeURIComponent(set.id)}/correct-time" class="text-blue-400 hover:underline text-sm mr-3">Correct Time</a>
          <form method="POST" action="/admin/sets/${encodeURIComponent(set.id)}/delete" class="inline"
            onsubmit="return confirm('Delete set \\'${esc(displayName)}\\' and all its replays? This cannot be undone.')">
            <button type="submit" class="text-red-400 hover:underline text-sm">Delete Set</button>
          </form>
        </td>
      </tr>`;
    })
    .join("");

  const content = `
    <h2 class="text-xl font-semibold mb-2">Sets Manager</h2>
    <p class="text-gray-400 text-sm mb-5">Delete a set and all its associated replay files and database records.</p>
    <div class="bg-gray-900 rounded-lg border border-gray-700 overflow-x-auto mb-10">
      <table class="w-full">
        <thead class="bg-gray-800">
          <tr>
            <th class="py-2 px-4 text-left text-xs uppercase text-gray-500 font-semibold tracking-wider">Name</th>
            <th class="py-2 px-4 text-left text-xs uppercase text-gray-500 font-semibold tracking-wider">Created</th>
            <th class="py-2 px-4 text-left text-xs uppercase text-gray-500 font-semibold tracking-wider">Replays</th>
            <th class="py-2 px-4 text-left text-xs uppercase text-gray-500 font-semibold tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="4" class="py-8 text-center text-gray-500">No sets found</td></tr>`}</tbody>
      </table>
    </div>
    <div class="border border-red-900 rounded-lg p-5 max-w-md">
      <h3 class="text-red-400 font-semibold mb-1">Danger Zone</h3>
      <p class="text-gray-400 text-sm mb-4">Permanently delete all sets, replays, and .slp files. This cannot be undone.</p>
      <form method="POST" action="/admin/sets/clear-all" onsubmit="return confirm('Delete ALL sets, replays, and files? This cannot be undone.')">
        <button type="submit" class="bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded text-sm font-medium">Clear All Data</button>
      </form>
    </div>`;

  return c.html(layout("Sets Manager", tables, content, undefined, "sets"));
});

admin.post("/sets/clear-all", async (c) => {
  const files = deleteAllFiles();
  const counts = clearAllData();
  console.log(`[admin/sets] cleared all data: ${counts.replays} replay(s), ${counts.sets} set(s), ${files.length} file(s)`);
  return c.redirect("/admin/sets");
});

admin.post("/sets/:id/delete", async (c) => {
  const id = c.req.param("id");
  const { fileNames } = deleteSetWithReplays(id);
  for (const fileName of fileNames) {
    await deleteFile(fileName);
  }
  console.log(`[admin/sets] deleted set ${id}, removed ${fileNames.length} file(s)`);
  return c.redirect("/admin/sets");
});

// Correct Time: ask the user when the first game of this set actually happened
// (in their local time) and shift every replay's startAt by the same offset.
admin.get("/sets/:id/correct-time", (c) => {
  const id = c.req.param("id");
  const tables = getTables();
  const setRow = db
    .prepare("SELECT * FROM sets WHERE id = ?")
    .get(id) as { id: string; name: string | null; created_at: string } | undefined;
  if (!setRow) return c.notFound();

  const replays = getSetReplays(id);
  if (replays.length === 0) {
    return c.html(layout("Correct Time", tables, `
      <div class="flex items-center gap-3 mb-5">
        <a href="/admin/sets" class="text-gray-400 hover:text-white text-sm">← Sets Manager</a>
      </div>
      <p class="text-gray-400">This set has no replays.</p>`, undefined, "sets"));
  }

  const displayName = setRow.name?.trim() || "Unnamed Set";
  const firstReplay = replays[0]!;
  const firstPlayedOn = firstReplay.played_on;

  if (!firstPlayedOn) {
    return c.html(layout("Correct Time", tables, `
      <div class="flex items-center gap-3 mb-5">
        <a href="/admin/sets" class="text-gray-400 hover:text-white text-sm">← Sets Manager</a>
        <span class="text-gray-700">/</span>
        <h2 class="text-xl font-semibold">${esc(displayName)}</h2>
      </div>
      <p class="text-red-400">First replay has no startAt timestamp; cannot compute a correction offset.</p>`, undefined, "sets"));
  }

  const replayRows = replays
    .map((r, i) => `<tr class="border-b border-gray-800">
      <td class="py-1.5 px-3 text-sm">${i + 1}</td>
      <td class="py-1.5 px-3 text-sm font-mono text-gray-400">${esc(r.played_on ?? "—")}</td>
      <td class="py-1.5 px-3 text-sm font-mono text-gray-500" data-original-iso="${esc(r.played_on ?? "")}" data-preview-cell></td>
    </tr>`)
    .join("");

  const content = `
    <div class="flex items-center gap-3 mb-5">
      <a href="/admin/sets" class="text-gray-400 hover:text-white text-sm">← Sets Manager</a>
      <span class="text-gray-700">/</span>
      <h2 class="text-xl font-semibold">Correct Time – ${esc(displayName)}</h2>
    </div>

    <p class="text-gray-400 text-sm mb-5 max-w-2xl">
      Enter when the <strong>first game</strong> of this set actually happened (in your local time).
      Every replay in the set will be shifted by the same offset, both in the database and inside
      the .slp file's metadata.
    </p>

    <form method="POST" action="/admin/sets/${esc(id)}/correct-time" id="correct-form" class="max-w-2xl mb-8"
      onsubmit="return confirm('Patch ' + ${replays.length} + ' replay file(s) and update their timestamps?')">
      <div class="mb-4">
        <label class="block text-sm font-medium text-gray-300 mb-1">First game's stored timestamp (UTC)</label>
        <input type="text" value="${esc(firstPlayedOn)}" disabled
          class="w-full bg-gray-800/40 border border-gray-700 rounded px-3 py-2 text-sm text-gray-500 font-mono cursor-not-allowed">
      </div>
      <div class="mb-4">
        <label class="block text-sm font-medium text-gray-300 mb-1">Corrected first-game time (your local time)</label>
        <input type="datetime-local" id="local-input" step="1" required
          class="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono">
        <p class="text-xs text-gray-500 mt-1">Pre-filled with the existing timestamp converted to your local time.</p>
      </div>
      <input type="hidden" name="corrected_iso" id="corrected-iso">
      <div class="flex gap-3 mt-6 pt-4 border-t border-gray-800">
        <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium">Apply Correction</button>
        <a href="/admin/sets" class="text-gray-400 hover:text-white px-4 py-2 text-sm">Cancel</a>
      </div>
    </form>

    <h3 class="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-2">Replays in this set (${replays.length})</h3>
    <div class="bg-gray-900 rounded-lg border border-gray-700 overflow-x-auto max-w-3xl">
      <table class="w-full">
        <thead class="bg-gray-800">
          <tr>
            <th class="py-2 px-3 text-left text-xs uppercase text-gray-500 font-semibold tracking-wider">#</th>
            <th class="py-2 px-3 text-left text-xs uppercase text-gray-500 font-semibold tracking-wider">Current played_on</th>
            <th class="py-2 px-3 text-left text-xs uppercase text-gray-500 font-semibold tracking-wider">Preview after correction</th>
          </tr>
        </thead>
        <tbody>${replayRows}</tbody>
      </table>
    </div>

    <script>
      (function () {
        var firstUtc = ${JSON.stringify(firstPlayedOn)};
        var localInput = document.getElementById('local-input');
        var hidden = document.getElementById('corrected-iso');
        var form = document.getElementById('correct-form');
        var previewCells = document.querySelectorAll('[data-preview-cell]');

        function pad(n) { return String(n).padStart(2, '0'); }
        function toLocalInput(d) {
          return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
            + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
        }
        function shortIso(d) {
          return d.toISOString().slice(0, 19) + 'Z';
        }

        var firstDate = new Date(firstUtc);
        if (!isNaN(firstDate.getTime())) {
          localInput.value = toLocalInput(firstDate);
        }

        function refreshPreview() {
          if (!localInput.value) return;
          var corrected = new Date(localInput.value);
          if (isNaN(corrected.getTime())) return;
          var offsetMs = corrected.getTime() - firstDate.getTime();
          previewCells.forEach(function (cell) {
            var iso = cell.getAttribute('data-original-iso');
            if (!iso) { cell.textContent = '—'; return; }
            var d = new Date(iso);
            if (isNaN(d.getTime())) { cell.textContent = '—'; return; }
            cell.textContent = shortIso(new Date(d.getTime() + offsetMs));
          });
        }

        localInput.addEventListener('input', refreshPreview);
        refreshPreview();

        form.addEventListener('submit', function () {
          if (!localInput.value) return;
          var d = new Date(localInput.value);
          if (!isNaN(d.getTime())) hidden.value = d.toISOString();
        });
      })();
    </script>`;

  return c.html(layout(`Correct Time – ${displayName}`, tables, content, undefined, "sets"));
});

admin.post("/sets/:id/correct-time", async (c) => {
  const id = c.req.param("id");
  const replays = getSetReplays(id);
  if (replays.length === 0) return c.notFound();

  const firstReplay = replays[0]!;
  if (!firstReplay.played_on) {
    return c.text("First replay has no played_on timestamp; cannot compute offset.", 400);
  }

  const body = await c.req.parseBody();
  const correctedIso = String(body.corrected_iso ?? "").trim();
  if (!correctedIso) return c.text("Missing corrected timestamp.", 400);

  const correctedDate = new Date(correctedIso);
  if (isNaN(correctedDate.getTime())) return c.text("Invalid corrected timestamp.", 400);

  const originalFirst = new Date(firstReplay.played_on);
  if (isNaN(originalFirst.getTime())) {
    return c.text("Could not parse first replay's played_on.", 400);
  }

  const offsetMs = correctedDate.getTime() - originalFirst.getTime();

  const updateStmt = db.prepare(
    "UPDATE replays SET played_on = ?, file_hash = ? WHERE id = ?"
  );

  let patched = 0;
  let dbOnly = 0;
  let missing = 0;

  for (const replay of replays) {
    if (!replay.played_on) continue;
    const orig = new Date(replay.played_on);
    if (isNaN(orig.getTime())) continue;

    const newDate = new Date(orig.getTime() + offsetMs);
    const newIsoFull = newDate.toISOString();
    // Match the format the original file/DB used (20-char vs 24-char) for the
    // DB write so unpatched and patched rows stay consistent.
    const newPlayedOn =
      replay.played_on.length === 20 ? newIsoFull.slice(0, 19) + "Z" : newIsoFull;

    const bytes = await downloadFile(replay.file_name);
    if (!bytes) {
      console.warn(`[admin/correct-time] missing file: ${replay.file_name}`);
      missing++;
      continue;
    }

    const newBytes = patchSlpStartAt(bytes, replay.played_on, newIsoFull);
    if (!newBytes) {
      console.warn(`[admin/correct-time] startAt not found in ${replay.file_name}; updating DB only`);
      updateStmt.run(newPlayedOn, replay.file_hash, replay.id);
      dbOnly++;
      continue;
    }

    await uploadFile(replay.file_name, newBytes);
    const newHash = createHash("sha256").update(newBytes).digest("hex");
    updateStmt.run(newPlayedOn, newHash, replay.id);
    patched++;
  }

  console.log(
    `[admin/correct-time] set=${id} offsetMs=${offsetMs} patched=${patched} dbOnly=${dbOnly} missing=${missing}`
  );
  return c.redirect("/admin/sets");
});

export default admin;
