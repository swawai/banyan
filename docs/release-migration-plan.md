# Banyan Theme Release Migration Plan

This plan tracks the move from "theme developed inside swaw.com" to a releasable
Banyan theme. The goal is not to move every root file into the theme. The goal is
to preserve the right owner for each fact.

## Ownership Rules

- Theme-owned: layouts, partials, shortcodes, assets, scripts, default fragments,
  default PWA resources, docs, and generic starter configuration.
- Site-owned: domain, brand, legal footer, SEO copy, real products, real posts,
  real images, deployment identity, and local content overrides.
- Example-owned: small demo content that proves the theme works for a new site.

The practical test is simple: if another site receives the file and would look
like swaw.com, the file is not theme-owned.

## Phase 0: Baseline

Purpose: keep a known-good reference before making release changes.

Checks:

- Build the root site into `temp_workspace/public/<timestamp>-release-audit`.
- Run `check-public-html.mjs` against that build with `--check`.
- Run `report-assets.mjs` against that build.
- Record any dirty root-site content before editing theme files.

Acceptance:

- Root site still builds from root content.
- Existing user edits under `content/` are not overwritten.
- The release work does not depend on `themes/banyan/exampleSite` content until
  the example site is intentionally rebuilt.

Current baseline recorded on 2026-06-11:

- Root build: `temp_workspace/public/2606111022-release-audit`.
- `check-public-html.mjs temp_workspace/public/2606111022-release-audit --check`
  passed against 96 HTML files.
- `check-agent-readiness.mjs temp_workspace/public/2606111022-release-audit --check`
  passed with 21 advertised Markdown mirrors.
- `report-assets.mjs temp_workspace/public/2606111022-release-audit` reported
  304 files and 9.20 MiB of output.
- `npm run check:browser:latest-temp` passed 10/10 browser scenarios.
- `npm run check:browser:speculation:latest-temp` passed 3/3 speculation
  scenarios. The current root build has the Speculation-Rules header path
  disabled, so this verifies the disabled-state contract.
- Dirty worktree note before release edits: `_ex_repo/` was the only
  untracked path. The release audit did not depend on `exampleSite` content.

## Phase 1: Resource Classification

Purpose: decide whether each root resource should be moved, templated, kept as a
site override, or removed later.

Extract into starter/template:

- Root `hugo.toml` structural config: `[outputs]`, `[taxonomies]`, `[markup]`,
  `[languages]`, and `[permalinks]`.
- Root `package.json` script shape for a consumer site.
- Root taxonomy root-bundle shape from `content/intent/_index.*.md` and
  `content/tags/_index.*.md`.

Keep as site-owned:

- `content/_index.*.md`
- `content/about/index.*.md`
- `content/d/products/*`
- `content/fragments/site-meta/*`
- `content/fragments/nav-primary-links/*`
- `content/fragments/home-footer-shortcuts/*`
- `assets/site/brand/*`
- `assets/site/pwa/*`
- `static/favicon.*`
- `edgeone.json`

Theme-side candidates:

- Move theme-level change history into `themes/banyan/CHANGELOG.md`.
- Keep root `CHANGELOG.md` only for the root site if needed.

Delete candidates for a later cleanup:

- Root demo/test content such as `content/d/test/index.md` and experimental
  taxonomy demo bundles. These should live in `exampleSite` or a dedicated
  fixture, not in the production root site.
- `content/d/products/test.md` and `content/d/products/test/index.md` are not
  present in the current root site as of 2026-06-11.

Current root-site classification snapshot on 2026-06-11:

- Keep as site-owned identity/content: root `hugo.toml`, root `package.json`,
  `content/_index.*.md`, `content/about/index.*.md`, `content/wechat/`,
  `content/d/products/`, `content/d/wsl/`, `content/d/ai-era-human-existence/`,
  `content/d/ssh-reverse-port-forward-proxy/`,
  `content/d/win-run-custom-command-path/`, and the site fragment overrides
  under `content/fragments/`.
- Keep as site-owned brand/deployment assets: `assets/site/brand/`,
  `assets/site/pwa/`, `static/favicon.*`, and root deployment scripts such as
  `dev.cmd`, `dev.sh`, `prepare-external.cmd`, and `scripts/build.mjs`.
- Keep generated deployment output out of manual edits: root `edgeone.json`
  remains a rendered artifact; its source of truth is the cache policy data.
- Cleanup completed for `content/d/test/index.md`: the page contained mixed
  Xvenv draft text, placeholder copy, and Markdown/Doocs sample content, so it
  was removed from root production content on 2026-06-11.
- Root-site content readiness is tracked in `docs/site-content-inventory.md`.
  Keep detailed editorial status there instead of in theme-owned docs.

Acceptance:

- Every migrated file has a reason.
- Every non-migrated file has a clear owner.
- Unknowns are explicitly marked instead of moved as a convenience.

## Phase 2: Example Site

Purpose: provide a minimal, runnable consumer site that demonstrates Banyan
without carrying swaw.com identity.

Required files:

- `themes/banyan/exampleSite/hugo.toml`
- `themes/banyan/exampleSite/package.json`
- Minimal home page and taxonomy roots under `themes/banyan/exampleSite/content/`
- Optional demo pages that exercise article pages, lists, products, breadcrumbs,
  nav utilities, PWA assets, and Service Worker opt-in.

Acceptance:

- The example site builds independently through Hugo with the theme path set to
  the parent `themes/` directory.
- It contains no Swaw brand, ICP number, private email, or product copy.
- README instructions match the example site.

## Phase 3: Script Generalization

Purpose: remove hidden assumptions that the theme is always tested against
swaw.com and `/p/xvenv/`.

Targets:

- `scripts/checks/check-security-headers.mjs`
- `scripts/checks/check-public-html.mjs`
- `scripts/browser-regression/scenarios.mjs`
- `scripts/browser-regression/browser-speculation-rules.mjs`

Rules:

- Defaults should work with the generic example site.
- Site-specific paths and title expectations should be configurable through
  environment variables or CLI arguments.
- The root site's `package.json` can pass swaw.com-specific values when it needs
  stricter production checks.

Acceptance:

- The scripts no longer default to `https://swaw.com/` or `/p/xvenv/`.
- Root-site checks can still opt into swaw.com paths.
- Example-site checks do not require business content.

## Phase 4: Theme Content Policy

Purpose: keep live theme content small and intentional.

Keep in theme content:

- Default hidden fragments.
- `offline`, `prefetch-debug`, `my`, and `changelog` utility pages.
- `about`, `all`, `d`, and `products` structural/template pages for now.
  These are intentionally retained as theme live content until the page model is
  stable enough to split templates from live defaults.

Move to example site when possible:

- Demo taxonomy terms.
- Demo posts.
- Demo product pages.

Acceptance:

- A new site does not unexpectedly publish business-like content.
- Required runtime pages still exist without manual setup.
- Site content can override theme defaults cleanly.

## Phase 5: Docs And Release Metadata

Purpose: make the theme installable and understandable outside the root project.

Update:

- `README.md`
- `theme.toml`
- `docs/browser-workflows.md`
- `docs/security-csp.md`
- `docs/taxonomies.md`
- `CHANGELOG.md`

Acceptance:

- Install, configure, build, check, and deploy docs match actual commands.
- Required root-site config is explicit.
- Optional PWA, prefetch, Service Worker, CSP, and EdgeOne paths are labeled as
  optional or platform-specific.

## Phase 6: Final Verification

Root-site verification:

- Build from the repository root into `temp_workspace/public/<timestamp>-root`.
- Run public HTML audit with `--check`.
- Run asset report.

Example-site verification:

- Build `themes/banyan/exampleSite` into `temp_workspace/public/<timestamp>-example`.
- Run public HTML audit in report mode.
- Run targeted browser checks when the example site has enough scenario coverage.

Search verification:

- Search the theme for accidental private or site-owned strings.
- Remaining references to swaw.com must be either explicit examples or root-site
  package overrides.
