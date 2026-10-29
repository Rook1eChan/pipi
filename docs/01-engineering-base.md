# D01 工程基座

> 状态：文档已生成 / 步骤 A 未学 / 步骤 B 未学
> 前置：D00
> 产出：一个可编译、可测试、可运行的 monorepo 骨架，后续所有模块都长在它上面。

---

## 1. 构建目标

建立 `pipi/` 的工程骨架：

- 五个包能互相引用，依赖方向正确
- `npm run build` 能从源码生成 `dist`
- 测试直接跑源码，不需要先构建
- 代码风格、TypeScript 规则、Node 版本统一

这一篇不实现业务逻辑，但会决定后面每一篇文档的代码放在哪、怎么测。

---

## 2. 前置知识与依赖

- D00 的包划分与依赖方向
- 了解 `package.json` 的 `workspaces`、`exports`、`type: module`
- 了解 TypeScript 的 `module` / `moduleResolution` 配置

---

## 3. 步骤 A——概念与功能讲解

### 3.1 为什么需要"工程基座"

没有基座时，常见的问题是：

- 包之间循环依赖，构建顺序靠猜
- 测试跑的是旧的 `dist`，改了源码却不生效
- 每个包各自一套 tsconfig，类型行为不一致
- 本地能跑，CI 因为环境变量或 HOME 目录不同而失败

工程基座要解决的不是"功能"，而是**可重复性**：任何人、任何机器、任何时间，跑同样的命令得到同样的结果。

### 3.2 为什么是 monorepo

Pi 的五个包天然有依赖关系，且版本锁步发布。monorepo 的好处：

- 一次提交可以同时修改接口和调用方
- 测试可以直接引用源码，不需要 `npm link`
- 构建顺序由根脚本显式定义，而不是靠发布顺序

代价：

- 根配置影响所有包，改动需谨慎
- 构建工具需要理解 workspace 边界

对新项目来说，教学价值大于成本，因此沿用 monorepo。

### 3.3 为什么是 ESM + NodeNext

原项目全部使用 ESM（`"type": "module"`），原因有三：

1. **顶层 await**：CLI 入口、初始化流程需要
2. **与现代依赖一致**：OpenAI/Anthropic SDK 都提供 ESM
3. **浏览器/打包器兼容**：`pi-ai` 需要能在浏览器与打包器中使用

`module: "NodeNext"` 强制导入路径带扩展名，避免 Node 的解析歧义。原项目进一步使用 `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`，让源码里写 `./foo.ts`，编译时自动改写成 `./foo.js`。这样测试可以直接跑 `.ts`，构建产物又是合法的 ESM。

### 3.4 为什么限制"可擦除语法"

`tsconfig.base.json` 开启 `erasableSyntaxOnly`。它禁止：

- `enum`
- `namespace` / `module`
- 构造函数参数属性（`constructor(private x: number)`）
- `import =` / `export =`

原因：Node 22 的 "type stripping" 可以直接运行 `.ts`，但只能擦除类型，不能生成运行时代码。限制语法后，源码在"直接跑"和"编译后跑"两种模式下行为一致，测试与生产不会分叉。

这是一个**约束换一致性**的选择：写起来略啰嗦，但避免了构建/运行差异类 bug。

### 3.5 为什么测试直接跑源码

原项目的 `vitest.base.ts` 把包名 alias 到 `src/index.ts`：

```ts
{ find: /^@earendil-works\/pi-ai$/, replacement: ".../packages/ai/src/index.ts" }
```

好处：

- 改源码立即生效，不需要 watch build
- 测试覆盖的是真实源码，不是可能过期的 `dist`
- 跨包测试可以断点调试到源码

代价：

- 测试与构建使用不同的模块解析路径，需要在 CI 同时验证 `build`
- 某些只在打包后出现的问题（如 `exports` 配置错误）测试发现不了

### 3.6 为什么构建顺序是 tui → ai → agent → coding-agent

因为 `agent` 的 `tsconfig.build.json` 把 `@earendil-works/pi-ai` 指向 `../ai/dist/*.d.ts`，`coding-agent` 又依赖前三个包的 `dist`。构建必须自底向上。

日常开发不需要按这个顺序，因为测试走源码 alias；只有发布或验证 `exports` 时才需要完整构建。

### 3.7 为什么测试要隔离 HOME 和 API key

原项目的 `test.sh` 会：

- 创建临时 `HOME`
- 清空继承的环境变量
- 只注入 `PATH`、`TMPDIR`、`LANG` 等必要变量
- 把 `GIT_CONFIG_GLOBAL` 指向 `/dev/null`

原因：Agent 会读写用户配置、读取 API key、调用 git。如果测试继承真实环境，会出现：

- 本地有 key，测试通过；CI 没 key，测试失败
- 测试读到开发者自己的 `~/.pi/settings.json`，结果不可重复
- 测试误改真实 git 配置

这是一个容易被忽略但非常关键的工程设施。新项目可以简化，但**必须保证测试不依赖真实密钥和用户目录**。

### 3.8 依赖锁定与供应链

原项目：

- `.npmrc` 设置 `save-exact=true`，所有直接依赖精确版本
- `package-lock.json` 锁定整棵树
- `coding-agent` 额外生成 `npm-shrinkwrap.json`
- CI 有 `check:pinned-deps`、`check:runtime-deps`、`npm-audit`

对新项目：至少保留"精确版本 + lockfile"。shrinkwrap、供应链审计可以后置到 D25。

---

## 4. 步骤 B——具体实现规划

### 4.1 原项目实现

| 文件 | 作用 | 关键内容 |
| --- | --- | --- |
| `package.json` | 根工作区 | `workspaces`、`build`、`check`、`test`、`version:*` |
| `tsconfig.base.json` | 共享编译选项 | `target: ES2022`、`module: Node16`、`strict`、`erasableSyntaxOnly`、`rewriteRelativeImportExtensions` |
| `tsconfig.json` | 类型检查入口 | `module: NodeNext`、`paths` 指向各包 `src` |
| `vitest.base.ts` | 测试别名 | 把包名映射到 `src/index.ts` |
| `packages/*/tsconfig.build.json` | 单包构建 | `outDir: dist`、`rootDir: src`、`include: src/**/*.ts` |
| `packages/*/vitest.config.ts` | 单包测试 | `globals`、`environment: node`、30s 超时 |
| `biome.json` | 格式与 lint | tab 缩进、行宽 120 |
| `test.sh` | 隔离测试环境 | 临时 HOME、清空环境变量 |
| `scripts/sync-versions.js` | 版本锁步 | 所有包同一版本 |

### 4.2 新项目文件清单

第一阶段创建：

```text
pipi/
├── package.json
├── tsconfig.base.json
├── tsconfig.json
├── vitest.base.ts
├── biome.json
├── .gitignore
├── .npmrc
└── packages/
    ├── ai/
    │   ├── package.json
    │   ├── tsconfig.build.json
    │   ├── vitest.config.ts
    │   ├── src/index.ts
    │   └── test/smoke.test.ts
    ├── agent/            （同上）
    ├── tui/              （同上）
    ├── coding-agent/     （同上）
    └── evals/            （同上，可选）
```

### 4.3 根 `package.json` 建议

```json
{
  "name": "pipi-monorepo",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "engines": { "node": ">=22.19.0" },
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "check": "biome check --error-on-warnings . && tsc --noEmit"
  },
  "devDependencies": {
    "@biomejs/biome": "2.3.5",
    "@types/node": "22.19.19",
    "typescript": "5.9.3",
    "vitest": "4.1.9"
  }
}
```

注意：`npm run --workspaces` 按 `workspaces` 数组顺序执行，不保证依赖拓扑。构建顺序敏感时显式写成 `npm run build -w @pipi/tui && npm run build -w @pipi/ai && ...`。

不建议一开始引入 `tsgo`（原生 TypeScript 预览版），先用 `tsc`，稳定后再替换。

### 4.4 `tsconfig.base.json` 建议

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "erasableSyntaxOnly": true,
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "types": ["node"]
  }
}
```

与原项目的差异：这里直接使用 `NodeNext`，避免 `Node16` 与 `NodeNext` 两套配置叠加带来的理解成本。行为上对 ESM 项目等价。

### 4.5 `tsconfig.json` 建议

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "paths": {
      "@pipi/ai": ["./packages/ai/src/index.ts"],
      "@pipi/ai/*": ["./packages/ai/src/*"],
      "@pipi/agent": ["./packages/agent/src/index.ts"],
      "@pipi/agent/*": ["./packages/agent/src/*"],
      "@pipi/tui": ["./packages/tui/src/index.ts"],
      "@pipi/tui/*": ["./packages/tui/src/*"],
      "@pipi/coding-agent": ["./packages/coding-agent/src/index.ts"],
      "@pipi/coding-agent/*": ["./packages/coding-agent/src/*"]
    }
  },
  "include": ["packages/*/src/**/*", "packages/*/test/**/*"]
}
```

### 4.6 `vitest.base.ts` 建议

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@pipi\/ai$/, replacement: src("./packages/ai/src/index.ts") },
      { find: /^@pipi\/agent$/, replacement: src("./packages/agent/src/index.ts") },
      { find: /^@pipi\/tui$/, replacement: src("./packages/tui/src/index.ts") },
      { find: /^@pipi\/coding-agent$/, replacement: src("./packages/coding-agent/src/index.ts") },
    ],
  },
  test: {
    environment: "node",
    testTimeout: 30_000,
  },
});
```

单包 `vitest.config.ts` 只需 `export { default } from "../../vitest.base.ts";`（或合并包级配置）。

### 4.7 包级 `package.json` 建议（以 `ai` 为例）

```json
{
  "name": "@pipi/ai",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest --run"
  },
  "dependencies": {
    "typebox": "1.3.7"
  }
}
```

后续新增子路径导出（例如 `@pipi/ai/providers/*`）时，`exports` 与 `tsconfig` 的 `paths` 要同步更新。

### 4.8 测试隔离策略

第一阶段可以简化，但建议从一开始就做两件事：

1. 测试用 `os.tmpdir()` 创建临时目录，不写用户目录
2. 测试不读取真实 API key；需要模型时使用 faux provider

可选的完整隔离脚本（D25 再加强）：

```bash
#!/usr/bin/env bash
set -euo pipefail
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
HOME="$root/home" XDG_CONFIG_HOME="$root/config" npm test
```

### 4.9 验证清单

| 验证 | 命令 | 期望 |
| --- | --- | --- |
| 类型检查 | `npx tsc --noEmit` | 无错误 |
| 单包构建 | `npm run build -w @pipi/ai` | 生成 `dist/index.js` 与 `.d.ts` |
| 全量构建 | `npm run build` | 五个包按依赖顺序构建 |
| 测试 | `npm test` | smoke 测试通过 |
| 包解析 | `node -e "import('@pipi/ai')"` | 不因 `exports` 报错 |

### 4.10 待确认

- 包名前缀（Q-001）
- 是否引入 `biome`（建议引入，成本低）
- 是否保留 `evals` 包（Q-010）
- 是否接受 `NodeNext` 单配置（建议接受，简化原项目的双配置）

---

## 5. 原源码对应关系

| 主题 | 文件 | 关键行 |
| --- | --- | --- |
| workspaces 与脚本 | `my-pi/package.json` | 5–12、13–58 |
| 共享编译选项 | `my-pi/tsconfig.base.json` | 全文 |
| 路径别名 | `my-pi/tsconfig.json` | `paths` 段 |
| 测试别名 | `my-pi/vitest.base.ts` | `workspaceSourcePaths` |
| 单包构建 | `packages/ai/tsconfig.build.json` | `outDir`、`module: NodeNext` |
| 单包测试 | `packages/ai/vitest.config.ts` | `test` 段 |
| 格式规则 | `my-pi/biome.json` | `formatter.indentStyle`、`lineWidth` |
| 测试隔离 | `my-pi/test.sh` | 全文 |
| 依赖锁定 | `my-pi/.npmrc` | `save-exact=true` |

---

## 6. 与整体系统的关系

- 依赖：D00 的包划分
- 支撑：D02 起的全部代码与测试
- 后续在 D25 会补充打包、发布、CI、原生模块

---

## 7. 复现选项

| 选项 | 说明 | 建议 |
| --- | --- | --- |
| 原样双 tsconfig | `Node16` + `NodeNext` 两套 | 不推荐，除非要严格对照 |
| 单 `NodeNext` | 一套配置 | 推荐 |
| 用 `tsgo` | 原项目的原生编译器 | 先用 `tsc`，稳定后再说 |
| 跳过 `biome` | 少一个依赖 | 可选；但格式化一致性会下降 |
| 跳过测试隔离 | 快速起步 | 不推荐，后面会付出更大代价 |

---

## 8. 学习检查点

1. `erasableSyntaxOnly` 禁止了哪些语法？为什么这与"直接跑 `.ts`"有关？
2. 为什么测试走 `src` alias，而构建走 `dist`？两种方式各自能发现什么问题？
3. `rewriteRelativeImportExtensions` 解决的是什么问题？如果没有它，源码里写 `./foo.ts` 会怎样？
4. 为什么构建顺序必须是 `tui → ai → agent → coding-agent`？
5. `test.sh` 为什么要清空 API key？如果不清理，可能出现哪两类假结果？
