# Banyan Theme for Hugo

A minimalist, multi-language, and highly customizable theme for Hugo.

## Installation

Inside your Hugo project root, clone this theme into the `themes` directory:

```bash
git clone https://github.com/swawai/banyan.git themes/banyan
```

## Setup (Crucial Step)

Due to Hugo's configuration merging rules, structural configurations like `[outputs]`, `[outputFormats]`, and `[taxonomies]` **must** be defined in your site's root configuration file. They will not be inherited from the theme.

Use `exampleSite/hugo.toml` as the starter shape for a real site root:

```bash
cp themes/banyan/exampleSite/hugo.toml ./hugo.toml
```

Once copied, open your root `hugo.toml` and customize `baseURL`, `title`,
`themesDir`, language settings, and deployment-specific params. If your site
root is not inside the theme directory, remove `themesDir = "../.."`; a normal
consumer site only needs `theme = "banyan"`.

Customize site-level SEO descriptions by overriding
`content/fragments/site-meta/index.<lang>.md` in your site root.
Keep each language's social locale in `languages.<lang>.params.locale`; Banyan
uses it for Open Graph locale tags.

If you need to customize cache routes, SW cache behavior, or deployment metadata,
create a site-owned `data/cache-policy.toml`. Banyan falls back to
`themes/banyan/data/cache-policy-default.toml` when that file is absent.

```bash
mkdir -p data
# create data/cache-policy.toml only when your site needs route overrides
```

## Example Site

`themes/banyan/exampleSite` is a minimal consumer site used to verify that the
theme can run outside swaw.com content. From the repository root, you can build
it with:

```bash
hugo --source themes/banyan/exampleSite --gc --cleanDestinationDir --minify
```

The example site deliberately avoids product, legal, or brand-specific content.
Treat it as a runnable reference for required root config and small demo content,
not as a place to store theme internals.

## Features

- Built-in multi-language switcher (English, Simplified Chinese, Traditional Chinese)
- Dark / Light / Auto mode toggle
- Default SSR list pages with client-side sorting via URL params
- Optional recursive `all/` list views for home and sections
- Minimalist CSS architecture
- Content-driven taxonomy bundles: recommended `intent` + hierarchical `tags`, with rendering defined in each taxonomy root bundle

## Layout Slots

Banyan's current page shell is assembled from a small fixed slot set rather than
free-form fragment injection.

See [`docs/layout-slots.md`](docs/layout-slots.md) for the current slot names,
their semantics, and the recommended fragment naming rules.

## Security

The current CSP and browser-security regression path is documented in:

- [`docs/security-csp.md`](docs/security-csp.md)
- [`docs/security-csp-enforce-checklist.md`](docs/security-csp-enforce-checklist.md)
- [`docs/browser-regression.md`](docs/browser-regression.md)
- [`docs/browser-workflows.md`](docs/browser-workflows.md)

The current dual-stack prefetch model is documented in:

- [`docs/prefetch-stacks.md`](docs/prefetch-stacks.md)

Banyan keeps prefetch and Service Worker behavior opt-in by default:

```toml
[params.prefetch_runtime]
mode = "enable" # off | enable

[params.service_worker]
mode = "enable" # off | enable | disable
```

If your runtime config uses `sw_*` prefetch modes, `params.service_worker.mode`
must also be `enable`. Sites that do not want Service Worker caching can leave
both modes as `off`, or enable `prefetch_runtime` only with link-only modes.

## Web App Manifest

Banyan emits a fingerprinted web app manifest by default. Sites that want the
manifest to stay behind render-critical resources can defer the manifest link to
the end of `<head>`:

```toml
[params.web_app_manifest]
mode = "defer" # link | defer | off
```

Use `link` when the manifest should be discovered as early as possible, `defer`
when the manifest is useful but not part of the first screen, and `off` for
sites that do not need installability metadata.

Banyan keeps root favicon files and PWA resources on separate paths:

- `static/favicon.ico` and `static/favicon.svg` publish the browser root
  favicon fallbacks at `/favicon.ico` and `/favicon.svg`.
- `assets/pwa/favicon.svg` is the fingerprinted SVG favicon explicitly linked
  by pages.
- `assets/pwa/icon-180.png`, `icon-192.png`, `icon-256.png`, and `icon-512.png`
  are fingerprinted Hugo resources used by the apple-touch icon and web app
  manifest.
- Sites can override the favicon and PWA icons by providing files with the same
  names under their root `assets/pwa/` directory.

## Taxonomies

Declare taxonomies in your site's root `hugo.toml` under `[taxonomies]`.
Banyan's recommended default is `intent + tags`:

Example:

```toml
[taxonomies]
intent = "intent"
tag = "tags"
```

`intent` describes why the author wrote the page or what cognitive action it
should trigger for the reader. `tags` remain supplemental topic keywords.

Each taxonomy must provide an explicit root bundle at
`content/<plural>/_index.<lang>.md` and define Banyan rendering metadata in
`[banyan_taxonomy]`.

Example custom tree taxonomy root bundle:

```toml
+++
title = "UDC"

[banyan_taxonomy]
mode = "tree"
show_in_home = true
home_weight = 40
article_weight = 40
article_mode = "deepest_by_root"
+++
```

Notes:

- Hugo's `[taxonomies]` declaration in the site root is still required to create the taxonomy itself.
- Banyan no longer reads taxonomy labels or rendering config from theme `i18n` or `params.banyan.taxonomies.<plural>`.
- The root bundle `title` is the single source of truth for taxonomy naming across home shortcuts, breadcrumbs, and article labels.
- `linkTitle`, `[banyan_taxonomy].label`, and `[banyan_taxonomy].home_label` are not read for taxonomies.
- Required `[banyan_taxonomy]` keys are: `mode`, `show_in_home`, `home_weight`, `article_weight`, `normalize`, `article_mode`.
- You can attach taxonomy metadata and resources with `content/<plural>/_index.<lang>.md` and optional term bundles such as `content/<plural>/<term>/_index.<lang>.md`.
- Use `themes/banyan/exampleSite/content/intent/` as the sample bundle to copy; avoid treating `themes/banyan/content/` as a template warehouse, because theme content participates in the live build.
- See [docs/taxonomies.md](docs/taxonomies.md) for intent guidance and the recommended term set.

## License
MIT





public/_headers / public/edgeone.json 由主题默认缓存策略和站点 data/cache-policy.toml（若存在）共同驱动，腾讯Edgeone 可能需要拷贝public/edgeone.json 到你项目根目录





### hugo 基本命令
a 开发，动态构建并指定端口：
    hugo server  -D --port 13241
b 开发，指定地址和访问地址：
    hugo server  -D --bind 0.0.0.0 --port 5120 --baseURL "http://120.233.73.242:5120/"  --appendPort=false --printPathWarnings
c 编译生产版：
    hugo --gc --cleanDestinationDir --minify
d 使用banyan 模板（archetypes 目录下的）创建文章
    hugo new -k banyan content/blog/2026-03-06-asdf.md
