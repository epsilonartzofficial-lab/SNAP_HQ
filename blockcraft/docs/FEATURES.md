# Blockcraft feature checklist

Three states only:

- **Working**: implemented and tested end to end, in the browser and by automated tests where noted.
- **Partial**: exists but incomplete, untested in some way that matters, or different from the reference.
- **Missing**: not implemented. A texture, menu entry, data row or code stub alone never counts as Working.

Reference: Minecraft Java Edition 26.3 (stable). "Ref" notes say how Blockcraft differs.
Last updated: Stage 1 (v0.2.0). Test evidence: `npm test` (Node unit tests), `npm run e2e` (headless Chromium),
plus manual play in headless Chromium screenshots. No physical phone or tablet has been tested.

## Baseline audit of v0.1 (before Stage 1)

Checked by reading the code and running it in headless Chromium (September 2026).

| Claim in the v0.1 report | Finding |
|---|---|
| Seeded, endlessly expanding terrain | Working. Chunks stream around the player. Now protected by golden-hash tests. |
| Several broad biome types | Partial. There is no biome system: one height function with height bands (beach, snowy peaks), a desert mask and forest density. |
| Caves and ores | Working, simple: noise tunnels and caverns, single-block ores with no veins. |
| 19 block types | Working in Creative. None had hardness, drops or tool rules. |
| Mining and placement | Working in Creative only: instant, no drops. |
| Creative inventory and hotbar | Partial. A block palette for the hotbar, no stacks and no item inventory. |
| Walk, sprint, jump, swim, fly, collision | Working. Sprint was on Shift (not the reference default). No sneaking or climbing. |
| Day and night | Partial. Sky colour and brightness only, no lighting engine. |
| Browser saves | Working for one world only. No world list, versioning or error handling. |
| Desktop mouse controls | Working, with pointer lock and a drag-to-look fallback. |
| Touch controls | Partial. Emulated touch only, never tried on a physical device. |

## Status after Stage 1

_To be completed from Stage 1 test results._
