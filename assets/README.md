# Assets

This directory contains theme-provided Hugo assets. A consuming site may override
these files by placing files at the same paths under its root `assets/`
directory.

- `site/` contains site-level resources published with fingerprinted URLs, such as `/site/pwa/*` and `/site/brand/*`.
- `site/pwa/` contains PWA icons and favicon sources used by the theme.
- `site/brand/` contains shared brand media that content can publish with the `asset` shortcode.

Everything published under `/site/*` is treated as immutable and must go through Hugo's fingerprinted asset pipeline. Article-local files belong in the page bundle and publish under `/media/content/*`.
