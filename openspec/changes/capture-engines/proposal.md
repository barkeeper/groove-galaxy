## Why

The first video-to-dance retarget used a shortest-arc swing solve per bone, which left each bone's
**roll/twist unpinned** — hands twisted behind/through the body and footwork was wrong. We want a
higher-quality result and a way to compare approaches, so the user can pick the best per video.

## What Changes

- **Rewrite the builtin engine** (`retarget.mjs`) to a **bend-plane basis solver**: each limb bone's
  world rotation is built from a full orthonormal basis (primary = bone direction, hinge local axis =
  the joint bend normal `upperDir × lowerDir`), so elbows/knees bend in the observed plane and roll is
  pinned. Learned from the existing VRMAs that the rest pose is T-pose (arms ±X) and the knee hinge is
  local X.
- **Add a second engine** (`retarget-kalido.mjs`) using the **Kalidokit** Pose solver (MIT), which
  consumes 3D world + 2D image landmarks and returns clean local Euler rotations for hips/spine/arms/
  legs/wrists.
- **Shared `common.mjs`**: landmark load, axis convert, image-space hip translation, FK foot leveling,
  zero-phase smoothing, and pack — used by both engines.
- **Orchestrator**: `run.mjs --engine builtin|kalido` routes the retarget; `--reuse <id>` retargets a
  second dance from an existing capture (landmarks + audio) without re-downloading/posing.
- Deliver two comparison dances from the same capture: **PokemonBuiltin** and **PokemonKolido**
  (replacing the old `pokedance`). Both feet-free.

## Capabilities

### Modified Capabilities
- `video-to-dance`: the retarget step gains a roll-correct solver and a selectable second engine.

## Impact

- New dep: `kalidokit` (npm, MIT). New files: `tools/video-to-dance/common.mjs`,
  `retarget-kalido.mjs`; rewritten `retarget.mjs`; `run.mjs` gains `--engine`/`--reuse`.
- New assets: `assets/vrma/PokemonBuiltin.vrma`, `PokemonKolido.vrma`, `music/Pokemon*.mp3`.
- Removed `pokedance` (assets + wiring). No backend, no recurring cost.
