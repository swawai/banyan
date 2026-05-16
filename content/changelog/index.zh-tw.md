---
title: "更新記錄"
slug: "changelog"
type: "page"
layout: "article-page"
changelog:
  intro: "這是主題生成的預設更新記錄占位頁。需要維護正式發布說明時，可在站點內容中用同路徑頁面覆蓋它。"
  current_build: "目前構建"
  build_version: "構建版本"
  build_time: "構建時間"
  git_commit: "Git 提交"
  page_source_revision: "頁面來源提交"
  theme_source: "主題原始碼"
  theme_repo: "https://github.com/swawai/banyan"
  release_notes: "發布說明"
  release_notes_fallback: "這裡暫不維護人工發布說明；目前頁面先用於確認已部署構建，以及構建時可取得的來源資訊。"
slots:
  primary_nav: /fragments/nav-primary-links
  utilities: /fragments/nav-utilities
  footer: /fragments/home-footer-shortcuts
build:
  list: "never"
---

# 更新記錄

{{< changelog-fallback >}}
