# Tasks — capture-engines

## 1. Learn from existing VRMAs
- [x] 1.1 Inspect frame-0 rotations + bend frames (rest = T-pose arms ±X; knee hinge = local X)

## 2. Shared + builtin engine
- [x] 2.1 `common.mjs`: landmark load, axis convert, hip translation, FK foot leveling, smoothing, pack
- [x] 2.2 Rewrite `retarget.mjs` to a bend-plane basis solver (roll pinned by joint bend normal)

## 3. Kalidokit engine
- [x] 3.1 Install `kalidokit`; import the ES bundle in Node
- [x] 3.2 `retarget-kalido.mjs`: Pose.solve → local quats (euler→quat, facing correction)

## 4. Orchestrator
- [x] 4.1 `run.mjs --engine builtin|kalido` routes the retargeter
- [x] 4.2 `run.mjs --reuse <id>` retargets from an existing capture (landmarks + audio)

## 5. Deliver + verify
- [x] 5.1 Remove old `pokedance`; build `PokemonBuiltin` (fresh capture) + `PokemonKolido` (reuse)
- [x] 5.2 Playwright: both load/play, feet at floor + free, no console errors; screenshot-compare
- [x] 5.3 Static checks; docs (project.md, CHANGELOG.md, README.md); commit; archive
