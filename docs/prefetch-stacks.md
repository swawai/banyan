# Banyan Prefetch Stacks

## 结论

Banyan 当前的预取体系已经明确拆成两栈：

1. `params.prefetch_runtime`
   负责 `link rel=prefetch` 与 `SW warm`
2. `params.speculation_rules`
   负责 `Speculation-Rules` response header 与外部 rules JSON

这不是“多一套配置而已”，而是把两种不同层级的 transport 拆开：

- runtime stack = 页面脚本在浏览器里自己调度
- speculation stack = 页面响应把意图交给浏览器原生 speculative loading

## 为什么要拆

旧模型的问题，不是字段名字难看，而是它把两类本质不同的决策硬塞进一套环境矩阵：

- runtime 需要先看浏览器能力，再选 `link` / `SW`
- `Speculation-Rules` header 一旦发出，支持它的浏览器就能看到

如果继续强行统一，配置就会开始说谎：

- 配置写的是 `SW first`
- 实际支持 spec 的浏览器先看到了 header

所以拆栈的核心价值是：

- 让配置重新忠于真实执行路径
- 让 overlap 变成显式告警，而不是隐式副作用

## Runtime Stack

配置入口：

- `params.prefetch_runtime`

### 环境键

runtime stack 当前只使用两位环境键：

- `TT`
- `TF`
- `FT`
- `FF`

含义是：

- 第 1 位：`link rel=prefetch` transport 是否可用
- 第 2 位：当前上下文里 `Service Worker` transport 是否可用

也就是说，它已经不再把 `Speculation Rules` transport 放进这套 env 矩阵里。

### Mode 语义

runtime stack 继续保留短码 mode，因为这套短码表达的是它自己的调度语义：

- `link_sf`
- `link_mf`
- `link_xf`
- `sw_sf`
- `sw_mf`
- `sw_xf`

可追加：

- `_g`

含义：

- `s / m / x` 对应 conservative / moderate / eager
- `_g` 表示基于 `sessionStorage` 的全局一次性 gate

## Speculation Stack

配置入口：

- `params.speculation_rules`

### Mode

当前支持：

- `off`
- `header`

`header` 表示：

- Hugo 为页面生成 sidecar speculation manifest
- 构建后脚本把它们收敛成共享 rules JSON
- 最终给页面写入 `Speculation-Rules` 响应头

### runtime_coordination

当前支持：

- `independent`
- `preempt_runtime_when_supported`

含义：

- `independent`
  双栈独立；若命中同一目标，构建期给 warning
- `preempt_runtime_when_supported`
  若浏览器支持 `Speculation-Rules`，则由 spec 已拥有的 URL 会从 runtime 动作里剔除；
  若浏览器不支持，则 runtime 全量接管

### 直接语义值

各 slot 当前直接使用语义化值，而不是继续复用 runtime 的 transport 短码：

- `prefetch_conservative`
- `prefetch_moderate`
- `prefetch_eager`
- `prerender_conservative`
- `prerender_moderate`
- `prerender_eager`
- `off`

这样做的关键好处是：

- `params.speculation_rules` 只表达 speculation 自己
- 不再混写 `sw_* / link_* / spec_*`

## 当前交付形态

当前 speculation stack 不再把规则塞进 HTML 可执行脚本。

它的主路径是：

1. 页面构建期发布 `__speculation-rules-manifests/*.json`
2. `themes/banyan/scripts/emit-speculation-rules-headers.mjs`
   读取这些 manifests
3. 生成共享的 `/speculation-rules/*.json`
4. 给对应页面补 `Speculation-Rules: "/speculation-rules/....json"`
5. 清理临时 manifests 目录

因此：

- `public/_headers` 和 `public/edgeone.json` 是生成产物
- 不应手改
- 需要改的是上游配置或构建后脚本

## 重叠告警

当前系统不自动替你仲裁两栈冲突。

如果：

- `params.prefetch_runtime` 命中某 URL
- `params.speculation_rules` 也命中同一 URL

构建后脚本会输出 warning。

这是刻意设计的：

- 不偷偷替你改策略
- 也不假装两栈天然不会相撞

当前阶段先做 warning，不做自动 `allow_overlap_with_runtime` 开关。

但若 `runtime_coordination = "preempt_runtime_when_supported"`，重叠就不再默认视为问题：

- 支持 spec 的浏览器：重叠 URL 由 spec 拥有
- 不支持 spec 的浏览器：runtime 接管全部

所以这时构建后 warning 会自然减少或消失。

## `site-prefetch-runtime-meta`

当 `runtime_coordination = "preempt_runtime_when_supported"` 时，页面还会额外输出：

- `site-prefetch-runtime-meta`

它不是可执行脚本，而是一段页面级 JSON。里面至少会包含：

- `coordination_mode`
- `owned_urls`

这份数据的来源不是浏览器回读 `Speculation-Rules` header，而是 Hugo 在构建期基于同一份 `params.speculation_rules + linkCandidates` 上游事实，和 header rules 一起同步算出。

这一步的意义是：

- 浏览器原生 spec 栈继续按 header 工作
- runtime 栈不用再实现一套“读取 header / 解析 rules JSON / 自己重算”的逻辑
- 两栈共享同一份上游事实源，但运行时职责保持分离

## Debug 页面

`/prefetchdebug` 现在可以直接观察这三层信息：

- spec 已拥有的 URL 集
- 当前浏览器环境下 runtime 原始动作
- coordination 生效后 runtime 保留下来的动作，以及被抑制掉的动作

这比只看最终有没有插入 `prefetch` link 更值钱，因为它能直接回答：

- “这页为什么是 spec 接管？”
- “runtime 为什么没做某些动作？”
- “当前协调模式下，哪些 URL 还会继续走 runtime？”

## 浏览器语义

需要记住两条：

1. 不支持 `Speculation-Rules` 的浏览器会静默忽略 header
2. runtime stack 仍按自己的能力矩阵运行

所以当前双栈的真实语义不是：

- “spec 不支持才会走 runtime”

而是：

- “runtime 是 runtime”
- “speculation header 是 speculation header”
- “若两者命中同一目标，是否由 runtime 退让，取决于 `runtime_coordination`”

## 相关文档

- [security-csp.md](security-csp.md)
- [security-csp-enforce-checklist.md](security-csp-enforce-checklist.md)
- [browser-regression.md](browser-regression.md)
