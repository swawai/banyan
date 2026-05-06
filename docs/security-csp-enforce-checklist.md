# Banyan CSP Enforce Checklist

## 目的

这份清单回答的不是“Banyan 有没有 CSP”，而是：

**当前这套 `Report-Only` 基线，距离切正式 `Content-Security-Policy` 还差什么。**

判断标准分三档：

- `Green`
  当前已经稳定，适合继续保留
- `Amber`
  当前可接受，但最好继续补覆盖或保持监控
- `Red`
  切正式 Enforce 前应先处理或明确降级能力

## Green

### 1. 可执行 inline script 已收敛

当前只保留 3 类可执行 inline script，并且都已经纳入构建后真实 hash：

- `themes/banyan/assets/js/inline/theme-boot.js`
- `themes/banyan/assets/js/inline/breadcrumb-pending.js`
- `themes/banyan/assets/js/inline/breadcrumb-skeleton.js`

这部分已经不是 Enforce 主阻塞项。

### 2. 页面内容层不再直接装配运行时资源

这轮之前的边界收缩已经完成：

- `content/` 不再声明 `page_js/page_css/page_js_inline/page_css_inline/slot_resources`
- 运行时资源绑定回到 theme code

这意味着 CSP 不再被“内容偷偷长脚本”这条旧路径拖累。

### 3. `speculationrules` 已脱离 runtime inline 注入

当前 `Speculation-Rules` 栈已经改成：

- 页面响应头返回 `Speculation-Rules: "/speculation-rules/....json"`
- 规则内容位于外部 `application/speculationrules+json`
- 页面不再 runtime append `script[type="speculationrules"]`

这意味着：

- `script-src` 不再需要 `'inline-speculation-rules'`
- `Speculation-Rules` 不再是当前 CSP 语义上的直接冲突点

### 4. 关键页面的 Report-Only 浏览器回归是绿的

当前默认安全回归已覆盖：

- 首页
- wide breadcrumb 路径页

它们都确认：

- 响应头里存在 `Content-Security-Policy-Report-Only`
- 页面运行过程中没有 `SecurityPolicyViolationEvent`
- 没有 CSP 相关 console 噪音

secondary speculation header 回归当前也已覆盖：

- `/all/`
- `/p/xvenv/?from=products/first-party/xvenv&sorts=_,name-asc`

它们确认：

- 页面响应头里存在 `Speculation-Rules`
- 浏览器真实请求了 rules JSON
- 页面没有因为这条 header 产生新的 CSP 违规

## Amber

### 5. `application/json` / `application/ld+json` 数据脚本仍存在

当前存在：

- `themes/banyan/layouts/partials/prefetch-runtime-embed.html`
- `themes/banyan/layouts/partials/article/schema.html`
- `themes/banyan/layouts/partials/breadcrumb/schema.html`
- `themes/banyan/layouts/partials/schema-itemlist.html`

这类脚本当前属于 data block，不是普通 JavaScript 执行块。根据 MDN `<script>` 文档，`type` 为非 JavaScript MIME 时，内容会被当作 data block，而不会执行。

对当前项目的判断：

- 现在不必为了“形式洁癖”把它们强行搬走
- 但继续保留“它们不是 executable inline”的认知边界

### 6. `sw-manager.enable.update.js` 仍有高敏感 sink

当前仍有：

- `popover.innerHTML = ...`

它的好消息是：

- 当前拼接的是固定结构
- 动态文案已经走 `textContent`

所以它现在更像“受控 sink”，不是立即阻塞项。  
但它仍应被视为后续 code review 的敏感点。

### 7. `Speculation-Rules` 支持度与重叠语义仍是次级风险

这条风险已经不再是“CSP 会不会直接拦住它”，而是：

1. 浏览器是否支持 `Speculation-Rules`
2. 当前 `params.speculation_rules` 是否会和 `params.prefetch_runtime` 命中同一批目标

当前架构的真实语义是：

- 不支持 `Speculation-Rules` 的浏览器，会静默忽略 header
- runtime stack 仍会按自己的 `link/SW` 能力矩阵工作
- 如果两栈命中同一目标，构建后脚本会输出 warning

这不是 Enforce 的语法阻塞项，但它仍值得被当作产品策略风险显式审视。

## Red

### 8. 当前没有确认中的 CSP 语法级阻塞项

截至 `2026-05-04`，我们没有再看到一个像“runtime injected speculationrules 会直接撞 `script-src`”那样明确的 Red 阻塞项。

这并不等于可以不思考直接切 Enforce，而是说明：

- 剩余工作更偏向 **覆盖率** 和 **产品策略**
- 而不是继续为某个已知的 inline 冲突补白名单

如果后续重新引入：

- runtime injected `script[type="speculationrules"]`
- 新的动态 executable inline script
- 或内容层可执行注入路径

那它们会立刻重新进入 Red。

## 建议切换顺序

### 如果目标是“尽快切正式 CSP”

推荐：

1. 保持现有 3 个 hashed inline script
2. 保持现有浏览器安全回归
3. 确认当前 `runtime_coordination` 是否符合你的产品意图，而不是默认沿用
4. 再补一轮针对关键路径页的浏览器验证
5. 然后再评估切正式 `Content-Security-Policy`

### 如果目标是“尽量保留 `Speculation-Rules` 能力”

推荐：

1. 继续保留当前 header + external rules 交付形态
2. 对 `independent` 模式保持 overlap warning 可见；若改用 `preempt_runtime_when_supported`，则把 spec ownership 视为有意识策略
3. 逐步扩大 `check:browser:speculation` 覆盖面
4. 等真实页面观察足够稳定，再决定是否把 secondary stack 也纳入正式 Enforce 叙事

## 一句话判断

截至 `2026-05-04`：

- **Banyan 的通用页面 CSP 基线已经接近可切正式 Enforce**
- **真正还需要你有意识决定的，不再是 inline 冲突，而是 dual-stack overlap 与 `Speculation-Rules` 的产品策略**
