# D00 项目全景与构建地图

> 状态：文档已生成 / 步骤 A 未学 / 步骤 B 未学
> 前置：无
> 产出：理解 Pi Coding Agent 的问题域、五个包的职责、一次请求的完整链路，以及为什么后续文档按这个顺序展开。

---

## 1. 构建目标

在写第一行代码之前，先回答三个问题：

1. 我们要构建的"编码 Agent"到底由哪些能力组成？
2. 这些能力之间谁依赖谁，最小可运行系统长什么样？
3. 为什么教学顺序是"类型 → 流协议 → 模型接入 → Agent 循环 → 工具 → 会话 → 编排 → TUI"，而不是照着原仓库目录逐个文件讲？

本篇不涉及具体实现，只建立地图。后续每篇文档都是这张地图上的一个坐标。

---

## 2. 前置知识与依赖

- 了解 LLM 的基本调用方式（messages、tools、streaming）
- 了解 TypeScript / Node.js 的基本工程概念
- 不需要读过 `my-pi/` 的任何源码

---

## 3. 步骤 A——概念与功能讲解

### 3.1 问题域：一个编码 Agent 需要什么

一个"能改代码的 Agent"不是"套一个聊天接口"就完成的。它至少要解决五类问题：

| 问题 | 具体表现 | 缺失后果 |
| --- | --- | --- |
| 模型接入 | 不同厂商的 API 形状不同（OpenAI、Anthropic、Google…） | 每换一个模型就要改一遍业务代码 |
| 循环控制 | 模型要求调用工具，工具结果要回填，然后再问模型 | 只能一问一答，不能完成多步任务 |
| 工具执行 | 读写文件、运行命令、搜索代码，并保证安全与可回滚 | Agent 只能"说"，不能"做" |
| 上下文管理 | 对话会超过上下文窗口，需要压缩、分支、恢复 | 长任务中途崩溃或丢失历史 |
| 交互与集成 | 终端 UI、一次性输出、RPC、SDK | 只能手动调用，无法嵌入工作流 |

Pi 的定位是一个"最小终端编码 harness"：核心保持小，能力通过扩展、技能、提示模板和包来扩展。这个定位直接决定了它的包划分。

### 3.2 五个包的职责

原项目是一个 npm workspaces monorepo，包含五个包：

```text
@earendil-works/pi-ai            统一 LLM 层
        ▲
        │
@earendil-works/pi-agent-core    Agent 循环与状态
        ▲
        │
@earendil-works/pi-coding-agent  编码助手产品层  ◄── @earendil-works/pi-tui
        ▲
        │
@earendil-works/pi-evals         评测
```

| 包 | 职责 | 不负责什么 |
| --- | --- | --- |
| `pi-ai` | 消息/模型/工具类型、provider 注册、流式协议、API 适配、认证、图像 | 不知道"Agent"，不执行工具 |
| `pi-agent-core` | 循环、事件、工具执行语义、消息队列、中止 | 不知道文件系统，不知道 CLI |
| `pi-tui` | 终端能力、布局、组件、编辑器、按键 | 不知道 LLM，不知道会话 |
| `pi-coding-agent` | CLI、会话、内置工具、压缩、扩展、模式、主题 | 不重复实现底层协议 |
| `pi-evals` | 文档与扩展示例的冒烟评测 | 不参与运行时 |

关键设计：**依赖是单向的**。`ai` 不知道 `agent`，`tui` 不知道 `ai`。产品层负责把三者粘起来。这让每个包都可以独立测试，也让教学可以逐层推进。

### 3.3 一次请求的完整链路

以用户在终端输入 `把 README 里的标题改成 pipi` 为例：

```text
用户输入
  │
  ▼
cli.ts                 进程环境初始化（PI_CODING_AGENT、AI_AGENT、HTTP dispatcher）
  │
  ▼
main.ts                解析参数 → 选择模式 → 创建 AgentSessionRuntime
  │
  ▼
AgentSession.submitUserInput()  组装消息、系统提示、工具列表；写入会话
  │
  ▼
Agent.prompt()         状态检查 → 启动一次 run
  │
  ▼
runAgentLoop()         ┌──────────────────────────────────────────┐
  │                    │ 1. 取 steering 队列                       │
  │                    │ 2. convertToLlm：AgentMessage → Message   │
  │                    │ 3. streamSimple：调模型，消费增量事件      │
  │                    │ 4. 若有 toolCall：校验参数 → 执行工具      │
  │                    │ 5. 工具结果回填 → 回到 2                   │
  │                    └──────────────────────────────────────────┘
  ▼
Models.streamSimple()  解析认证 → 选择 provider → 调用 API 适配器
  │
  ▼
openai-completions     发请求 → 解析 SSE → push 事件 → done/error
  │
  ▼
事件回流               AgentEvent → AgentSession → 会话落盘 / 扩展 / UI
  │
  ▼
TUI 或 print 输出
```

这条链路里，**每一层只依赖下一层的接口，不依赖实现**：

- `Agent` 只要求一个 `StreamFn`，不知道它是 OpenAI 还是 Anthropic
- `runAgentLoop` 只要求工具满足 `AgentTool`，不知道 read/edit/bash 的区别
- `AgentSession` 只要求事件，不知道 UI 是 TUI 还是 RPC

### 3.4 为什么按这个顺序构建

如果把上面的链路倒过来看，就得到教学顺序：

| 顺序 | 构建什么 | 没有它时系统会怎样 |
| --- | --- | --- |
| 1 | 工程基座 | 代码无法编译、测试、运行 |
| 2 | 类型层 | 各层对"消息长什么样"没有共识，无法组合 |
| 3 | 流式协议 | 只能等完整回复，无法显示进度，工具参数无法边生成边解析 |
| 4 | Provider + 适配器 | 无法真正调用模型 |
| 5 | Agent 循环 | 无法把模型和工具串起来 |
| 6 | 工具层 | Agent 无法真正读写代码 |
| 7 | 会话与上下文 | 无法保存、恢复、压缩长对话 |
| 8 | 应用编排 | 无法作为 CLI 使用，也无法嵌入其他程序 |
| 9 | TUI | 只能用一次性模式，没有交互体验 |
| 10 | 工程设施 | 无法发布、回归、维护 |

注意：**这不是原仓库的目录顺序**。原仓库把 `ai` 的 142 个文件（含生成文件）平铺在一起，教学则把它拆成"类型 → 流协议 → 注册表 → 适配器 → 认证"五步，因为后者才是从零构建的认知顺序。

### 3.5 一个最小可运行系统

在 D01–D11 完成后，系统应该具备：

- 一个 `Models` 实例，注册了至少一个 provider
- 一个 `Agent`，配置了模型、系统提示、工具
- 一个循环：模型回复 → 工具调用 → 结果回填 → 再回复
- 一个事件消费者：把增量文本打到 stdout
- 一个 faux provider：测试时不访问真实 API

这时还没有：会话持久化、压缩、扩展、TUI、CLI 参数。它们都是"让最小系统变成产品"的增量，而不是重写。

### 3.6 常见设计思路与原项目的选择

| 问题 | 常见做法 | Pi 的选择 | 取舍 |
| --- | --- | --- | --- |
| 多 provider | 每个 provider 一套消息类型 | 统一 `Message`，适配器负责转换 | 前期类型设计成本高，后期扩展便宜 |
| 流式输出 | 回调 / Promise / 事件流 | `AsyncIterable` 事件流 + 最终结果 Promise | 消费端既能 `for await` 又能 `await result()` |
| 错误处理 | 抛异常 | 错误编码进流事件，循环不中断 | 调用方必须检查 `stopReason`，但 UI 不会丢事件 |
| 工具执行 | 框架内置固定工具 | 工具是普通对象，由产品层注入 | Agent 核心与文件系统解耦 |
| 上下文压缩 | 截断旧消息 | 摘要 + 保留最近轮次 + 分支摘要 | 复杂，但长任务可继续 |
| UI | 直接写终端 | 独立 TUI 包 + 组件树 + 差分渲染 | 学习曲线陡，但可测试、可复用 |

---

## 4. 步骤 B——具体实现规划

> 本节是"如果现在开始编码，应该建什么"。它基于已确认的 monorepo 形态，但包名等细节仍标记为待确认。

### 4.1 原项目实现

| 关注点 | 原项目位置 | 说明 |
| --- | --- | --- |
| 仓库定义 | `package.json` | npm workspaces，五个包，统一脚本 |
| 入口 | `packages/coding-agent/src/cli.ts` | 进程初始化，调用 `main()` |
| 主流程 | `packages/coding-agent/src/main.ts` | 参数解析、模式选择、运行时创建 |
| 包边界 | `packages/*/package.json` | `exports` 明确公共面 |
| 类型路径 | `tsconfig.json` 的 `paths` | 让源码直接互相引用，测试无需先 build |
| 构建顺序 | 根 `build` 脚本 | tui → ai → agent → coding-agent |

### 4.2 新项目建议结构

第一阶段只建立骨架，不实现业务：

```text
pipi/
├── package.json
├── tsconfig.base.json
├── tsconfig.json
├── vitest.base.ts
├── biome.json
├── .gitignore
├── packages/
│   ├── ai/
│   │   ├── package.json
│   │   ├── tsconfig.build.json
│   │   ├── src/index.ts
│   │   └── test/smoke.test.ts
│   ├── agent/
│   ├── tui/
│   ├── coding-agent/
│   └── evals/
└── docs/
```

约定：

- 每个包只通过 `src/index.ts` 暴露公共 API
- 包内相对导入使用 `.ts` 后缀（与 `NodeNext` + `allowImportingTsExtensions` 配套）
- 测试通过路径别名直接引用 `src`，不依赖 `dist`
- 构建产物只用于发布，日常开发与测试跑源码

### 4.3 实现顺序

1. 根 `package.json`、`tsconfig.base.json`、`.gitignore`
2. `packages/ai` 空包 + `src/index.ts` + 一个 smoke 测试
3. 根测试脚本跑通
4. 复制同样的骨架到 `agent`、`tui`、`coding-agent`、`evals`
5. 建立包间依赖与路径别名
6. 记录"空包可编译、可测试"的基线

### 4.4 本阶段明确不做

- 不实现任何 LLM 调用
- 不引入真实 provider SDK
- 不做 TUI 渲染
- 不做会话持久化
- 不写发布脚本

这些分别属于 D05、D06、D22、D14、D25。

### 4.5 测试与验证

| 测试 | 验证什么 |
| --- | --- |
| 根 `npm run build` | 五个包都能编译 |
| 每包 smoke test | 导入 `src/index.ts` 不报错 |
| 路径别名测试 | `@pipi/ai` 能解析到源码 |
| 循环导入检查 | 构建无循环依赖警告 |

### 4.6 待确认

- 包名前缀（见 `QUESTIONS.md` Q-001）
- 是否保留 `evals` 包（Q-010）
- 是否引入 `biome` 与 `vitest` 的确切版本（建议与 `my-pi` 一致，避免行为差异）

---

## 5. 原源码对应关系

| 主题 | 文件 | 关键位置 |
| --- | --- | --- |
| 仓库与脚本 | `my-pi/package.json` | `workspaces`、`build`、`check`、`test` |
| 根类型配置 | `my-pi/tsconfig.base.json` | `target`、`module`、`erasableSyntaxOnly` |
| 入口 | `packages/coding-agent/src/cli.ts` | 全文 24 行 |
| 主流程 | `packages/coding-agent/src/main.ts` | `main()` 约 595 行起 |
| Agent 循环 | `packages/agent/src/agent-loop.ts` | `runAgentLoop()` 36 行起 |
| Agent 状态 | `packages/agent/src/agent.ts` | `Agent` 类 175 行起，`prompt()` 354 行 |
| 模型分发 | `packages/ai/src/models.ts` | `Models` 接口 156 行，`streamSimple` 695 行 |
| 流协议 | `packages/ai/src/types.ts` | `AssistantMessageEvent` 522–538 行 |
| 事件流实现 | `packages/ai/src/utils/event-stream.ts` | `EventStream` 26 行 |
| 产品层会话 | `packages/coding-agent/src/core/agent-session.ts` | `AgentSession` 310 行起，`submitUserInput()` 1168 行 |

---

## 6. 与整体系统的关系

- 本篇依赖：无
- 本篇支撑：D01–D25 的所有文档
- 后续每篇文档开头都会标注"前置"，读者可以随时回到本篇查看坐标

---

## 7. 复现选项

| 选项 | 说明 | 建议 |
| --- | --- | --- |
| 原样五包 | 与 `my-pi` 一一对应 | 已确认（D-003） |
| 合并 `ai` + `agent` | 少一层依赖 | 不推荐：会失去"核心与产品解耦"的教学价值 |
| 先做单包后拆 | 降低初期成本 | 可选，但拆分时会产生大量移动 |
| 舍弃 `evals` | 减少范围 | 待确认（Q-010） |

---

## 8. 学习检查点

1. 为什么 `pi-tui` 不依赖 `pi-ai`？如果让它依赖，会带来什么问题？
2. 如果把"错误"设计成抛异常而不是流事件，UI 层会丢失什么？
3. 为什么教学顺序把"类型层"放在"第一个 API 适配器"之前？
4. 一个最小可运行 Agent 缺少哪一层就无法完成"读文件 → 改文件 → 再回复"？
5. `AgentSession` 和 `Agent` 的职责边界是什么？为什么不让 `Agent` 直接管会话文件？
