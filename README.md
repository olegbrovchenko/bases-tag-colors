# Bases Local Colors

Per-base color configs for Obsidian Bases views via sibling `*.colors.json` files.
No global tag-soup. Colors travel with your base, not with your plugin settings.

**v1.1** — Settings UI: color picker + hex input + search bar, all inside Obsidian Settings.

---

## Install

Copy the plugin folder to `.obsidian/plugins/bases-local-colors/`, then:
```
cd .obsidian/plugins/bases-local-colors
npm install && npm run build
```
Enable in **Settings → Community plugins → Bases Local Colors**.

---

## How to add a color for a new value

1. Open the `.base` file whose pill you want to color.
2. Run **"Bases Local Colors: Open color config for current base"** — creates a sibling `*.colors.json` if it doesn't exist.
3. Edit the JSON. Example:

```json
{
  "version": 1,
  "columns": {
    "note.action": {
      "B-Roll": "#78b7b8",
      "VFX":    "#9a5cb8"
    },
    "*": {
      "Wide": "#3a8c5c"
    }
  }
}
```

- `"note.action"` → applies only to pills in the `action` column
- `"*"` → applies to matching pills in any column of this base
- Column match wins over `*` when both exist for the same value

Save the file — colors apply within 100ms without reloading Obsidian.

---

## Settings UI (v1.1)

Open **Settings → Community Plugins → Bases Local Colors** (gear icon).

- **Base selector** — auto-detects the active base; pick any other from the dropdown
- **Search bar** — filter values by name instantly (useful for large bases with many tags)
- **Per-value row** — colored swatch · column badge · value name · color picker · hex input · remove button
- **Add value** — type a name, pick a color, click `+ Add`
- **Import from active base** — pulls all visible pill values into the list with placeholder colors (only adds new ones, never overwrites existing)

Every change saves to the sibling `.colors.json` and applies live to any open base view.

---

## Commands

| Command | What it does |
|---|---|
| **Open color config for current base** | Opens `*.colors.json` sibling (creates skeleton if missing) |
| **Seed config from current base values** | Walks rendered pills, fills placeholder colors, writes JSON |
| **Reload color config** | Re-reads `*.colors.json` and re-applies to active base |
| **Migrate from colored-bases-properties (current base)** | Reads old plugin's `data.json`, copies colors for visible pills, writes to sibling JSON |

---

## Schema

```
projects/MyBase.base
projects/MyBase.colors.json   ← sibling, same folder
```

**`colors.json` shape:**
```json
{
  "version": 1,
  "columns": {
    "<property-name or *>": {
      "<raw pill text>": "<hex color>"
    }
  }
}
```

- `version` must be `1`
- Keys under `columns` are the property (column) names from your base, or `"*"` for any column
- Values are the exact text shown inside the pill (before sanitization)
- Colors are CSS hex strings (`#rrggbb`)

---

## Migration from colored-bases-properties

1. Open your `.base` file in Obsidian.
2. Run **"Migrate from colored-bases-properties (current base)"**.
3. Check the generated `*.colors.json` — it contains only values visible in this base.
4. Repeat for each base you want to migrate.
5. Disable `colored-bases-properties` when all bases are migrated.

The old plugin's `data.json` is never modified — read-only during migration.

**Rollback:** disable `Bases Local Colors` — `deactivateLeaf` reverts all DOM changes on unload. Re-enable `colored-bases-properties`. No data loss.

---

## Known limitations (v1)

- Single-value cells (plain text, not pills) are not colored — v2 feature
- No in-app color picker — edit the JSON directly or use VS Code
- No formula property coloring
- Inline tag coloring (markdown view) not supported
- Embedded bases (`![[Base.base]]`) not supported
- No auto-color for unconfigured values — intentional, no surprise colors

---

## Uninstall

1. Disable plugin in **Settings → Community plugins**.
2. Delete `.obsidian/plugins/bases-local-colors/`.
3. The `*.colors.json` sibling files remain in your vault (harmless). Delete them manually if desired.
