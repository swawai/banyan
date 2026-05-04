# Banyan Security and CSP

## 当前主路径

Banyan 当前的安全收敛主路径是：

1. 内容层不再直接持有运行时资源装配权
2. Hugo 负责产出最终页面
3. `Content-Security-Policy-Report-Only` 由**构建后**扫描最终 HTML 再回写
4. 浏览器回归脚本验证关键页面确实拿到了策略头，并且没有产生策略违规事件

这条路径的关键不是“上了 CSP”本身，而是：

- 让 `content/` 继续只表达内容与受控声明
- 让最终执行字节只由 theme code 决定
- 让 hash 的事实源回到浏览器真正收到的 HTML

## 为什么 hash 不能在模板期算

最容易掉坑的一点是：

- Hugo 模板里看到的 inline script 内容
- 不一定等于 `hugo --minify` 之后最终 HTML 里的 inline script 内容

当前项目里已经确认：

- inline script 资源可以先收敛到 `themes/banyan/assets/js/inline/`
- 但如果在 Hugo 模板期直接根据资源内容算 hash
- 最终结果可能和浏览器收到的 script body 不一致

因此 Banyan 当前采用的是：

1. `hugo --gc --cleanDestinationDir --minify`
2. `themes/banyan/scripts/patch-csp-report-only.mjs`
3. `themes/banyan/scripts/sync-edgeone.mjs`

也就是说：

- Hugo 先生成最终 HTML
- 然后脚本扫描 `public/**/*.html`
- 只提取**可执行** inline script
- 再把真实 `sha256-...` hash 回写到：
  - `public/_headers`
  - `public/edgeone.json`

这是当前最稳、最低心智负担的做法。

## 当前剩余的 executable inline script

当前故意保留、并纳入自动 hash 的 executable inline script 只有 3 类：

- `themes/banyan/assets/js/inline/theme-boot.js`
- `themes/banyan/assets/js/inline/breadcrumb-pending.js`
- `themes/banyan/assets/js/inline/breadcrumb-skeleton.js`

保留原因：

- `theme-boot` 用于首帧主题同步，避免明显 theme flash
- `breadcrumb-pending` / `breadcrumb-skeleton` 用于 wide breadcrumb 首帧占位与过渡稳定

原则是：

- 动态页面数据不要再拼进 inline script 本体
- 页面差异应退回 `data-*`
- inline 本体保持常量、短小、可审计

## 当前 Report-Only 基线

当前生成的 `Content-Security-Policy-Report-Only` 基线包括：

- `default-src 'self'`
- `script-src 'self' 'report-sample' <hashes...>`
- `style-src 'self' 'report-sample'`
- `img-src 'self' data:`
- `connect-src 'self'`
- `font-src 'self'`
- `manifest-src 'self'`
- `worker-src 'self'`
- `object-src 'none'`
- `base-uri 'self'`
- `frame-ancestors 'self'`
- `form-action 'self'`

注意：

- 当前仍是 `Report-Only`
- 这不是最终强制策略
- 先验证“有没有噪音”，再决定何时切正式 `Content-Security-Policy`

## 构建与验证

生产构建当前主路径：

```bash
npm run build
```

它实际执行的是：

1. `hugo --gc --cleanDestinationDir --minify`
2. `npm run csp:report-only`
3. `npm run sync:edgeone`

如果你只想对某个临时产物目录补策略头，可以直接运行：

```bash
node themes/banyan/scripts/patch-csp-report-only.mjs temp_workspace/public/<build>
```

## 浏览器安全回归

当前浏览器安全回归入口：

```bash
npm run check:browser:security
```

它复用 `themes/banyan/scripts/browser-regression/` 现有 harness，并额外验证：

- 本地静态 server 会读取构建产物里的 `_headers`
- 关键页面响应头里存在 `Content-Security-Policy-Report-Only`
- 页面运行过程中没有 `SecurityPolicyViolationEvent`
- 页面没有产生 CSP 相关 console 噪音

当前已覆盖的关键页面：

- 首页：验证 `theme-boot`
- wide breadcrumb 路径页：验证 `breadcrumb-pending` 与 `breadcrumb-skeleton`

如果后续新增 executable inline script，除了更新 `assets/js/inline/` 之外，也应判断：

- 现有 security scenario 是否已经覆盖
- 如果没有，应该补一条新的浏览器安全场景

## 什么时候可以从 Report-Only 走到 Enforce

建议按这个顺序推进：

1. 先继续扩大浏览器安全场景覆盖面
2. 清掉 `Report-Only` 下残余的 style / script 噪音
3. 再决定是否补 `report-uri` / `report-to`
4. 最后再把 `Content-Security-Policy-Report-Only` 切到正式 `Content-Security-Policy`

不要反过来做：

- 不要先上强制 CSP，再靠线上报错慢慢补洞
- 也不要一边保留开放式 inline/内容注入能力，一边强行堆 hash 白名单

更稳的原则是：

- 先收权限边界
- 再让策略变严格

## 当前实测状态

在 `2026-05-04` 这轮修订里，浏览器安全回归已经通过：

- `security-csp-report-only-home`
- `security-csp-report-only-breadcrumb-wide`

结果是：

- 关键页面确实拿到了 `Content-Security-Policy-Report-Only`
- 当前 3 类 executable inline script 的 hash 与最终 HTML 一致
- 浏览器未记录策略违规事件
