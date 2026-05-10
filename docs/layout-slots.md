# Banyan Layout Slots

## 当前约定

Banyan 当前的页面壳层采用“固定语义 slot + CSS 编排”的方式，而不是让页面 bundle 直接声明布局容器名。

也就是说：

- 页面只声明“我提供什么内容”
- 框架决定“这些内容在单列 / 多列下怎么排”

## 支持的 slots

页面 front matter 中的 `slots:` 当前只支持这些键：

- `primary_nav`
  - 站点顶级主导航
  - 值必须是 fragment page 路径，例如 `/fragments/nav-primary-links`
- `utilities`
  - `My / Language / Theme`
  - 值必须是 fragment page 路径，例如 `/fragments/nav-utilities`
- `breadcrumb_root`
  - 面包屑首字段，也是根域切换入口
  - 值必须是 breadcrumb model fragment 路径，例如 `/fragments/breadcrumb-model-signals`
- `breadcrumb`
  - 当前页面路径尾部
  - 只接受 `true / false`
- `meta`
  - 当前页面元信息
  - 当前内建内容包括：路径摘要、taxonomy、发布日期 / 更新日期
  - 只接受 `true / false`
- `footer`
  - 页脚 fragment
  - 值必须是 fragment page 路径，例如 `/fragments/home-footer-shortcuts`

补充：

- `main` 是框架内建 slot，不通过 front matter 指向 fragment
- 当前不再支持 `show_breadcrumb`、`show_meta`、`breadcrumb_variant`
- 当前不再使用旧的 `context` 命名；原“根域切换”语义统一收口为 `breadcrumb_root`

## 推荐写法

Signals/目录树页面：

```yaml
slots:
  primary_nav: /fragments/nav-primary-links
  utilities: /fragments/nav-utilities
  breadcrumb_root: /fragments/breadcrumb-model-signals
  breadcrumb: true
```

Products 页面：

```yaml
slots:
  primary_nav: /fragments/nav-primary-links
  utilities: /fragments/nav-utilities
  breadcrumb_root: /fragments/breadcrumb-model-products
  breadcrumb: true
```

文章页：

```yaml
slots:
  primary_nav: /fragments/nav-primary-links
  utilities: /fragments/nav-utilities
  breadcrumb_root: /fragments/breadcrumb-model-signals
  breadcrumb: true
  meta: true
```

首页 / About 之类无需路径导航的页面：

```yaml
slots:
  primary_nav: /fragments/nav-primary-links
  utilities: /fragments/nav-utilities
  footer: /fragments/home-footer-shortcuts
```

## Fragment 命名规则

推荐按“语义来源”命名，而不是按“最终摆放位置”命名：

- `nav-primary-links`
- `nav-utilities`
- `breadcrumb-model-signals`
- `breadcrumb-model-products`
- `home-footer-shortcuts`

尤其不要再使用这类布局导向命名：

- `context`
- `rail-footer`
- `stage-breadcrumb`

因为它们会把内容声明和布局编排绑死。

## 单列与多列的关系

同一组 slot 在不同断点下应复用同一份声明。

例如：

- 单列下，`breadcrumb_root + breadcrumb` 组成同一条 breadcrumb row
- 多列下，`breadcrumb_root` 可以升级为独立列，而 `breadcrumb` 仍保留为路径尾部

因此：

- slot 名是语义
- rail / stage / column 是布局
- 不要在 front matter 里声明 `slot.rail-*` 这类布局 slot

## 与导航状态的边界

`slots` 负责页面壳层装配，不负责 collection/browser 运行时状态。

换句话说：

- `slots` 回答的是“这个页面有哪些装配位”
- `from / sort / sorts` 回答的是“当前用户是怎么浏览到这里的”

这两类信息不要混在一起。

### 对 wide browser / wide breadcrumb 的影响

如果后续做 wide-only 的多列浏览或扩列 breadcrumb：

- 不要新增 `slots.browser_mode`
- 不要把每列排序、当前 lineage 之类状态塞进 `slots`
- 也不要把 `primary_nav / utilities / footer` 误当成导航数据源

更稳的做法是：

- 继续使用现有 `slots.breadcrumb_root + slots.breadcrumb`
- 再由运行时根据当前页面的 `collection_source`、`from`、`sorts` 决定 wide 视图如何展开

### 当前内容中的实际分层

从当前项目内容看，`slots` 大致可以分成 3 类：

1. 壳层型页面
   - 例如首页、About
   - 常见写法：
     - `primary_nav`
     - `utilities`
     - `footer`
   - 这类页面不应显示 collection browser

2. collection 导航页
   - 例如 `tags`、`intent`、`products/*`
   - 常见写法：
     - `primary_nav`
     - `utilities`
     - `breadcrumb_root`
     - `breadcrumb`
   - 这类页面才是 wide browser / wide breadcrumb 的主目标

3. 辅助工具页
   - 例如 `my`、`offline`、`prefetch-debug`
   - 常见写法通常只有：
     - `primary_nav`
     - `utilities`
   - 这类页面一般也不应参与 collection browser

### 一个具体例子

根内容首页：

```yaml
slots:
  primary_nav: /fragments/nav-primary-links
  utilities: /fragments/nav-utilities
  footer: /fragments/home-footer-shortcuts
```

这个配置说明的是：

- 页面有主导航
- 有 utilities
- 有 footer

它**不说明**：

- 这是一个 collection page
- 它应该有 breadcrumb lineage
- 它应该参与 wide collection browser

所以，后续判断某页是否启用 wide browser，不应看有没有 `primary_nav/utilities/footer`，而应看：

- 当前页是否具备 breadcrumb 语义
- 当前页是否有 collection source
- 当前页是否属于我们要支持的 collection provider
