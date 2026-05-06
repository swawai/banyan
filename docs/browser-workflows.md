# Banyan Browser Workflows

## 结论

日常只需要记 4 种情况：

1. 普通页面 / UI / 样式 / 交互改动
2. `prefetch` / `Speculation-Rules` / CSP 改动
3. SW 升级 / update prompt / fallback 改动
4. 生产候选检查

不要先记一堆脚本名。  
先判断自己改的是哪一类，再直接照抄下面对应的两三条命令。

## 1. 普通页面改动

适用：

- 页面结构
- 样式
- breadcrumb
- 普通前端运行时

命令：

```powershell
npm run build:browser:temp
npm run check:browser:latest-temp
```

## 2. `prefetch` / `Speculation-Rules` / CSP 改动

适用：

- `params.prefetch_runtime`
- `params.speculation_rules`
- `site-prefetch-data`
- `site-prefetch-runtime-meta`
- `Content-Security-Policy-Report-Only`
- `Speculation-Rules` header

命令：

```powershell
npm run build:browser:temp
npm run check:browser:speculation:latest-temp
```

## 3. SW 升级链路改动

适用：

- `sw.js`
- update prompt
- fallback confirm
- fragment root 切换
- SW 版本升级行为

命令：

```powershell
npm run build:browser:temp -- sw-upgrade-before
# 做改动
npm run build:browser:temp -- sw-upgrade-after
npm run check:browser:upgrade
```

最关键的判断：

- before / after 本来就是两个不同代码状态
- 不要试图把它脑补成“一次 build 能同时生成两版”

## 4. 生产候选检查

适用：

- 你准备看正式 `public/`
- 想确认不是某个 temp build 的偶然状态

命令：

```powershell
npm run build
npm run check:browser:public
```

如果改的是 `Speculation-Rules` / CSP，也可以接：

```powershell
npm run check:browser:speculation:public
```

## 什么时候才需要显式指定 build

只有这类情况才需要：

- 你想强制回归去吃某个旧 temp build
- 你想手动指定 upgrade 的 from / to

平时不要先想环境变量。  
先用默认工作流；只有当默认工作流不符合你当前意图时，再去看更底层的 override。

更完整说明见：

- [browser-regression.md](browser-regression.md)
