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

## Inter

- Project: Inter
- Version: 4.1
- Repository: <https://github.com/rsms/inter>
- Release archive SHA-256: `9883FDD4A49D4FB66BD8177BA6625EF9A64AA45899767DDE3D36AA425756B11E`
- License: SIL Open Font License 1.1

The starter project distributes the official static `Inter-Medium.ttf` and
`Inter-SemiBold.ttf` release files so browser and native renderers construct identical font
atlases without consulting installed system fonts. The authoritative license text is preserved at
`examples/starter/assets/licenses/Inter-OFL.txt` and must remain with exported font assets.

## npm development dependencies

The complete direct and transitive npm package version, resolved source, integrity, and declared
license inventory is generated in `THIRD_PARTY_DEPENDENCIES.json`. Regenerate and verify it with:

```powershell
npm run licenses:generate
npm run licenses:check
```

Package license files under `node_modules/` remain authoritative. Release packaging must preserve
the required license texts for any dependency that is distributed.
