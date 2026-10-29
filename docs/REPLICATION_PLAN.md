# 复现计划（REPLICATION_PLAN）

## 1. 目标与约束

目标：在 `pipi/` 中从零实现一个可运行的 Pi Coding Agent，保持原项目的核心架构与行为，同时允许按学习进度简化。

约束：

- `my-pi/` 只读，不修改、不复制整仓后删改
- `pipi/` 的目录结构由本计划决定，不要求与 `my-pi/` 一致
- 每步实现以已确认的步骤 B 为准；未确认的设计不落代码
- 每次只做一个可独立验证的增量，并运行相关回归测试

## 2. 已确认的工程形态

- npm workspaces monorepo
- TypeScript + ESM + Node `NodeNext` 解析
- Vitest 作为主要测试框架；纯终端工具可选用 `node:test`
- Biome 作为格式化与静态检查
- Node >= 22

包划分建议（**包名待确认**，目录划分已随工程形态确认）：

```text
pipi/
├── package.json                 # workspaces + 根脚本
├── tsconfig.base.json
├── vitest.base.ts
├── biome.json
├── docs/
└── packages/
    ├── ai/                      # 统一 LLM 层（对应 pi-ai）
    ├── agent/                   # Agent 循环（对应 pi-agent-core）
    ├── tui/                     # 终端渲染框架（对应 pi-tui）
    ├── coding-agent/            # CLI 产品层（对应 pi-coding-agent）
    └── evals/                   # 评测（对应 pi-evals，可选）
```

建议包名：`@pipi/ai`、`@pipi/agent`、`@pipi/tui`、`@pipi/coding-agent`、`@pipi/evals`。若你希望完全避开 `pi` 命名，可在 D01 确认时改为其他前缀。

## 3. 模块依赖

```text
types (D02)
  └─ event-stream (D03)
       └─ models/registry (D04)
            ├─ api adapters (D05, D06)
            ├─ auth (D07)
            ├─ images (D08)
            └─ agent-loop (D09)
                 ├─ agent state (D10)
                 └─ tool execution (D11)
                      └─ builtin tools (D12, D13)

session (D14) ── prompt/context (D15) ── compaction (D16)
     │
     └─ cli/config (D17) ── session orchestration (D18)
                                ├─ model runtime (D19)
                                ├─ run modes (D20)
                                └─ extensions (D21)

tui core (D22) ── components (D23) ── interactive mode (D24)

all ── build/release/evals (D25)
```

关键依赖规则：

- `ai` 不依赖 `agent`、`tui`、`coding-agent`
- `agent` 只依赖 `ai`
- `tui` 不依赖 `ai`、`agent`、`coding-agent`
- `coding-agent` 可以依赖前三者
- `evals` 只依赖 `coding-agent`（以及测试工具）

## 4. 实现里程碑

| 里程碑 | 对应文档 | 交付物 | 验收标准 |
| --- | --- | --- | --- |
| M0 | D00–D01 | monorepo 骨架、构建与测试脚本、空包 | `npm run build` 通过；空测试通过 |
| M1 | D02–D03 | 类型层、事件流、部分 JSON 解析 | 单元测试覆盖事件顺序、错误终止、增量拼接 |
| M2 | D04–D05 | provider 注册表、OpenAI 兼容适配器、faux provider | 用 faux provider 跑通一次流式回复；无真实密钥 |
| M3 | D06–D08 | 第二 API 家族、认证、图像（可选） | 至少两个 API 家族通过同一接口；认证可注入 |
| M4 | D09–D11 | Agent 循环、状态队列、工具执行 | 能完成"模型要求调用工具 → 执行 → 回填 → 继续" |
| M5 | D12–D13 | 八个内置工具与治理 | 工具在临时目录中读写安全；输出可截断；并发写不互相破坏 |
| M6 | D14–D16 | 会话 JSONL、上下文装载、压缩 | 会话可保存/恢复/分支；超限时自动压缩后可继续 |
| M7 | D17–D21 | CLI、会话编排、模型运行时、三种模式、扩展 | `pipi -p "..."` 可用；RPC 可脚本驱动；扩展可注册工具 |
| M8 | D22–D24 | TUI 与交互模式 | 交互界面可用：输入、流式输出、工具渲染、快捷键 |
| M9 | D25 | 构建、打包、CI、评测 | 可生成可分发包；CI 跑通；冒烟评测通过 |

## 5. 测试策略

分三层，按复现进度逐步建立：

1. **单元测试**：类型转换、事件流、工具参数校验、截断、压缩切点、会话解析
2. **集成测试**：用 faux provider 驱动 Agent 循环与会话，不访问真实 API
3. **冒烟测试**：CLI `--help`、print 模式、RPC 一次往返、TUI 启动

约束：

- 测试不得依赖真实 API key；需要模型时使用 faux provider
- 涉及文件系统的测试使用临时目录
- 涉及终端的测试固定 `COLUMNS`/`LINES`，避免尺寸差异
- 后续增量必须运行相关回归测试

## 6. 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 原项目 10 万行，范围过大 | 学习周期失控 | 严格按文档增量推进；D06/D08/D21/D24 允许简化 |
| API 差异多（OpenAI/Anthropic/Google） | 适配器复杂度高 | 先做 OpenAI 兼容；其余按需加入 |
| TUI 依赖终端能力与原生模块 | 跨平台问题多 | 先做行渲染；原生能力后置或舍弃 |
| 压缩与分支逻辑隐蔽 | 会话损坏 | 先写会话格式测试，再实现压缩 |
| 扩展系统接口面大 | 难以收敛 | 先支持工具与事件，再支持 UI 钩子 |

## 7. 进度

| 阶段 | 状态 |
| --- | --- |
| 源码分析 | 完成（逐文件登记，见 `SOURCE_COVERAGE.md`） |
| 教学路线 | 完成 |
| 首批文档 D00–D03 | 完成 |
| 复现代码 | 未开始（等待逐篇学习确认） |
| GitHub 仓库 | 已创建并首次推送 |

## 8. 与原项目的差异记录

差异在每篇文档的"复现选项"一节中记录，并汇总到 `REPLICATION_DECISIONS.md`。当前无代码差异。
