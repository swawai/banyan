---
title: Navigation Utilities Fragment
build:
  list: never
  render: never
nav:
  labels:
    language: 語言
    theme: 主題
    theme_auto: 自動
    theme_light: 亮色
    theme_dark: 深色
    my: 我的
  controls:
    language: true
    theme: true
  my:
    show: true
    page: /my
    key: my
  version:
    show: true
    changelog_href: /changelog/
    labels:
      label: version
      text: ver
      check: 立即檢查
      checking: 檢查中...
      check_failed: 檢查失敗
      status: 狀態
      status_current: 已是最新
      status_ready: 有新版本
      status_offline: 離線
      status_click_update: 點擊更新
      status_click_retry: 點擊重試
---
