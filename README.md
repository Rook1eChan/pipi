# pipi

从零复现 Pi Coding Agent 的学习项目。

本仓库不是 `my-pi` 的 fork，也不是在 `my-pi` 上删改得到的副本。它以 `my-pi`（`@earendil-works/pi-*` 0.85.1）为只读参考，按照"最小可运行 Agent → 完整编码助手"的构建顺序重新实现，并把每一步的教学文档、复现决策与验证记录一起纳入版本管理。

## 目录

```text
pipi/
├── docs/                       # 教学文档、源码覆盖清单、复现规划与决策
├── packages/                   # 复现代码（按已确认的规划逐步建立）
└── README.md
```

## 文档导航

| 文件 | 作用 |
| --- | --- |
| [docs/LEARNING_ROADMAP.md](docs/LEARNING_ROADMAP.md) | 教学路线：7 个阶段、26 篇文档、前置依赖与学习状态 |
| [docs/SOURCE_COVERAGE.md](docs/SOURCE_COVERAGE.md) | 源仓库逐文件覆盖清单与分析状态 |
| [docs/REPLICATION_PLAN.md](docs/REPLICATION_PLAN.md) | 新项目模块划分、实现顺序、验收方式与进度 |
| [docs/REPLICATION_DECISIONS.md](docs/REPLICATION_DECISIONS.md) | 已确认的复现范围与设计决策 |
| [docs/QUESTIONS.md](docs/QUESTIONS.md) | 尚待确认的问题 |

教学文档按编号阅读：

- `00` 项目全景与构建地图
- `01` 工程基座
- `02` 核心类型层
- `03` 流式响应协议
- `04`–`25` 见路线图

每篇文档都分为 **步骤 A（概念与功能讲解）** 与 **步骤 B（具体实现规划）**。步骤 A 只讨论"为什么需要、解决什么问题、如何融入系统"；步骤 B 才落到文件、类型、接口、数据流与测试。

## 当前阶段

阶段一：源码分析与教学文档生成。

已完成：源码知识地图、教学路线、覆盖清单、首批文档（00–03）。
未开始：复现代码。
