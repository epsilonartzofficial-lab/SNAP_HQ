# Vibecraft

A survival sandbox for the browser, inspired by Minecraft Java Edition. All code, textures and names are original.

**Version 0.3.2.** Sound effects for nearly everything. Survival with animals and monsters, melee combat, armor, beds, furnaces and chests, torches
and real lighting, a biome world generator (39 biomes) and a view distance of up to 64 chunks (full blocks
out to 16, simplified distant terrain beyond). Creative mode keeps flight and unlimited blocks. A developer
console (`/` or T) and panel (F4) help with testing.

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
npm test             # 115 unit tests for the rules (Node 22, no dependencies)
npm run e2e          # 13 browser scenarios in headless Chromium (needs Playwright)
node tests/e2e-world.mjs   # 5 lighting and world-system browser scenarios
node tests/lighting.mjs    # 16 lighting engine tests
npm run build        # dist/vibecraft.html (single offline file) and dist/artifact.html
```

| Path | Contents |
|---|---|
| `js/core.js` | Namespace, constants, seeded random and noise |
| `js/blocks.js`, `js/items.js` | Block and item registries, mining rules, tool stats |
| `js/inventory.js`, `js/crafting.js`, `js/survival.js` | Pure game rules, unit-tested in Node |
| `js/worldgen.js`, `js/worldgen2.js` | Classic generator (v1, protected by golden hashes) and the Biomes generator (v2) |
| `js/mobs.js`, `js/mob-models.js` | Creatures: spawning, AI, combat; their models |
| `js/audio.js` | Synthesized sound effects (Web Audio) |
| `js/lighting.js`, `js/farterrain.js` | Sky and block light; distant terrain beyond 16 chunks |
| `js/save.js` | World list, save format v2, v0.1 migration, export and import |
| `js/textures.js`, `js/render.js` | Procedural art, three.js rendering |
| `js/world.js`, `js/entities.js` | Chunks, edits, streaming, dropped items |
| `js/ui.js`, `js/game.js` | Screens and HUD; game controller and input |
| `releases/0.1/` | The original single-file creative version, still playable |
| `docs/` | [Roadmap](docs/ROADMAP.md), [feature checklist](docs/FEATURES.md), [biome design](docs/BIOMES.md), [reference notes](docs/research/REFERENCE-NOTES.md) |

three.js r128 is vendored in `vendor/` under its MIT license.
