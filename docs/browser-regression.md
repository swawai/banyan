# Banyan Browser Regression

## 目的

这套工具用来补上：

- HTML / 产物审计抓不到的浏览器时序问题
- breadcrumb 闪烁 / 抖动
- service worker 的 waiting / update prompt / fallback confirm
- CSP / `Speculation-Rules` 这类“只有真实浏览器吃到响应头后才成立”的验证

它不是构建流程的一部分，而是一个 **按需运行的外部浏览器工具**。

## 目录

- `themes/banyan/scripts/browser-regression/`

如果你现在脑子里只想问一句“我到底该跑哪组命令”，先看：

- [`browser-workflows.md`](browser-workflows.md)
- 或直接运行：`npm run help:browser`

当前固定入口：

- `npm run build:browser:temp`
- `npm run check:browser`
- `npm run check:browser:public`
- `npm run check:browser:latest-temp`
- `npm run check:browser:upgrade`
- `npm run check:browser:security`
- `npm run check:browser:speculation`
- `npm run check:browser:speculation:public`
- `npm run check:browser:speculation:latest-temp`
- `npm run check:browser:headed`
- `npm run check:browser:trace`
- `npm run check:browser:install`

## 设计原则

### 一套场景，同时给人类和 agent 用

不要维护两套测试系统。

当前主路径是：

1. 同一套 Playwright 场景定义
2. 同一个运行器
3. 不同入口只切：
   - 是否有头
   - 是否录 trace

### 先固定浏览器环境，再测目标链路

浏览器回归最容易踩的坑，不是“场景没写全”，而是：

- SW 场景被别的 `confirm` 弹窗打断
- breadcrumb 场景被全局推荐或跳转污染

当前运行器会先做一层最小环境收口：

- 保持新的浏览器 context
- 预先抑制语言推荐弹窗

这样场景主要验证的是：

- breadcrumb 稳定性
- SW waiting / popover / fallback
- 真实响应头是否被浏览器吃到

而不是被无关的全局提示串台。

### 不靠一堆临时参数

为了降低心智负担，使用固定入口脚本：

- 产出一份 fresh temp build：`build:browser:temp`
- 普通检查：`check:browser`
- 强制 root `public/`：`check:browser:public`
- 强制最新 temp build：`check:browser:latest-temp`
- 只跑 SW upgrade 套件：`check:browser:upgrade`
- Speculation 套件 + root `public/`：`check:browser:speculation:public`
- Speculation 套件 + 最新 temp build：`check:browser:speculation:latest-temp`
- 本地观察：`check:browser:headed`
- 深度排查：`check:browser:trace`

而不是让使用者记：

- `--headed`
- `--trace`
- `--json`
- `--mode`

## 输出

每次运行都会写入：

- `temp_workspace/regression/<timestamp>-<mode>/report.json`
- `temp_workspace/regression/<timestamp>-<mode>/summary.txt`

启动时控制台和 `report.json` 还会额外记录：

- primary build selection
- upgrade build selection

这样不用再靠猜“这次到底吃的是 root `public/` 还是某个 `temp_workspace/public/<build>/`”。

失败时还会在对应 scenario 子目录里留下：

- `failure.png`
- `trace.zip`（仅 trace 入口）

## 当前场景

### Single-build

- `home-shell-smoke`
- `breadcrumb-products-wide-stability`
- `breadcrumb-tags-wide-stability`
- `sw-home-register`
- `sw-update-anchor-multi-target-matrix`
- `security-csp-report-only-home`
- `security-csp-report-only-breadcrumb-wide`
- `speculation-rules-header-all`
- `speculation-rules-header-xvenv`
- `speculation-rules-header-prefetchdebug`

### Upgrade

需要 `temp_workspace/public/` 下至少有两份构建产物：

- `sw-update-anchor-popover`
- `sw-update-home-fallback`
- `sw-update-home-fallback-zh-hk`
- `sw-update-home-fallback-zh-mo`

upgrade 场景会：

1. 先用较旧的 temp build 建立 active worker
2. 再切换到较新的 temp build
3. 检查 waiting / update ready / prompt 行为

## 构建目录选择规则

### 推荐日常路径

大多数时候，只需要记住这两组：

1. 日常 temp 回归链

```powershell
npm run build:browser:temp
npm run check:browser:latest-temp
```

如果刚改的是 `prefetch` / `Speculation-Rules` / CSP 相关链路，就把第二步换成：

```powershell
npm run check:browser:speculation:latest-temp
```

2. 生产候选检查链

```powershell
npm run build
npm run check:browser:public
```

3. SW upgrade 链

在“改动前”和“改动后”各生成一份 temp build，然后只跑 upgrade 套件：

```powershell
npm run build:browser:temp -- sw-upgrade-before
# 做出你的 SW / fragment / update-flow 改动
npm run build:browser:temp -- sw-upgrade-after
npm run check:browser:upgrade
```

这里刻意不做“一键生成 before/after 两份 build”的脚本。  
原因很重要：升级前后本来就代表**两个不同代码状态**。系统应该帮你把“怎么测”固定下来，而不是假装“怎么产出两版”也能在一个命令里被抽象掉。

这就是现在推荐的最小心智模型：

- 想要隔离试验产物：先 `build:browser:temp`
- 想测正式 `public/`：先 `build`
- 想专门测 SW 升级链路：前后各 build 一次 temp，再跑 `check:browser:upgrade`
- 想看普通浏览器链路：`check:browser:*`
- 想看 spec 次级链路：`check:browser:speculation:*`

### Primary build

默认会在下面两类候选里选**最新的一份可用构建**：

- 根目录 `public/`
- `temp_workspace/public/` 下各个带 `index.html` 的构建目录

也就是说，它不再“无脑优先 temp build”。  
如果你刚跑完 `npm run build`，而旧 temp build 反而更早，那么 single-build 场景会优先吃更新的 root `public/`。

如果你想显式指定 single-build 测试目录，可设置环境变量：

PowerShell:

```powershell
$env:BANYAN_BROWSER_BUILD_DIR = 'public'
npm run check:browser:speculation
Remove-Item Env:BANYAN_BROWSER_BUILD_DIR
```

也可以指向某个 temp build：

```powershell
$env:BANYAN_BROWSER_BUILD_DIR = 'temp_workspace/public/2605060013-prefetchdebug-regression'
npm run check:browser:speculation
Remove-Item Env:BANYAN_BROWSER_BUILD_DIR
```

如果只是这两类常见显式选择，不必手设环境变量，直接用固定入口即可：

- `npm run check:browser:public`
- `npm run check:browser:latest-temp`
- `npm run check:browser:speculation:public`
- `npm run check:browser:speculation:latest-temp`

### Upgrade pair

升级场景使用：

- `temp_workspace/public/` 下最新两份构建

并按：

- 第二新 -> 旧版本
- 最新 -> 新版本

的顺序做升级链路测试。

`check:browser:upgrade` 会要求这对 build 必须存在。  
如果没有两份 temp build，也没有显式 override，它会直接失败，而不是静默全跳过。

这里仍然只看 temp builds，因为 upgrade 场景本质上需要一对可切换版本。  
如需显式指定，也可以设置：

```powershell
$env:BANYAN_BROWSER_UPGRADE_FROM_DIR = 'temp_workspace/public/2605052338-spec-coordination'
$env:BANYAN_BROWSER_UPGRADE_TO_DIR = 'temp_workspace/public/2605060013-prefetchdebug-regression'
npm run check:browser
Remove-Item Env:BANYAN_BROWSER_UPGRADE_FROM_DIR
Remove-Item Env:BANYAN_BROWSER_UPGRADE_TO_DIR
```

## 什么时候该扩场景

应该扩：

- 新增了 breadcrumb 进入路径协议
- 调整了 SW manager / update prompt / fallback
- 修过某个真实闪烁或升级 bug，想防回归
- 调整了 CSP / `Speculation-Rules` 交付链

暂时不该急着扩：

- 只因为“可能以后会很多”
- 把纯静态结构检查再搬进浏览器层

一个简单原则：

- 浏览器工具只收 **静态审计抓不到** 的那类风险。

## 安全场景

`check:browser:security` 当前专门验证：

- 本地静态 server 会按构建产物 `_headers` 回放响应头
- 关键页面响应里存在 `Content-Security-Policy-Report-Only`
- 关键页面响应里存在默认 `Permissions-Policy`
- 关键页面响应里存在初始 ramp-up 的 `Strict-Transport-Security: max-age=300`
- 页面运行期间没有 `SecurityPolicyViolationEvent`
- 页面没有出现 CSP 相关 console 噪音

它当前主要覆盖：

- 首页
- wide breadcrumb 路径页

原因不是它们“最重要”，而是它们已经覆盖了当前保留的 3 类 executable inline script：

- theme boot
- breadcrumb pending
- breadcrumb skeleton

更完整的 CSP 主线说明见 [security-csp.md](security-csp.md)。

正式从 `Report-Only` 走向 Enforce 前的剩余阻塞项，见 [security-csp-enforce-checklist.md](security-csp-enforce-checklist.md)。

部署后真实响应头验收使用：

```powershell
npm run check:security:headers
```

它不启动本地 browser regression server，而是直接请求目标站点，验证首页安全头和 `/sw.js` 缓存策略。

## `Speculation-Rules` Header 场景

`check:browser:speculation` 当前不属于日常默认安全回归。

它的定位是：

- 专门验证 `Speculation-Rules` 响应头 + 外部 rules JSON 这条 secondary stack
- 确认当前 header 交付链没有重新退回 runtime injected `script[type="speculationrules"]`

当前场景会验证：

- 页面响应里存在 `Speculation-Rules` 头
- 浏览器真实请求了 `/speculation-rules/*.json`
- rules 文件 MIME 为 `application/speculationrules+json`
- rules payload 使用 document rules，并按 `data-prefetch-slot` 匹配页面链接
- 页面运行期间没有新的 CSP 违规事件
- 当前浏览器环境下，DOM 中没有额外生成 `script[type="speculationrules"]`
- `/prefetchdebug` 观察面会同步验证：
  - spec-owned slot 集已暴露
  - runtime raw actions 已暴露
  - coordination 后剩余动作与被抑制动作已暴露
  - 在 spec-capable 浏览器里，已被 spec 接管的动作不会再作为 runtime action 执行

它当前覆盖：

- `/all/`
- `/p/xvenv/?from=products/first-party/xvenv&sorts=_,name-asc`
- `/prefetchdebug`

把它单独拆成一个入口，而不是塞进默认 `check:browser:security`，是刻意的：

- 默认安全回归应该保持“稳定、低噪音、面向主路径”
- secondary speculation stack 有自己的支持度与 overlap 语义，不该混淆成所有页面都必须覆盖的默认基线
