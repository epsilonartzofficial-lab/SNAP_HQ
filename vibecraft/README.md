# Blockcraft

A survival sandbox for the browser, inspired by Minecraft Java Edition. All code, textures and names are original.

**Version 0.2.0: Stage 1, the first-day Survival loop.** You can punch trees, craft planks, sticks, a crafting
table and wooden and stone tools, mine with timed breaking and tool tiers, and manage health, hunger and air.
You can die, recover your items and save several worlds. Creative mode keeps flight and unlimited blocks.

## Play

Open `index.html` in a browser, by double-clicking it or from a local web server. No build step is needed.
Fonts load from Google Fonts when online and fall back to system fonts offline.

```
npm run serve        # optional: http://localhost:8080
```

Controls are listed under Settings → Controls in the game. In short: WASD to move, Space to jump, Shift to sneak,
double-tap W to sprint, hold left-click to mine, right-click to place or use, E for the inventory and
Q to drop.

## Develop

```
npm test             # 104 unit tests for the rules (Node 22, no dependencies)
npm run e2e          # 9 browser scenarios in headless Chromium (needs Playwright)
npm run build        # dist/blockcraft.html (single offline file) and dist/artifact.html
```

| Path | Contents |
|---|---|
| `js/core.js` | Namespace, constants, seeded random and noise |
| `js/blocks.js`, `js/items.js` | Block and item registries, mining rules, tool stats |
| `js/inventory.js`, `js/crafting.js`, `js/survival.js` | Pure game rules, unit-tested in Node |
| `js/worldgen.js` | Terrain generator version 1 (unchanged from v0.1, protected by golden hashes) |
| `js/save.js` | World list, save format v2, v0.1 migration, export and import |
| `js/textures.js`, `js/render.js` | Procedural art, three.js rendering |
| `js/world.js`, `js/entities.js` | Chunks, edits, streaming, dropped items |
| `js/ui.js`, `js/game.js` | Screens and HUD; game controller and input |
| `releases/0.1/` | The original single-file creative version, still playable |
| `docs/` | [Roadmap](docs/ROADMAP.md), [feature checklist](docs/FEATURES.md), [biome design](docs/BIOMES.md), [reference notes](docs/research/REFERENCE-NOTES.md) |

three.js r128 is vendored in `vendor/` under its MIT license.
