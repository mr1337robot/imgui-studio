# Third-Party Notices

## Dear ImGui

- Project: Dear ImGui
- Version: 1.92.1
- Repository: <https://github.com/ocornut/imgui>
- Pinned commit: `5d4126876bc10396d4c6511853ff10964414c776`
- License: MIT

Dear ImGui is fetched into a disposable local dependency directory and is not copied into
first-party source by Phase 0. Its upstream `LICENSE.txt` remains authoritative and must be
preserved in release and export dependency notices when Dear ImGui is distributed.

## Emscripten SDK

- Version: 4.0.10
- Repository: <https://github.com/emscripten-core/emsdk>
- Pinned commit: `62a853cd3b3134398ce85cde8bb5cbb2ef0194cb`

Emscripten is development tooling installed under `.tools/` and is not redistributed by the
repository.

## npm development dependencies

The complete direct and transitive npm package version, resolved source, integrity, and declared
license inventory is generated in `THIRD_PARTY_DEPENDENCIES.json`. Regenerate and verify it with:

```powershell
npm run licenses:generate
npm run licenses:check
```

Package license files under `node_modules/` remain authoritative. Release packaging must preserve
the required license texts for any dependency that is distributed.
