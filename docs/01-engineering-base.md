# 01 工程基座

> 课程状态：验收通过
> 覆盖模块：根配置、构建脚本、测试设施、包骨架
> 课程文件：01-engineering-base.md
> 本课产出：一个可编译、可测试、可运行的 monorepo 骨架，后续所有模块都长在它上面。

---

## 1. 构建目标

建立 `pipi/` 的工程骨架：

- 五个包能互相引用，依赖方向正确
- `npm run build` 能从源码生成 `dist`
- 测试直接跑源码，不需要先构建
- 代码风格、TypeScript 规则、Node 版本统一

这一篇不实现业务逻辑，但会决定后面每一门课程的代码放在哪、怎么测。

---

## 2. A：概念与功能讲解

> 本阶段不写代码。先回答三个问题：工程基座是什么、为什么需要、每个选择在防什么问题。

### 2.1 术语与背景

本课涉及工程术语，先给出统一解释。

| 名词 | 含义 | 例子 |
|---|---|---|
| 包（package） | 一个带 `package.json` 的代码目录，可以被安装、被引用 | `packages/llm` |
| 依赖（dependency） | A 的代码用到 B，A 就依赖 B | `agent` 依赖 `llm` |
| 模块（module） | 一个文件，用 `import` / `export` 提供能力 | `types.ts` |
| monorepo | 一个 Git 仓库里放多个包 | `pipi/` 里放五个包 |
| workspace | npm 管理 monorepo 多包的机制 | 根 `package.json` 的 `workspaces` |
| TypeScript | 带类型标注的 JavaScript | `function add(a: number)` |
| 编译 / build | 把 TypeScript 变成 Node 能直接运行的 JavaScript | `src/*.ts` → `dist/*.js` |
| `dist` | build 的输出目录 | `dist/index.js` |
| ESM | JavaScript 的模块标准，用 `import` / `export` | `import { x } from "./x.ts"` |
| NodeNext | TypeScript 配置，让 import 按 Node 的 ESM 规则解析 | `module: "NodeNext"` |
| 别名（alias） | 给 import 路径起一个短名字 | 测试里把 `@pipi/llm` 指向 `src` |
| 测试 | 自动运行代码并检查结果 | `expect(add(1,2)).toBe(3)` |
| CI | 每次提交后自动跑 build 和测试的服务器 | GitHub Actions |

一个编码 Agent 不是一个文件能完成的程序。它至少包含模型接入、Agent 循环、终端渲染、产品编排和评测五个部分。每个部分都需要独立的依赖、测试和发布边界。工程基座的任务，就是让这些部分能够被稳定地组合、构建和验证。

完整术语表在课程 00 第 0 节。

### 2.2 工程基座的目标与边界

工程基座要解决四个典型问题：

| 场景 | 后果 |
|---|---|
| 改了 `llm` 的源码，测试却还在读旧的 `dist` | 测试通过，但测的是旧代码 |
| 本地有 API key，CI 没有 | 本地通过，CI 失败 |
| 五个包各自一套编译配置 | 同一个类型在不同包里行为不一致 |
| 新成员 clone 后不知道先构建哪个包 | 卡在“找不到模块” |

这些问题不是业务功能，而是工程环境的不一致。工程基座通过一组约定和脚本消除它们。

它的目标只有一件事：**可重复性**。任何人、任何机器、任何时间，执行同样的命令，得到同样的结果。

它不负责 LLM 调用、工具执行、会话管理或界面渲染。那些属于后续课程。

### 2.3 monorepo 的结构与取舍

代码变多后，常见的组织方式有三种：

| 方式 | 结构 | 问题 |
|---|---|---|
| 多仓库 | `llm/`、`agent/` 各自一个 Git 仓库 | 改一个接口要开多个 PR，版本难以对齐 |
| 单仓库平铺 | 所有文件放在一个目录 | 包边界消失，任何文件都能互相引用 |
| 单仓库多包 | `packages/llm`、`packages/agent` | 需要 workspace 工具，但边界清晰 |

第三种是 **monorepo**。它在同一个 Git 仓库中保留多个独立包，每个包有自己的 `package.json`、源码、测试和构建产物。

Pi 采用 monorepo 的原因：

- 一次提交可以同时修改接口和调用方
- 测试可以直接引用源码，不需要先发布包
- 构建顺序可以集中写在根脚本里
- 依赖方向可以通过 workspace 依赖显式表达

代价：

- 根配置影响所有包，改错会一起失效
- 需要理解 workspace 的解析与链接规则
- 构建顺序不再是单文件问题，而是包依赖问题

对本项目而言，教学价值大于维护成本，因此采用 monorepo。

### 2.4 ESM 与 NodeNext 的约束

JavaScript 有两套模块系统：

| 标准 | 写法 | 常见场景 |
|---|---|---|
| CommonJS | `const x = require("./x")` | 旧 Node 项目 |
| ESM | `import { x } from "./x.js"` | 新 Node 项目、浏览器、打包器 |

ESM 是当前主流标准。Pi 全部使用 ESM，原因有三点：

1. 模块顶层可以直接 `await`，CLI 初始化方便
2. OpenAI、Anthropic 等 SDK 都提供 ESM
3. `pi-ai` 需要能在浏览器和打包器中使用

`NodeNext` 是 TypeScript 的模块解析设置，作用是让 TypeScript 按 Node 的 ESM 规则检查 import。

ESM 要求导入路径写清楚文件来源。源码中写 `./foo.ts`，编译时 TypeScript 通过 `rewriteRelativeImportExtensions` 把它改写成 `./foo.js`。这样测试可以直接运行 `.ts`，发布产物又能被 Node 正确解析。

常见问题：

- 忘记写扩展名，Node 无法解析
- 混用 CommonJS 的 `require`，在 ESM 中不可用
- `exports` 字段与实际产物不一致，包安装后找不到入口

### 2.5 可擦除语法的意义

Node 22 可以直接运行 `.ts` 文件。它的做法是**删除类型标注**，而不是把 TypeScript 专有语法转换成 JavaScript。

```ts
// 删除类型后仍是合法 JavaScript
const Color = { Red: "red", Blue: "blue" };

// 需要 TypeScript 生成额外运行时代码
enum Color { Red, Blue }
```

`enum`、`namespace`、构造函数参数属性（`constructor(private x: number)`）都属于“删除类型后仍需要额外代码”的语法。

`erasableSyntaxOnly` 禁止这些语法，保证：

```text
直接运行 .ts 的结果 == 编译后运行 .js 的结果
```

代价是写法略啰嗦，例如不能使用参数属性，需要在构造函数中显式赋值。收益是测试环境与生产环境不会分叉。

### 2.6 源码测试与产物测试

测试需要知道 `import "@pipi/llm"` 指向哪里：

| 指向 | 结果 |
|---|---|
| `dist/index.js`（构建产物） | 改了源码但没 build，测试仍在测旧代码 |
| `src/index.ts`（源码） | 改完立即生效 |

Pi 使用别名把包名指向源码：

```ts
{ find: /^@earendil-works\/pi-ai$/, replacement: ".../packages/ai/src/index.ts" }
```

这样测试覆盖真实源码，不需要先构建，跨包测试也能直接调试到源码。

代价是测试与发布走两条解析路径。CI 必须额外执行一次构建，否则 `exports` 配错、产物缺文件等问题不会被发现。

完整策略是两层：

| 层 | 运行对象 | 发现的问题 |
|---|---|---|
| 单元/集成测试 | `src` | 逻辑错误 |
| 打包/安装测试 | `dist` 与 `.tgz` | 产物缺文件、依赖缺失、入口配置错误 |

两层都不能省略。

### 2.7 包间构建顺序

构建像接力：

```text
llm 先编译，产出 dist/*.d.ts
        ↓
agent 读取 llm 的类型，再编译自己
        ↓
harness 读取前三个包的类型，最后编译
```

如果顺序反了，`agent` 编译时找不到 `llm` 的类型文件，会报“找不到模块”。

日常开发不需要手动按这个顺序，因为测试通过别名直接读取源码。只有发布或验证 `exports` 时才需要完整构建。

根 `build` 脚本因此显式写成：

```text
llm → tui → agent → harness → eval
```

而不是依赖 npm workspaces 的默认顺序。

### 2.8 测试环境隔离

Agent 程序会读写：

- 用户目录下的配置文件（`~/.pi/settings.json`）
- 环境变量中的 API key
- 本机的 git 配置

如果测试继承真实环境，会出现三类假结果：

| 现象 | 原因 |
|---|---|
| 本地通过，CI 失败 | 本地有 key，CI 没有 |
| 结果每次不同 | 测试读到了开发者自己的设置 |
| 测试修改了真实配置 | 测试没有使用临时目录 |

Pi 的做法是给测试一个临时 `HOME`，清空继承的环境变量，只注入必要的路径和语言设置。

新项目可以简化，但必须保证：测试不依赖真实密钥和用户目录。

### 2.9 依赖锁定与供应链

`package.json` 声明“需要哪个版本”：

```json
{ "typebox": "1.3.7" }
```

依赖还有自己的依赖，安装时可能解析出不同的组合。`package-lock.json` 记录“这次实际安装了什么”，包括整棵依赖树。有了 lockfile，其他机器执行 `npm ci` 会得到同一套版本。

Pi 额外做了两件事：

- `.npmrc` 设置 `save-exact=true`，新增依赖时写精确版本
- `coding-agent` 生成 `npm-shrinkwrap.json`，把发布包的依赖也锁死

对新项目，至少保留“精确版本 + lockfile”。更严格的供应链审计可以后置到课程 25。

### 2.10 与整体系统的关系

工程基座支撑从课程 02 开始的全部代码与测试：

- 类型层和流协议依赖 TypeScript 配置与源码测试
- 工具、会话、CLI、TUI 依赖 workspace 的包边界
- 构建、发布、CI、原生模块在课程 25 继续扩展

这一课不产生业务能力，但后续每一课都建立在它提供的可重复构建和测试之上。

### 2.11 小结

本课的核心结论：

1. 工程基座提供可重复性，不提供业务功能。
2. monorepo 用一个仓库管理多个有边界的包。
3. ESM 使用 `import` / `export`，NodeNext 让 TypeScript 按 Node 规则解析。
4. 测试跑源码，发布测 `dist`，两层验证都不能省。
5. 构建顺序由包依赖决定，上游先出类型，下游才能编译。
6. 测试必须隔离 HOME、环境变量和 API key。
7. 依赖使用精确版本和 lockfile，保证可重复安装。

---

## 3. 讨论与确认记录

> 学习本课程时，问题、解释、结论、已确认决策以及对 B 阶段的影响记录在此。

| 日期 | 类型 | 内容 | 对 B 的影响 |
| --- | --- | --- | --- |
| 2026-10-29 | 反馈 | 用户指出教程门槛过高，`monorepo`、`ESM` 等名词没有解释 | A 阶段新增 2.0 名词表；课程 00 新增零基础术语表 |
| 2026-10-29 | 决策 | 后续课程首次出现术语时，先用一句话解释，再给类比或例子 | 写入 `AGENTS.md` 教学约定 |
| 2026-10-29 | 讨论 | 确认测试跑源码、发布测 `dist` 是两层验证，不是二选一 | 2.5 补充发行层说明 |
| 2026-10-29 | 讨论 | 澄清 Vitest 触发时机、build/test 的区别、CI 只测源码、dist 测试放在发布前 | 2.5 与术语表保持两层验证说明 |
| 2026-10-29 | A 完成 | 用户确认读完 01 的 A 阶段 | 进入 B 讨论 |
| 2026-10-29 | B 确认 | 用户确认 01 的 B 阶段；三项待确认按建议执行 | B 定稿，转入 BUILD_PLAN |
| 2026-10-29 | 决策 | 采用五份包级 CHANGELOG；Agent 每次提交自行维护并总结；不建根 changelog、不加脚本/hook | 新增 T-01-5，范围限定为建 changelog 与规则 |
| 2026-10-29 | 实现 | T-01-1 完成：根 `package.json`、`.npmrc`、`package-lock.json`；首次无 lockfile 时 npm 10.9.3 解析 vitest 可选 peer 报 `edgesOut`，生成 lockfile 后 `npm ci` 正常 | 使用 `npm ci` 作为可重复安装命令，不启用 `legacy-peer-deps` |
| 2026-10-29 | 实现 | T-01-2 完成：`tsconfig.base.json`、`tsconfig.json`、`biome.json`、`vitest.base.ts`；`tsconfig` 的 `include` 加入 `vitest.base.ts`，保证空包阶段也有输入 | 空包阶段也能执行 `tsc --showConfig`；Biome 忽略规则按 2.2+ 语法调整 |
| 2026-10-29 | 实现 | T-01-3 完成：五个空包、workspace 链接、每包 `tsconfig.build.json` 与 `vitest.config.ts`；根 `build` 改为显式拓扑顺序 | 包间依赖固定为 llm ← agent ← harness，tui 独立，harness ← eval |
| 2026-10-29 | 实现 | T-01-4 完成：五包 smoke 测试；`build`、`test`、`tsc --noEmit`、`biome check .` 全部通过 | 课程进入待验收 |
| 2026-10-29 | 实现 | T-01-5 完成：五份包级 `CHANGELOG.md`，含 `Breaking Changes/Added/Changed/Fixed/Removed` | 变更记录规则可执行 |
| 2026-10-31 | 验收 | 用户进入课程 02，视为课程 01 验收通过 | 课程 01 完成 |

---

## 4. B：具体实现规划

> 读 B 之前先看文件角色。看到不认识的配置文件，回这张表查。

| 文件 | 角色 | 一句话 |
| --- | --- | --- |
| `package.json` | 项目身份证 | 声明项目名、workspace、脚本、依赖 |
| `tsconfig.base.json` | 编译规则 | 所有包共享的 TypeScript 规则 |
| `tsconfig.json` | 类型检查入口 | 开发时检查全仓类型，指向 `src` |
| `vitest.base.ts` | 测试解析规则 | 把包名指向 `src`，让测试跑源码 |
| `biome.json` | 格式与静态检查 | 统一缩进、引号、明显错误 |
| `.npmrc` | npm 行为 | 例如依赖写精确版本 |
| `packages/*/package.json` | 每个包的身份证 | 包名、入口、依赖、脚本 |
| `packages/*/tsconfig.build.json` | 单包编译规则 | 指定 `src` 编译到 `dist` |
| `src/index.ts` | 公共出口 | 只从这里暴露包的能力 |
| `test/smoke.test.ts` | 最小测试 | 证明包能被导入 |

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
    ├── llm/
    │   ├── package.json
    │   ├── tsconfig.build.json
    │   ├── vitest.config.ts
    │   ├── src/index.ts
    │   └── test/smoke.test.ts
    ├── agent/            （同上）
    ├── tui/              （同上）
    ├── harness/          （同上）
    └── eval/             （同上）
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
    "build": "npm run build -w @pipi/llm && npm run build -w @pipi/tui && npm run build -w @pipi/agent && npm run build -w @pipi/harness && npm run build -w @pipi/eval",
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

注意：`npm run --workspaces` 按 `workspaces` 数组顺序执行，不保证依赖拓扑。根 `build` 显式写成 `llm → tui → agent → harness → eval`，避免后续包间导入时顺序错误。

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
      "@pipi/llm": ["./packages/llm/src/index.ts"],
      "@pipi/llm/*": ["./packages/llm/src/*"],
      "@pipi/agent": ["./packages/agent/src/index.ts"],
      "@pipi/agent/*": ["./packages/agent/src/*"],
      "@pipi/tui": ["./packages/tui/src/index.ts"],
      "@pipi/tui/*": ["./packages/tui/src/*"],
      "@pipi/harness": ["./packages/harness/src/index.ts"],
      "@pipi/harness/*": ["./packages/harness/src/*"],
      "@pipi/eval": ["./packages/eval/src/index.ts"],
      "@pipi/eval/*": ["./packages/eval/src/*"]
    }
  },
  "include": ["vitest.base.ts", "packages/*/src/**/*", "packages/*/test/**/*"]
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
      { find: /^@pipi\/llm$/, replacement: src("./packages/llm/src/index.ts") },
      { find: /^@pipi\/agent$/, replacement: src("./packages/agent/src/index.ts") },
      { find: /^@pipi\/tui$/, replacement: src("./packages/tui/src/index.ts") },
      { find: /^@pipi\/harness$/, replacement: src("./packages/harness/src/index.ts") },
      { find: /^@pipi\/eval$/, replacement: src("./packages/eval/src/index.ts") },
    ],
  },
  test: {
    environment: "node",
    testTimeout: 30_000,
  },
});
```

单包 `vitest.config.ts` 只需 `export { default } from "../../vitest.base.ts";`（或合并包级配置）。

### 4.7 包级 `package.json` 建议（以 `llm` 为例）

```json
{
  "name": "@pipi/llm",
  "version": "0.0.0",
  "private": true,
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
  "dependencies": {}
}
```

空包阶段不引入 `typebox`，课程 02 需要类型 schema 时再加入。后续新增子路径导出（例如 `@pipi/llm/providers/*`）时，`exports` 与 `tsconfig` 的 `paths` 要同步更新。

### 4.8 测试隔离策略

第一阶段可以简化，但建议从一开始就做两件事：

1. 测试用 `os.tmpdir()` 创建临时目录，不写用户目录
2. 测试不读取真实 API key；需要模型时使用 faux provider

可选的完整隔离脚本（25 再加强）：

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
| 单包构建 | `npm run build -w @pipi/llm` | 生成 `dist/index.js` 与 `.d.ts` |
| 全量构建 | `npm run build` | 五个包按依赖顺序构建 |
| 测试 | `npm test` | smoke 测试通过 |
| 包解析 | `node -e "import('@pipi/llm')"` | 不因 `exports` 报错 |

### 4.10 决策记录

| 项目 | 决策 | 状态 | 原因 | 影响 |
| --- | --- | --- | --- | --- |
| Biome | 原样实现（引入） | 已确认 | 格式化与 lint 成本低 | 01 使用 `biome.json` |
| TypeScript 配置 | 简化实现（`NodeNext` 单配置） | 已确认 | 简化原项目 `Node16` + `NodeNext` 双配置 | 01 的 `tsconfig` |
| 测试隔离 | 简化实现（先用 `os.tmpdir()`，脚本后置 25） | 已确认 | 避免测试读写真实 HOME | 01 测试 |

### 4.11 变更记录

- 五个包各维护 `packages/<pkg>/CHANGELOG.md`，只保留 `[Unreleased]` 段。
- 分节：`Breaking Changes`、`Added`、`Changed`、`Fixed`、`Removed`。
- Agent 在改动包代码或行为时，同一次提交更新对应 changelog。
- 纯课程文档、计划、仓库配置的提交不写 changelog。
- 不引入 changelog 脚本、hook 或 CI 门禁。

---

### 4.12 复现选项

| 选项 | 说明 | 建议 |
| --- | --- | --- |
| 原样双 tsconfig | `Node16` + `NodeNext` 两套 | 不推荐，除非要严格对照 |
| 单 `NodeNext` | 一套配置 | 推荐 |
| 用 `tsgo` | 原项目的原生编译器 | 先用 `tsc`，稳定后再说 |
| 跳过 `biome` | 少一个依赖 | 可选；但格式化一致性会下降 |
| 跳过测试隔离 | 快速起步 | 不推荐，后面会付出更大代价 |
