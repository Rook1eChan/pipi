# 01 工程基座

> 课程状态：待用户验收
> 前置课程：00
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

## 2. 前置知识与依赖

- 00 的包划分与依赖方向
- 了解 `package.json` 的 `workspaces`、`exports`、`type: module`
- 了解 TypeScript 的 `module` / `moduleResolution` 配置

---

## 3. A 阶段——概念与功能讲解（High-level）

> 本阶段不写代码。先回答三个问题：工程基座是什么、为什么需要、每个选择在防什么问题。

### 3.0 先把本课的名词说清楚

| 名词 | 在这里的意思 | 一个例子 |
| --- | --- | --- |
| 包（package） | 一个带 `package.json` 的代码目录，可以被安装、被引用 | `packages/llm` 是一个包 |
| 依赖（dependency） | A 的代码用到 B，A 就依赖 B | `agent` 依赖 `llm` |
| 模块（module） | 一个文件，用 `import` / `export` 提供能力 | `types.ts` 是一个模块 |
| monorepo | 一个 Git 仓库里放多个包 | 一个 `pipi/` 里放五个包 |
| workspace | npm 管理 monorepo 多包的机制 | 根 `package.json` 的 `workspaces` |
| TypeScript | 带类型标注的 JavaScript | `function add(a: number)` |
| 编译 / build | 把 TypeScript 变成 Node 能直接运行的 JavaScript | `src/*.ts` → `dist/*.js` |
| `dist` | build 的输出目录 | `dist/index.js` |
| ESM | JavaScript 的模块标准，用 `import` / `export` | `import { x } from "./x.ts"` |
| NodeNext | TypeScript 配置，让 import 按 Node 的 ESM 规则解析 | `module: "NodeNext"` |
| 别名（alias） | 给 import 路径起一个短名字 | 测试里把 `@pipi/llm` 指向 `src` |
| 测试 | 自动运行代码并检查结果 | `expect(add(1,2)).toBe(3)` |
| CI | 每次提交后自动跑 build 和测试的服务器 | GitHub Actions |

完整术语表在课程 00 第 0 节，遇到别的词可以回那里查。

### 3.1 为什么需要"工程基座"

先看四个真实会发生的问题：

| 场景 | 结果 |
| --- | --- |
| 改了 `llm` 的源码，测试却还在读旧的 `dist` | 测试通过，但测的是旧代码 |
| 本地有 API key，CI 没有 | 本地过，CI 挂 |
| 五个包各自一套编译配置 | 同一个类型在不同包里行为不一样 |
| 新同事 clone 后不知道先构建哪个包 | 卡在"找不到模块" |

工程基座不是功能，而是一组约定和脚本，让这些事不发生。

它只提供一件事：**可重复性**。任何人、任何机器、任何时间，跑同样的命令，得到同样的结果。

### 3.2 为什么是 monorepo

先假设你只有一个包。所有代码放一个目录，没问题。

当代码变多，通常有三种放法：

| 放法 | 长什么样 | 问题 |
| --- | --- | --- |
| 每个包一个仓库 | `llm/`、`agent/` 各自一个 Git 仓库 | 改一个接口要开好几个 PR，版本很难对齐 |
| 一个大仓库，所有代码混在一起 | 所有文件平铺 | 边界消失，谁都能 import 谁 |
| 一个大仓库，分成多个包 | `packages/llm`、`packages/agent` | 需要 workspace 工具管理，但边界清楚 |

第三种就是 **monorepo**。

Pi 选它的原因：

- 一次提交能同时改接口和调用方
- 测试能直接引用源码，不需要先把包发布出去
- 构建顺序可以写在一个根脚本里

代价：

- 根配置影响所有包，改错会一起坏
- 需要理解 workspace 的边界

对本项目来说，教学价值大于成本，所以沿用 monorepo。

### 3.3 为什么是 ESM + NodeNext

JavaScript 历史上出现过两套模块写法：

| 写法 | 长什么样 | 常见场景 |
| --- | --- | --- |
| CommonJS | `const x = require("./x")` | 老 Node 项目 |
| ESM | `import { x } from "./x.js"` | 新 Node 项目、浏览器、打包器 |

ESM 是现在的主流标准。Pi 全部使用 ESM，原因有三个：

1. 可以在模块顶层直接 `await`，CLI 初始化方便
2. OpenAI、Anthropic 等 SDK 都提供 ESM
3. `pi-ai` 需要能在浏览器和打包器里使用

`NodeNext` 是 TypeScript 的一个设置，作用是：**让 TypeScript 按 Node 的 ESM 规则检查 import**。

ESM 有一个硬性要求：导入路径必须写清楚文件从哪来。源码里写 `./foo.ts`，编译时 TypeScript 会把它改写成 `./foo.js`。这样：

- 测试可以直接跑 `.ts`
- 发布出去的 `.js` 又能被 Node 正确找到

### 3.4 为什么限制"可擦除语法"

Node 22 可以直接运行 `.ts` 文件，但它的做法只是**把类型标注删掉**，不会把 TypeScript 专有语法转换成 JavaScript。

举例：

```ts
// 这种写法，删掉类型后仍然是合法的普通对象
const Color = { Red: "red", Blue: "blue" };

// 这种写法需要 TypeScript 额外生成运行时代码
enum Color { Red, Blue }
```

`enum`、`namespace`、构造函数参数属性（`constructor(private x: number)`）都属于"删掉类型后还需要额外代码"的语法。

`erasableSyntaxOnly` 的作用就是禁止这些语法，保证：

```text
直接跑 .ts 的结果 == 编译后跑 .js 的结果
```

代价是写起来略啰嗦，收益是测试环境和生产环境不会分叉。

### 3.5 为什么测试直接跑源码

测试就是"自动运行代码并检查结果"。

问题在于：测试里的 `import "@pipi/llm"` 到底指向哪里？

| 指向 | 结果 |
| --- | --- |
| `dist/index.js`（构建产物） | 改了源码但没 build，测试还在测旧代码 |
| `src/index.ts`（源码） | 改完立即生效 |

Pi 用**别名（alias）**把包名指向源码：

```ts
{ find: /^@earendil-works\/pi-ai$/, replacement: ".../packages/ai/src/index.ts" }
```

好处：

- 改源码立即生效，不用先 build
- 测试覆盖真实源码，不是可能过期的 `dist`
- 跨包测试能直接断点调试到源码

代价：

- 测试和发布走的是两条解析路径，CI 必须另外跑一次 build
- 有些问题只有打包后才会出现，比如 `exports` 配错、文件没被装进包

所以完整的策略是两层：

| 层 | 跑什么 | 发现什么问题 |
| --- | --- | --- |
| 单元/集成测试 | `src` | 逻辑错误 |
| 打包/安装测试 | `dist` + `.tgz` | 发布物缺文件、依赖缺失、入口配错 |

两层都不能省。

### 3.6 为什么构建顺序是 tui → llm → agent → harness

build 像接力：

```text
llm 先编译，产出 dist/*.d.ts
        ↓
agent 读 llm 的类型，再编译自己
        ↓
harness 读前三个包的类型，最后编译
```

如果顺序反了，`agent` 编译时找不到 `llm` 的类型文件，就会报"找不到模块"。

日常开发不需要手动按这个顺序，因为测试走源码别名；只有发布或验证 `exports` 时才需要完整构建。

### 3.7 为什么测试要隔离 HOME 和 API key

Agent 程序会读写这些东西：

- 用户目录下的配置文件（`~/.pi/settings.json`）
- 环境变量里的 API key
- 本机的 git 配置

如果测试直接继承真实环境，会出现三类假结果：

| 现象 | 原因 |
| --- | --- |
| 本地过，CI 挂 | 你本地有 key，CI 没有 |
| 结果每次不一样 | 测试读到了你自己的设置 |
| 测试改坏了真实配置 | 测试没有使用临时目录 |

Pi 的做法是：给测试一个临时 `HOME`，清空继承的环境变量，只注入必要的路径和语言设置。

新项目可以简化，但必须保证：**测试不依赖真实密钥和用户目录**。

### 3.8 依赖锁定与供应链

`package.json` 里写：

```json
{ "typebox": "1.3.7" }
```

这是"我想要这个版本"。但依赖的依赖还有版本，安装时可能被解析成不同的组合。

`package-lock.json` 记录的是"这次实际装了什么"，包括整棵依赖树。有了它，别人执行 `npm install` 会得到同一套版本。

Pi 额外做了两件事：

- `.npmrc` 设置 `save-exact=true`，新增依赖时写精确版本
- `coding-agent` 生成 `npm-shrinkwrap.json`，把发布包的依赖也锁死

对新项目：至少保留"精确版本 + lockfile"。更严格的供应链审计可以后置到课程 25。

### 3.9 本课小结

如果只记住五句话：

1. 工程基座不提供功能，只提供可重复性。
2. monorepo = 一个仓库里放多个有边界的包。
3. ESM = 用 `import` / `export`；NodeNext 让 TypeScript 按 Node 的规则解析。
4. 测试跑源码，发布测 `dist`，两层都要有。
5. 构建顺序是上游先出类型，下游才能编译。

---

## 4. 讨论与确认记录

> 学习本课程时，问题、解释、结论、已确认决策以及对 B 阶段的影响记录在此。

| 日期 | 类型 | 内容 | 对 B 的影响 |
| --- | --- | --- | --- |
| 2026-10-29 | 反馈 | 用户指出教程门槛过高，`monorepo`、`ESM` 等名词没有解释 | A 阶段新增 3.0 名词表；课程 00 新增零基础术语表 |
| 2026-10-29 | 决策 | 后续课程首次出现术语时，先用一句话解释，再给类比或例子 | 写入 `AGENTS.md` 教学约定 |
| 2026-10-29 | 讨论 | 确认测试跑源码、发布测 `dist` 是两层验证，不是二选一 | 3.5 补充发行层说明 |
| 2026-10-29 | 讨论 | 澄清 Vitest 触发时机、build/test 的区别、CI 只测源码、dist 测试放在发布前 | 3.5 与术语表保持两层验证说明 |
| 2026-10-29 | A 完成 | 用户确认读完 01 的 A 阶段 | 进入 B 讨论 |
| 2026-10-29 | B 确认 | 用户确认 01 的 B 阶段；三项待确认按建议执行 | B 定稿，转入 BUILD_PLAN |
| 2026-10-29 | 决策 | 采用五份包级 CHANGELOG；Agent 每次提交自行维护并总结；不建根 changelog、不加脚本/hook | 新增 T-01-5，范围限定为建 changelog 与规则 |
| 2026-10-29 | 实现 | T-01-1 完成：根 `package.json`、`.npmrc`、`package-lock.json`；首次无 lockfile 时 npm 10.9.3 解析 vitest 可选 peer 报 `edgesOut`，生成 lockfile 后 `npm ci` 正常 | 使用 `npm ci` 作为可重复安装命令，不启用 `legacy-peer-deps` |
| 2026-10-29 | 实现 | T-01-2 完成：`tsconfig.base.json`、`tsconfig.json`、`biome.json`、`vitest.base.ts`；`tsconfig` 的 `include` 加入 `vitest.base.ts`，保证空包阶段也有输入 | 空包阶段也能执行 `tsc --showConfig`；Biome 忽略规则按 2.2+ 语法调整 |
| 2026-10-29 | 实现 | T-01-3 完成：五个空包、workspace 链接、每包 `tsconfig.build.json` 与 `vitest.config.ts`；根 `build` 改为显式拓扑顺序 | 包间依赖固定为 llm ← agent ← harness，tui 独立，harness ← eval |
| 2026-10-29 | 实现 | T-01-4 完成：五包 smoke 测试；`build`、`test`、`tsc --noEmit`、`biome check .` 全部通过 | 课程进入待验收 |
| 2026-10-29 | 实现 | T-01-5 完成：五份包级 `CHANGELOG.md`，含 `Breaking Changes/Added/Changed/Fixed/Removed` | 变更记录规则可执行 |

---

## 5. B 阶段——具体实现规划（Low-level）

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

### 5.1 原项目实现

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

### 5.2 新项目文件清单

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

### 5.3 根 `package.json` 建议

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

### 5.4 `tsconfig.base.json` 建议

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

### 5.5 `tsconfig.json` 建议

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

### 5.6 `vitest.base.ts` 建议

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

### 5.7 包级 `package.json` 建议（以 `llm` 为例）

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

### 5.8 测试隔离策略

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

### 5.9 验证清单

| 验证 | 命令 | 期望 |
| --- | --- | --- |
| 类型检查 | `npx tsc --noEmit` | 无错误 |
| 单包构建 | `npm run build -w @pipi/llm` | 生成 `dist/index.js` 与 `.d.ts` |
| 全量构建 | `npm run build` | 五个包按依赖顺序构建 |
| 测试 | `npm test` | smoke 测试通过 |
| 包解析 | `node -e "import('@pipi/llm')"` | 不因 `exports` 报错 |

### 5.10 已确认决策

- 引入 Biome 作为格式化与 lint 工具。
- 采用 `NodeNext` 单配置，不使用原项目的 `Node16` + `NodeNext` 双配置。
- 测试隔离：先使用 `os.tmpdir()` 创建临时目录；完整隔离脚本后置到课程 25。

### 5.11 变更记录

- 五个包各维护 `packages/<pkg>/CHANGELOG.md`，只保留 `[Unreleased]` 段。
- 分节：`Breaking Changes`、`Added`、`Changed`、`Fixed`、`Removed`。
- Agent 在改动包代码或行为时，同一次提交更新对应 changelog。
- 纯课程文档、计划、仓库配置的提交不写 changelog。
- 不引入 changelog 脚本、hook 或 CI 门禁。

---

## 6. 原源码对应关系

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

## 7. 与整体系统的关系

- 依赖：00 的包划分
- 支撑：02 起的全部代码与测试
- 后续在 25 会补充打包、发布、CI、原生模块

---

## 8. 复现选项与待确认决策

| 选项 | 说明 | 建议 |
| --- | --- | --- |
| 原样双 tsconfig | `Node16` + `NodeNext` 两套 | 不推荐，除非要严格对照 |
| 单 `NodeNext` | 一套配置 | 推荐 |
| 用 `tsgo` | 原项目的原生编译器 | 先用 `tsc`，稳定后再说 |
| 跳过 `biome` | 少一个依赖 | 可选；但格式化一致性会下降 |
| 跳过测试隔离 | 快速起步 | 不推荐，后面会付出更大代价 |

---

## 9. 学习检查点

1. `erasableSyntaxOnly` 禁止了哪些语法？为什么这与"直接跑 `.ts`"有关？
2. 为什么测试走 `src` alias，而构建走 `dist`？两种方式各自能发现什么问题？
3. `rewriteRelativeImportExtensions` 解决的是什么问题？如果没有它，源码里写 `./foo.ts` 会怎样？
4. 为什么构建顺序必须是 `tui → ai → agent → coding-agent`？
5. `test.sh` 为什么要清空 API key？如果不清理，可能出现哪两类假结果？
