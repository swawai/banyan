# Banyan Taxonomies

## 默认推荐

Banyan 默认推荐的 taxonomy 心智模型是：

- 目录树 / section：主结构，回答“它放在哪一枝上”
- `intent`：主意图，回答“作者为什么写这篇，希望它对读者起什么作用”
- `tags`：辅关键词，回答“它还涉及哪些主题点”

对应的站点根配置建议为：

```toml
[taxonomies]
intent = "intent"
tag = "tags"
```

Banyan 现在不再提供 taxonomy 命名或渲染配置的通用兜底。

也就是说，`intent`、`tags`、`udc` 等 taxonomy 的命名和渲染行为都必须由各自的 root bundle 明确声明。

因此，Banyan 推荐使用 taxonomy 对应的 branch bundle 页面做“就地定义”：

- `content/<plural>/_index.<lang>.md`：定义 taxonomy 根页的标题、正文、页面资源，以及可选的 Banyan 渲染参数
- `content/<plural>/<term>/_index.<lang>.md`：定义 term 页的标题、正文、页面资源

注意：

- taxonomy 是否存在，仍然必须先在站点根 `hugo.toml` 的 `[taxonomies]` 中声明
- 仅创建 `content/<plural>/` 不会自动创建 taxonomy；若未声明，它只会变成普通 section
- taxonomy 根 bundle 里的 `title` 是该 taxonomy 的唯一命名来源；首页快捷项、breadcrumb、文章页 taxonomy label 都使用同一个 title
- taxonomy 不再读取 `linkTitle`、`[banyan_taxonomy].label`、`[banyan_taxonomy].home_label`
- taxonomy 根 bundle 必须提供 `[banyan_taxonomy]`，并显式填写 `mode`、`show_in_home`、`home_weight`、`article_weight`、`normalize`、`article_mode`
- 因此，主题把“可复制样板”放在 `exampleSite/content/` 更稳，而不是直接把模板样板放进 `themes/banyan/content/`

## Intent 是什么

`intent` 不是主题词，不是目录分类，也不是“这篇关于什么”。

它描述的是：

- 作者为什么写这篇
- 作者希望读者通过这篇完成什么认知动作
- 这篇内容希望对读者起什么作用

一个简单判断法：

- 能回答“这篇是关于什么的” => 放目录树或 `tags`
- 能回答“作者写它是为了让读者完成什么动作” => 放 `intent`

## 使用规则

- 每篇默认只放 `1` 个 `intent`
- 特殊情况最多 `2` 个；超过后通常说明 taxonomy 边界开始漂移
- 不要把主题词、对象词、栏目词塞进 `intent`
- `intent` 建议使用稳定 slug，展示名称若需本地化，可通过 term page 自定义

## 推荐 Intent 选项

推荐先从一套小而稳的集合开始，不要一开始铺太多：

| slug | 中文含义 | 适合场景 |
| --- | --- | --- |
| `start` | 入门 | 帮读者快速建立第一层认知，降低开始门槛 |
| `decide` | 决策 | 帮读者比较、权衡、做选择 |
| `reference` | 备查 | 提供稳定资料，方便未来回查 |
| `avoid` | 避坑 | 提醒风险、反模式、常见误区 |
| `explore` | 了解 / 探索 | 用于开放式了解、扫盲、勘察问题空间 |
| `announce` | 动态 / 通知 | 用于发布变更、进展、状态更新 |

推荐扩展项：

| slug | 中文含义 | 适合场景 |
| --- | --- | --- |
| `record` | 记录 | 留档、复盘、过程沉淀 |
| `opinion` | 观点 | 明确表达判断、立场、主张 |

## Front Matter 示例

```yaml
---
title: "A page"
intent:
  - reference
tags:
  - taxonomy
  - taxonomy/intent
---
```

taxonomy 根 bundle 可以这样写：

```toml
+++
title = "Intent"

[banyan_taxonomy]
mode = "flat"
show_in_home = true
home_weight = 20
article_weight = 20
normalize = "lower"
article_mode = "all"
+++
```

term bundle 则可以继续在 `content/intent/reference/_index.<lang>.md` 里写 title / body / page resources。

## Starter Bundles

Banyan intentionally does not keep `content/intent` or `content/tags` under
theme live content. Taxonomy root bundles are site information architecture:
they decide which taxonomy names exist, how those taxonomies render, and which
terms deserve their own pages.

Use the runnable starter bundles in `exampleSite/content/` as the copy source:

```text
themes/banyan/exampleSite/content/intent/
themes/banyan/exampleSite/content/tags/
```

For a real site, copy only the plural bundle you declared in the site root
`hugo.toml`:

```toml
[taxonomies]
intent = "intent"
tag = "tags"
```

Then place the copied bundles in the site root:

```text
content/intent/_index.md
content/intent/_index.zh.md
content/intent/_index.zh-tw.md
content/tags/_index.md
content/tags/_index.zh.md
content/tags/_index.zh-tw.md
```

Do not copy taxonomy bundles into `themes/banyan/content/` unless you are
intentionally changing theme live content. If a taxonomy is not declared in the
site root, a same-named content directory is just a normal section and may create
unexpected routes.

## 自定义其他 Taxonomy

若需要 `udc`、`categories`、`authors` 等其他 taxonomy，先在站点根 `hugo.toml` 的 `[taxonomies]` 中声明，再创建对应的 `content/<plural>/_index.<lang>.md` root bundle。

例如显式定义一个树状 `udc`：

```toml
+++
title = "UDC"

[banyan_taxonomy]
mode = "tree"
show_in_home = true
home_weight = 40
article_weight = 40
normalize = "lower"
article_mode = "deepest_by_root"
+++
```

这样 `udc` 仍然可用，而且它的命名和渲染参数都只来自自己的 root bundle。

## 推荐工作流

当你要新增一个 taxonomy 时，推荐顺序是：

1. 在站点根 `hugo.toml` 的 `[taxonomies]` 中声明它
2. 复制 `themes/banyan/exampleSite/content/intent/` 或 `themes/banyan/exampleSite/content/tags/` 作为起点，到自己站点的 `content/<plural>/`
3. 在 bundle 的 `_index.<lang>.md` 里调整标题、正文、`[banyan_taxonomy]`
4. 如果 term 也需要说明文字、图标、局部 CSS/JS，再继续创建 `content/<plural>/<term>/_index.<lang>.md`
