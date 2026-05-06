---
date: "2026-03-17T00:00:00+08:00"
draft: false
title: "Prefetch Debug"
slug: "prefetchdebug"
nav_primary: home
url: "prefetchdebug"
type: "page"
layout: "prefetch-debug-page"
slots:
  primary_nav: /fragments/nav-primary-links
  utilities: /fragments/nav-utilities
build:
  list: "never"
prefetch_debug:
  intro: Use this page to inspect browser capability detection, the current prefetch payload, and the resources actually injected into the page.
  loading_label: Loading...
  sections:
    support: Browser Support
    env: Chosen Env
    actions: Chosen Runtime Actions (Raw)
    spec_owned: Spec-Owned Slots
    actions_filtered: Runtime Actions After Coordination
    runtime: Runtime Observation
    payload: Page Payload
---
