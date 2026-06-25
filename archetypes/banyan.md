---
title: "{{ replace .File.ContentBaseName "-" " " | title }}"
date: {{ .Date }}
draft: true
slug: "{{ .File.ContentBaseName }}"
description: ""
share_image: false

# Agent-friendly Markdown mirror:
# - AGENT_MARKDOWN: generate /index.md, advertise it in HTML, and list it in llms.txt.
# - MARKDOWN: generate /index.md only.
# Keep HTML first. Hugo uses output order for the primary output; Markdown first
# can make list/taxonomy links treat index.md as the page URL.
# outputs:
# - HTML
# - AGENT_MARKDOWN

# 别名，用于向后兼容，例如更换 slug 时保留旧链接不会 404
# aliases:
# - /old-url-path/

# 先在站点根 hugo.toml 的 [taxonomies] 里声明 plural key，
# 再按对应 plural front matter 字段填写。
#
# 推荐：intent 通常只放 1 个，描述作者为什么写这篇 /
# 希望读者通过它完成什么认知动作。
# intent:
# - reference
#
# 标签：补充关键词（支持层级结构，例如: 父标签/子标签）
# tags:
# - taxonomy
# - taxonomy/intent
#
# 其他 taxonomy 只要在站点根 [taxonomies] 中声明后，
# 就可以继续按对应 plural 字段填写。
---
