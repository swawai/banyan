---
title: Navigation Utilities Fragment
build:
  list: never
  render: never
nav:
  labels:
    language: Language
    theme: Theme
    theme_auto: Auto
    theme_light: Light
    theme_dark: Dark
    my: My
  controls:
    language: true
    theme: true
  my:
    show: true
    page: /my
    key: my
  version:
    show: true
    caret: false
    changelog_href: /changelog/
    labels:
      label: Site & updates
      text: ver
      home: Home
      check: Check now
      checking: Checking...
      check_failed: Check failed
      status: Status
      status_current: Up to date
      status_ready: New version available
      status_offline: Offline
      status_click_update: click update
      status_click_retry: click retry
---
