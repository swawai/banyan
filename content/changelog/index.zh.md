---
title: "更新记录"
slug: "changelog"
type: "page"
layout: "article-page"
changelog:
  intro: "这是主题生成的默认更新记录占位页。需要维护正式发布说明时，可在站点内容中用同路径页面覆盖它。"
  current_build: "当前构建"
  build_version: "构建版本"
  build_time: "构建时间"
  git_commit: "Git 提交"
  page_source_revision: "页面来源提交"
  theme_source: "主题源码"
  theme_repo: "https://github.com/swawai/banyan"
  release_notes: "发布说明"
  release_notes_fallback: "这里暂不维护人工发布说明；当前页面先用于确认已部署构建，以及构建时可取得的来源信息。"
slots:
  primary_nav: /fragments/nav-primary-links
  utilities: /fragments/nav-utilities
  footer: /fragments/home-footer-shortcuts
build:
  list: "never"
---

# 更新记录

{{< changelog-fallback >}}
