# pipi

从零复现 Pi Coding Agent 的学习项目。

本仓库不是 `my-pi` 的 fork，也不是在原项目上删改得到的副本。它以 `my-pi`（`@earendil-works/pi-*` 0.85.1）为只读参考，按照"最小可运行 Agent → 完整编码助手"的顺序重新实现，并把课程、复现决策与验证记录一起纳入版本管理。

## 目录

```text
pipi/
├── AGENTS.md                   # 开发规则
├── docs/
│   ├── SOURCE_COVERAGE.md      # 原项目源码覆盖清单
│   ├── LEARNING_PLAN.md        # 课程大纲、依赖与学习进度
│   ├── BUILD_PLAN.md           # 已确认的构建任务与验收状态
│   ├── 00-...md                # 课程 00
│   └── ...
├── packages/                   # 复现代码（按课程逐步建立）
└── README.md
```

## 文档导航

| 文件 | 作用 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | 开发规则：代码质量、提交与 Changelog、网络 |
| [docs/LEARNING_PLAN.md](docs/LEARNING_PLAN.md) | 26 门课程的顺序、依赖、覆盖范围与学习状态 |
| [docs/SOURCE_COVERAGE.md](docs/SOURCE_COVERAGE.md) | 原项目逐文件覆盖、模块职责与课程归属 |
| [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) | 已确认 B 阶段转化出的构建任务 |

已生成的课程：

| 课程 | 主题 |
| --- | --- |
| [00](docs/00-project-overview.md) | 项目全景与构建地图 |
| [01](docs/01-engineering-base.md) | 工程基座 |
| [02](docs/02-core-types.md) | 核心类型层 |
| [03](docs/03-streaming-protocol.md) | 流式响应协议 |

每门课程包含：A 阶段（概念与功能）、讨论与确认记录、B 阶段（实现规划）、原源码对应、复现选项与学习检查点。

## 工作流程

```text
学习 A → 讨论并修订 B → 用户确认 B → 写入 BUILD_PLAN
→ 编码与测试 → 用户验收 → 下一课
```

- B 阶段未确认，不写 `BUILD_PLAN.md`，不开始编码。
- 课程未验收，不进入下一课。
- 不自动提交或推送，Git 操作由用户指挥。

## 从哪里开始

如果你是第一次接触这些概念，先读课程 00 的 **第 0 节：零基础术语表**，再进入正文。后面课程首次出现的名词也会先解释。

## 当前进度

- 课程 00：验收通过（约定类，无代码）。
- 课程 01：待用户验收（T-01-4、T-01-5）。
- 课程 02–03：文档已生成，待学习。
- 课程 04–25 尚未生成。
- `BUILD_PLAN.md`：T-01-4、T-01-5 待验收。
- 复现代码：课程 01 骨架完成，待验收。
