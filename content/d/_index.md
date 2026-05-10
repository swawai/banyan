---
title: Signals
linkTitle: DIR
nav_primary: signals
layout: "article-list"
banyan_article_section_list: true
slots:
  primary_nav: /fragments/nav-primary-links
  utilities: /fragments/nav-utilities
  breadcrumb_root: /fragments/breadcrumb-model-signals
  breadcrumb: true
cascade:
  - _target:
      kind: "page"
    nav_primary: signals
    type: "post"
    layout: "article-page"
    slots:
      primary_nav: /fragments/nav-primary-links
      utilities: /fragments/nav-utilities
      breadcrumb_root: /fragments/breadcrumb-model-signals
      breadcrumb: true
      meta: true
  - _target:
      kind: "section"
    nav_primary: signals
    layout: "article-list"
    banyan_article_section_list: true
    slots:
      primary_nav: /fragments/nav-primary-links
      utilities: /fragments/nav-utilities
      breadcrumb_root: /fragments/breadcrumb-model-signals
      breadcrumb: true
---

{{< section-list >}}
