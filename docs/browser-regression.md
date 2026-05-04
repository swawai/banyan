# Banyan Browser Regression

## 目的

这套工具用来补上：

- HTML / 产物审计抓不到的浏览器时序问题
- breadcrumb 闪烁 / 抖动
- service worker 的 waiting / update prompt / fallback confirm

它不是构建流程的一部分，而是一个 **按需运行的外部浏览器工具**。

## 目录

- `themes/banyan/scripts/browser-regression/`

当前固定入口：

- `npm run check:browser`
- `npm run check:browser:security`
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

而不是被无关的全局提示串台。

### 不靠一堆临时参数

为了降低心智负担，使用固定入口脚本：

- 普通检查：`check:browser`
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

### Primary build

优先使用：

- `temp_workspace/public/` 下最新的一份构建

如果没有 temp build，再退到：

- 根目录 `public/`

### Upgrade pair

升级场景使用：

- `temp_workspace/public/` 下最新两份构建

并按：

- 第二新 -> 旧版本
- 最新 -> 新版本

的顺序做升级链路测试。

## 什么时候该扩场景

应该扩：

- 新增了 breadcrumb 进入路径协议
- 调整了 SW manager / update prompt / fallback
- 修过某个真实闪烁或升级 bug，想防回归

暂时不该急着扩：

- 只因为“可能以后会很多”
- 把纯静态结构检查再搬进浏览器层

一个简单原则：

- 浏览器工具只收 **静态审计抓不到** 的那类风险。

## 安全场景

`check:browser:security` 当前专门验证：

- 本地静态 server 会按构建产物 `_headers` 回放响应头
- 关键页面响应里存在 `Content-Security-Policy-Report-Only`
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
