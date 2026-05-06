# Banyan Scripts

This directory is split by script side effect, not by implementation detail.

- `build/`: post-build scripts that may mutate generated output or deployment config. These are production-path scripts and are intentionally invoked by `npm run build`.
- `checks/`: read-only checks and reports. Scripts here should not write files.
- `browser-regression/`: browser-driven regression scenarios and local static server helpers.
- `dev/`: local developer entry points, including temp builds and the Hugo dev server wrapper.

When adding a script, choose the directory by what it does to the workspace. If it writes `public/`, `edgeone.json`, or deployment headers, it belongs in `build/`.
