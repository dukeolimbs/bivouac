# Bivouac

A starter [FoundryVTT](https://foundryvtt.com/) module: **TypeScript + Vite**, targeting Foundry **v13+** (verified on v14).

> Don't edit this template directly to build a real module. Instead run
> `node ../scripts/new-module.mjs <id> "Title"` from the workspace root to
> stamp out a renamed copy.

## Commands

| Command           | What it does                                                        |
| ----------------- | ------------------------------------------------------------------- |
| `npm install`     | Install dev dependencies (Vite, TypeScript, ESLint).                |
| `npm run build`   | Bundle `src/module.ts` → `dist/module.js`, copy `public/` → `dist/`.|
| `npm run watch`   | Rebuild automatically on every save.                                |
| `npm run link`    | Junction `dist/` into Foundry's modules folder.                     |
| `npm run unlink`  | Remove that junction.                                               |
| `npm run typecheck` | Type-check without emitting.                                      |
| `npm run lint`    | Lint `src/`.                                                        |
| `npm run package` | Build, then zip `dist/` → `module.zip` for manual distribution.     |

## What the template demonstrates

`src/module.ts` shows the patterns you reach for most often:

- **A world setting** registered in the `init` hook (visible under Configure Settings).
- **A settings-menu button** (`registerMenu`) that opens the window below.
- **An `ApplicationV2` + Handlebars window** (`ExampleApp`), the modern v13+ app framework.
- **A rebindable keybinding** (unbound by default) that opens the window.

## Releasing

`.github/workflows/release.yml` publishes a GitHub Release when you push a
version tag:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

It builds, rewrites `module.json` with the tag version and release URLs, zips
the module, and attaches `module.json` + `module.zip`. Users then install from
the **latest manifest URL**:
`https://github.com/<owner>/<repo>/releases/latest/download/module.json`

## Layout

```
bivouac/
├── src/
│   ├── module.ts           Entry point — registers Hooks/settings
│   └── foundry-shim.d.ts   Loose ambient types (replace with fvtt-types)
├── public/                 Copied verbatim into dist/ at build time
│   ├── module.json         The manifest Foundry reads
│   ├── lang/en.json        Localization strings
│   ├── styles/module.css   Styles listed in the manifest
│   └── templates/*.hbs     Handlebars templates
├── vite.config.ts
├── tsconfig.json
└── eslint.config.js
```

## Real type support

The shim types everything as `any`. For full IntelliSense install the
community types:

```powershell
npm i -D github:League-of-Foundry-Developers/foundry-vtt-types#main
```

then add `"fvtt-types"` to `compilerOptions.types` in `tsconfig.json` and
delete `src/foundry-shim.d.ts`.

## Dev loop

1. `npm run watch` (rebuilds on save)
2. In Foundry: enable the module in a world.
3. Edit code → reload the Foundry browser tab to pick up changes.

Foundry can auto-reload CSS/templates if you enable **Hot Reload** in its
config, but JavaScript changes always need a page reload.
