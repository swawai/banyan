# Banyan Scripts

This directory is split by script side effect, not by implementation detail.

- `build/`: post-build scripts that may mutate generated output or deployment config. These are production-path scripts and are intentionally invoked by `npm run build`.
- `checks/`: read-only checks and reports. Scripts here should not write files.
- `browser-regression/`: browser-driven regression scenarios and local static server helpers.
- `dev/`: local developer entry points, including temp builds and the Hugo dev server wrapper.
- `adapters/`: opt-in deployment or hosting adapters.

Most scripts treat `process.cwd()` as the consuming site root. This keeps the
same script usable from `swaw.com`, `exampleSite`, or another Banyan consumer.
When a script needs theme files, it should derive the theme root from its own
script location instead of assuming the theme lives at `themes/banyan`.

EdgeOne-specific scripts live under `adapters/edgeone/`. They are provided by
the theme because Banyan can emit EdgeOne config, but they remain opt-in and
should be called explicitly from a site's `package.json`.

When adding a script, choose the directory by what it does to the workspace. If
it mutates generated output such as `public/`, it belongs in `build/`. If it
adapts Banyan output to a specific hosting platform, it belongs in `adapters/`.
