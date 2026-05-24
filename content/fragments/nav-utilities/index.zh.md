---
title: Navigation Utilities Fragment
build:
  list: never
  render: never
nav:
  labels:
    language: 语言
    theme: 主题
    theme_auto: 自动
    theme_light: 明亮
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
    # 这里只是允许显示版本/更新菜单；只有 params.service_worker.mode 为
    # "enable"，且当前页不是离线兜底页时，菜单才会真正渲染。
    show: true
    caret: false
    changelog_href: /changelog/
    labels:
      label: 站点与更新
      text: ver
      home: 首页
      check: 立即检查
      checking: 检查中...
      check_failed: 检查失败
      status: 状态
      status_current: 已是最新
      status_ready: 有新版本
      status_offline: 离线
      status_click_update: 点击更新
      status_click_retry: 点击重试
---
