# Banyan Security and CSP

## 当前主路径

Banyan 当前的安全收敛主路径是：

1. 内容层不再直接持有运行时资源装配权
2. Hugo 负责产出最终页面
3. `Content-Security-Policy` 由**构建后**扫描最终 HTML 再回写
4. `Speculation-Rules` 作为独立 header 栈，由全局 document rules JSON 与响应头交付
5. 浏览器回归脚本验证关键页面确实拿到了策略头，并且没有产生策略违规事件

这条路径的关键不是“上了 CSP”本身，而是：

- 让 `content/` 继续只表达内容与受控声明
- 让最终执行字节只由 theme code 决定
- 让 hash 的事实源回到浏览器真正收到的 HTML
- 让 `prefetch_runtime` 和 `speculation_rules` 各自表达自己的 transport，而不是再混进一套统一矩阵

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
2. `themes/banyan/scripts/build/patch-csp.mjs`
3. `themes/banyan/scripts/build/emit-speculation-rules-headers.mjs`
4. `themes/banyan/scripts/build/sync-edgeone.mjs`

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

## 预取双栈与 CSP 的关系

当前 Banyan 已把预取策略拆成两栈：

- `params.prefetch_runtime`
  只负责 `link rel=prefetch` 与 `SW warm`
- `params.speculation_rules`
  只负责 `Speculation-Rules` response header 与外部 rules JSON

这一步对 CSP 很重要，因为它消除了旧的 runtime `append(script[type="speculationrules"])` 路径。

当前判断应记成一句话：

- runtime stack 仍会把自己的 slot 策略 payload 以内联 `application/json` 形式输出到 `site-prefetch-data`
- coordination 层若启用，还会额外输出 `site-prefetch-runtime-meta`
- speculation stack 不再把规则塞进 HTML 可执行脚本，而是走 header + 全局 document rules JSON

因此：

- `script-src` 不再需要 `'inline-speculation-rules'`
- `Speculation-Rules` 成为和 CSP `script-src` 并行的一条独立交付链
- 浏览器若不支持 `Speculation-Rules`，会静默忽略该 header；runtime stack 仍按自己的能力矩阵工作

更具体的配置心智模型见 [prefetch-stacks.md](prefetch-stacks.md)。

## 当前 Enforce 基线

当前生成的 `Content-Security-Policy` 基线包括：

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

- 当前已经是正式强制策略
- `script-src` 已不再包含 `'inline-speculation-rules'`
- 新增 executable inline script 时，必须让构建后 hash 生成链和浏览器回归一起覆盖

## 相邻浏览器策略

`Permissions-Policy` 已作为默认响应头写入 `themes/banyan/data/cache-policy-default.toml`。

它和 CSP 的职责不同：

- CSP 约束页面能加载和执行哪些资源
- `Permissions-Policy` 约束页面能调用哪些浏览器高权限能力

当前默认关闭了摄像头、麦克风、定位、屏幕捕获、支付、USB、Bluetooth、Serial、HID、MIDI、运动传感器与 Topics API 等能力。Banyan 当前不依赖这些浏览器能力，因此这是一条低心智负担的防御边界。

如果后续某个页面真的需要其中某项能力，应在上游 cache policy 中显式放开，而不是在产物 `_headers` 或 `edgeone.json` 中手改。

`Strict-Transport-Security` 当前也已进入默认响应头，但只处于初始 ramp-up 阶段：

```http
Strict-Transport-Security: max-age=300
```

当前不带 `includeSubDomains`，也不带 `preload`。原因是 HSTS 会被浏览器缓存，子域和 preload 会把影响面从当前站点扩大到整个域名体系。后续若要升级，应按阶段推进：

```http
Strict-Transport-Security: max-age=604800
Strict-Transport-Security: max-age=2592000
Strict-Transport-Security: max-age=31536000
```

只有在确认所有子域都长期支持 HTTPS 后，才应考虑 `includeSubDomains`；只有在明确理解 preload 的长期撤回成本后，才应考虑 `preload`。

## 构建与验证

生产构建当前主路径：

```bash
npm run build
```

它实际执行的是：

1. `hugo --gc --cleanDestinationDir --minify`
2. `npm run csp:headers`
3. `npm run speculation-rules:headers`
4. `npm run sync:edgeone`

如果你只想对某个临时产物目录补策略头，可以直接运行：

```bash
node themes/banyan/scripts/build/patch-csp.mjs temp_workspace/public/<build>
```

如果你还想同时补全 speculation header 栈，可继续运行：

```bash
node themes/banyan/scripts/build/emit-speculation-rules-headers.mjs temp_workspace/public/<build>
```

注意：

- `public/_headers` / `public/edgeone.json` 是生成产物，不应手改
- `_headers` 首行已经明确提示：要改上游配置或 build post-processing scripts
- `Speculation-Rules` header 的数据源不是 HTML runtime payload，而是 Hugo 渲染出的 document-rules manifests

部署后验收真实响应头：

```bash
npm run check:security:headers
```

默认检查 `https://swaw.com/` 和 `/sw.js`。如果要检查其他环境，可以传入 base URL：

```bash
node themes/banyan/scripts/checks/check-security-headers.mjs https://example.com/
```

这条命令验证的是浏览器真正会收到的响应头，包括：

- `Content-Security-Policy`
- `Permissions-Policy`
- `Strict-Transport-Security`
- `Speculation-Rules`
- `/sw.js` 的 `no-cache, max-age=0, must-revalidate`

## 浏览器安全回归

当前浏览器安全回归入口：

```bash
npm run check:browser:security
```

如果你想单独验证 secondary speculation header 栈，可运行：

```bash
npx hugo --gc --cleanDestinationDir --minify --destination temp_workspace/public/<build>
node themes/banyan/scripts/build/patch-csp.mjs temp_workspace/public/<build>
node themes/banyan/scripts/build/emit-speculation-rules-headers.mjs temp_workspace/public/<build>
npm run check:browser:speculation
```

它复用 `themes/banyan/scripts/browser-regression/` 现有 harness，并额外验证：

- 本地静态 server 会读取构建产物里的 `_headers`
- 关键页面响应头里存在 `Content-Security-Policy`
- 关键页面响应头里存在 `Permissions-Policy`
- 关键页面响应头里存在初始 HSTS ramp-up 策略
- 关键页面响应头里存在 `Speculation-Rules`
- 浏览器真实请求了 `/speculation-rules/*.json`
- 页面运行过程中没有 `SecurityPolicyViolationEvent`
- 页面没有产生 CSP 相关 console 噪音

当前已覆盖的关键页面：

- 首页：验证 `theme-boot`
- wide breadcrumb 路径页：验证 `breadcrumb-pending` 与 `breadcrumb-skeleton`
- `all/` 与典型 breadcrumb 路径页：验证 speculation header 栈

如果后续新增 executable inline script，除了更新 `assets/js/inline/` 之外，也应判断：

- 现有 security scenario 是否已经覆盖
- 如果没有，应该补一条新的浏览器安全场景

## 如何守住 Enforce

当前正式 CSP 的守护顺序是：

1. 内容层继续只表达内容与受控声明
2. executable inline script 继续限制在 `themes/banyan/assets/js/inline/`
3. 构建后继续扫描最终 HTML 并回写真实 hash
4. `check:browser:security` 验证关键页面没有 CSP 违规
5. `check:browser:speculation` 验证 `Speculation-Rules` header 栈没有退回 inline 注入

不要把新功能临时塞进 raw HTML、动态 inline script 或内容层资源声明。Banyan 当前 CSP 能成立，靠的是权限边界清楚，而不是无限堆 hash 白名单。

更具体的风险清单见 [security-csp-enforce-checklist.md](security-csp-enforce-checklist.md)。

## 当前实测状态

在 `2026-05-06` 这轮修订里，浏览器安全回归已经通过：

- `security-csp-enforce-home`
- `security-csp-enforce-breadcrumb-wide`
- `speculation-rules-header-all`
- `speculation-rules-header-xvenv`

结果是：

- 关键页面确实拿到了 `Content-Security-Policy`
- 当前 3 类 executable inline script 的 hash 与最终 HTML 一致
- speculation header 页面确实拿到了 `Speculation-Rules`
- 浏览器未记录策略违规事件

## 当前 `Speculation-Rules` header 栈结论

截至 `2026-05-04`，Banyan 对 speculation stack 的当前判断是：

- 不再使用 runtime `append(script[type="speculationrules"])`
- 改为默认返回 `Speculation-Rules: "/speculation-rules/document.<hash>.json"`
- 外部规则文件使用 `application/speculationrules+json`

当前已确认的事实：

- 这条 header 路径在 Chromium 下可被页面干净接收
- 浏览器会真实请求外部 document rules 文件
- 页面本身不会因此新增 CSP 违规事件
- 当前页面 DOM 中没有额外生成 `script[type="speculationrules"]`

同时要记住两条边界：

1. 这不等于“所有浏览器都会支持并执行”
   不支持的浏览器会静默忽略 header
2. 这不等于“speculation stack 与 runtime stack 天然不会重叠”
   当前系统会在构建后对 overlap 给出 warning，而不是替你自动仲裁

所以更准确的表述是：

- 这已经不再只是单次实验
- 但它仍然是一个 **secondary stack**
- 它的价值在于：在不污染 `script-src` 的前提下，保留浏览器原生 speculative loading 的交付通道
