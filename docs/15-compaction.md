# 15 上下文压缩与分支摘要

> 课程状态：验收通过
> 覆盖模块：`core/compaction/*`、`session-manager.ts`（压缩条目与 `branchWithSummary`）、`agent-session.ts`（触发与编排）
> 课程文件：15-compaction.md
> 本课产出：长会话在接近上下文窗口时压缩历史，切换分支时保留被放弃路径的摘要，恢复后上下文仍然连贯。

---

## 0. 阅读前

| 术语 | 含义 |
| --- | --- |
| token | 模型计费与上下文长度的单位，约等于 4 个字符。 |
| context window | 一次请求最多能容纳的 token 数，由模型决定。 |
| usage | 一次模型响应返回的 token 统计，包含输入、输出、缓存等。 |
| compaction | 上下文压缩：把较早的对话换成结构化摘要，保留最近一段原文。 |
| cut point | 压缩时“从哪里开始保留”的分界位置。 |
| turn | 用户发出一条消息，以及 agent 为此产生的全部消息。 |
| split turn | 切点落在一轮中间，前半轮被摘要、后半轮保留。 |
| branch summary | 离开一条分支时生成的摘要，让模型知道那条路上的尝试。 |
| reserveTokens | 预留给下一次请求与摘要输出的空间。 |
| keepRecentTokens | 压缩后希望保留的最近原文 token 预算。 |

---

## 1. 构建目标

对话可以一直进行，模型的上下文窗口固定。历史越长，请求越贵、越慢，最终会超过窗口。

直接丢掉最早的消息会带来四类损失：

1. 用户最初的目标与约束
2. 已经确定的设计决策
3. 读写过哪些文件、改过什么
4. 遇到过的错误与解决办法

所以需要一种“有损但可控”的办法：把旧历史变成结构化摘要，同时保留最近一段完整工作。分支切换还有第二个问题：用户从一条尝试退回另一条路径时，被放弃的那段工作会从上下文里消失。

本课要解决四件事：

- 上下文接近窗口时自动压缩
- 压缩后保留最近工作，不切断一轮对话
- 切换分支时生成被放弃路径的摘要
- 恢复会话时按压缩边界重建上下文

约束也要说清：摘要无法做到无损；摘要本身要调用模型，消耗 token 与时间；压缩完成后的旧 `usage` 不再代表当前上下文大小。

---

## 2. A：概念与功能讲解

### 2.1 主线：两种压力，两种摘要

```text
同一条分支，历史太长
    旧消息 ──压缩──> 结构化摘要 + 最近消息（compaction 条目）

切换分支，路径改变
    被放弃的分支 ──摘要──> branch summary（挂在目标节点）
```

两者都产出“摘要消息”交给模型，区别在位置与用途：

| | compaction | branch summary |
|---|---|---|
| 触发 | 上下文接近窗口、溢出、手动 `/compact` | 用户导航到另一条分支 |
| 作用 | 替换同一条分支上的旧历史 | 把另一条分支的经历带入当前上下文 |
| 存储 | `compaction` 条目，记录保留起点 | `branch_summary` 条目，记录来自哪个分支 |
| 重建 | 最新压缩条目 + 保留区间 | 摘要消息按时间插入当前路径 |

### 2.2 什么时候压缩

自动压缩有三个入口：

```text
1. 阈值：当前上下文 > 窗口 - reserveTokens
2. 溢出：模型明确报告上下文溢出，或输出被长度截断且可恢复
3. 手动：用户执行 /compact，或扩展调用 compact()
```

默认设置（`compaction.ts`）：

```text
enabled          true
reserveTokens    16384
keepRecentTokens 20000
```

`reserveTokens` 是给下一次请求与摘要输出预留的空间；`keepRecentTokens` 是压缩后希望保留的最近原文量。阈值判断因此是：

```text
shouldCompact = enabled && contextTokens > contextWindow - reserveTokens
```

溢出路径还会做两个保护：

- 报告溢出的 assistant 必须来自当前模型，换模型后旧错误不再触发压缩
- 如果这条消息早于最近一次压缩，忽略它，避免压缩后重复触发

手动压缩会先中止当前 agent 操作，再走同一套准备与摘要流程。

### 2.3 先知道用了多少 token

精确 tokenizer 代价高。实现采用“最近一次 usage + 之后的消息估算”：

```text
tokens = 最后一条有效 assistant.usage 的总量
       + usage 之后每条消息的估算值
```

- 有效 `usage` 会跳过中止、错误和全零的记录
- `usage.totalTokens` 缺失时，用输入、输出、缓存读写相加
- 消息估算用字符数除以 4，图片按固定字符数折算
- 估算故意偏大，提前压缩比溢出安全

压缩之后，最后一条 assistant 的 `usage` 记录的是压缩前的上下文。界面查询当前占用时会检查“压缩之后是否还有有效 usage”，没有就返回未知，避免展示错误数字。

### 2.4 切点：保留最近一段完整工作

压缩不能随便从中间截断。工具调用与工具结果必须成对，切在工具结果前面会让模型看到没有来源的结果。

切点规则：

- 可以作为切点：用户消息、助手消息、bash 执行、自定义消息、分支摘要、压缩摘要
- 不能作为切点：工具结果
- 切在带工具调用的助手消息上时，该消息保留，它的工具结果自然排在后面
- 压缩条目本身不能作为切点

算法从最新消息向前累加，达到 `keepRecentTokens` 后停下，再退到这条之后最近的一个合法切点。切点前的纯元数据条目（模型切换、思考级别切换等）会一并纳入保留范围，避免边界信息丢失。

```text
最近消息 token 累加 ──达到预算──> 找最近的合法切点
                                      │
                          落在一轮开头？──是──> 直接保留
                                      │
                                      否
                                      ↓
                          记录该轮起点，进入 split turn
```

### 2.5 split turn：一轮太大时的折中

如果最近一轮本身就超过预算，切点会落在这一轮中间。整轮保留会超预算，整轮丢掉会失去当前任务。

处理方式是把这一轮拆成两段：

- 切点之前的前半轮单独摘要，重点写“用户要什么、早期做了什么、后半段需要哪些背景”
- 切点之后的后半轮保留原文
- 最终摘要 = 历史摘要 + 分隔线 + 前半轮摘要

这样模型既知道这一轮的起点，也能看到最近的具体操作。

### 2.6 摘要写什么

摘要使用固定结构，要求模型按小节输出：

```text
## Goal
## Constraints & Preferences
## Progress
  ### Done
  ### In Progress
  ### Blocked
## Key Decisions
## Next Steps
## Critical Context
```

几个实现细节：

- 对话先转成普通消息，再序列化成文本，放进 `<conversation>` 标签。模型是在“读一段对话”，不会把摘要请求当成继续对话
- 如果之前压缩过，会带上 `<previous-summary>`，并要求“保留旧信息、合并新进展”
- 自定义指令追加到提示末尾，不替换默认格式
- 摘要输出上限取 `0.8 * reserveTokens` 与模型输出上限的较小值
- 摘要请求禁止调用工具；出现工具调用或长度截断都视为失败
- 摘要请求不复用 prompt cache，避免为一次性请求写缓存
- 失败按配置的重试策略重试

### 2.7 文件清单：低成本保留关键事实

工具调用里包含文件路径。实现会从所有被摘要的消息中提取两类文件：

```text
readFiles       读过的文件
modifiedFiles   修改过的文件
```

这些清单会追加到摘要末尾，并写入压缩条目的 `details`。下一次压缩时，旧清单会继承，所以文件信息不会因为多轮压缩而丢失。

### 2.8 一次压缩的完整流程

```text
1. 取当前物理路径（root 到 leaf）
2. 如果最后一条已经是压缩条目，停止
3. 找到上一次压缩边界 previousSummary 与 boundaryStart
4. 估算 tokensBefore
5. 在边界内找切点，得到 firstKeptEntryId、是否 split turn
6. 收集要摘要的历史消息与前半轮消息
7. 提取文件操作
8. 调模型生成摘要；split turn 时合并两段
9. 追加文件清单
10. 返回 CompactionResult
11. SessionManager 追加 compaction 条目
```

`CompactionResult` 的关键字段：

| 字段 | 含义 |
| --- | --- |
| `summary` | 最终摘要文本 |
| `firstKeptEntryId` | 从这里开始的条目保留原文 |
| `tokensBefore` | 压缩前估算的上下文 token |
| `usage` | 生成摘要消耗的 token |
| `details` | 文件清单等扩展数据 |

### 2.9 恢复时怎么使用摘要

会话文件保留完整历史，压缩只影响“发给模型的内容”。重建上下文时：

```text
最新 compaction 条目
  + firstKeptEntryId 到 compaction 之间的条目
  + compaction 之后的条目
```

被压缩掉的条目仍然在磁盘上，可以审计、导出或回退，只是不进入请求。

`compaction` 条目会转换成一条 `compactionSummary` 消息，带固定前后缀：

```text
The conversation history before this point was compacted into the following summary:
<summary>
...
</summary>
```

`branch_summary` 条目转换成 `branchSummary` 消息，前缀说明“这是从另一条分支返回时的摘要”。

### 2.10 分支摘要：把另一条路带回来

用户从当前分支导航到旧节点时，被放弃的路径不会自动出现在新上下文里。分支摘要负责把这段经历压缩成一条消息，挂在导航目标之后。

流程：

```text
1. 从旧 leaf 向上走，直到与新目标的公共祖先
2. 收集这条被放弃路径上的条目（按时间正序）
3. 按 token 预算准备消息：从新到旧累加，超出预算就停
4. 摘要条目即使超出预算，只要当前用量低于 90% 也尽量保留
5. 序列化对话，调用同一个摘要模型
6. 生成 branch_summary 条目，记录 fromId
7. 切换 leaf，下一次请求带上 branchSummary 消息
```

`fromId` 记录旧分支的末端，摘要条目自身挂在目标位置。这样文件里能看出“从哪里来、回到哪里”。

分支摘要也提取文件操作，并继承嵌套分支摘要里的文件清单。

### 2.11 触发者与协作关系

```text
AgentSession
  ├─ 响应结束、下一次提示前：检查阈值与溢出
  ├─ 手动 /compact、RPC、扩展：直接调用 compact()
  ├─ 扩展钩子 session_before_compact：可取消或提供自定义结果
  └─ 发出 compaction_start / compaction_end 事件

Compaction 模块
  ├─ 估算 token、找切点、准备摘要输入
  ├─ 调用模型生成摘要
  └─ 返回 CompactionResult

SessionManager
  ├─ appendCompaction：写入 compaction 条目
  ├─ branchWithSummary：写入 branch_summary 条目
  └─ getEntryPath：提供当前路径

上下文重建
  ├─ selectContextEntries：按压缩边界裁剪
  └─ entryToContextMessages：摘要条目转成消息
```

设置来自 `settings.json`：自动压缩开关、`reserveTokens`、`keepRecentTokens`，以及分支摘要的 `reserveTokens` 与 `skipPrompt`。

### 2.12 设计取舍

| 取舍 | 原因 |
|---|---|
| 字符数除以 4 估算 | 便宜、稳定，偏大估算更安全 |
| 复用最后一次 usage | 比逐条精确计数便宜，误差只来自之后少量消息 |
| 摘要用独立请求 | 不污染主对话，也不触发工具 |
| split turn 两段摘要 | 避免整轮丢弃导致当前任务断线 |
| 文件清单跟随摘要 | 路径信息比自然语言更可靠，且成本极低 |
| 摘要失败不写入 | 长度截断或工具调用会产生不可靠的“记忆” |
| 压缩后返回未知占用 | 旧 usage 已经不能代表新上下文 |

### 2.13 与整体系统的关系

```text
课程 09 的 agent 循环
      ↓ 产出 assistant 消息与 usage
课程 13 的会话存储
      ↓ 物理路径、compaction / branch_summary 条目
本课的压缩与分支摘要
      ↓ 摘要文本、切点、文件清单
上下文重建
      ↓ 裁剪后的消息列表
下一次模型请求
```

压缩是“会话层”的能力，不改变 agent 循环本身。AgentSession 负责在合适的时机调用它，SessionManager 负责持久化，压缩模块只关心如何把一段历史变成可靠的摘要。

### 2.14 小结

| 结论 | 说明 |
|---|---|
| 两种摘要解决两种问题 | compaction 处理长历史，branch summary 处理分支切换 |
| 压缩保留最近原文 | 按 `keepRecentTokens` 找合法切点，工具结果不能切 |
| 大轮次拆两段 | 前半轮摘要，后半轮保留 |
| 摘要结构化 | Goal、Progress、Decisions、Next Steps、Critical Context |
| 文件清单随摘要传递 | 路径与改动不依赖自然语言记忆 |
| 磁盘历史不删 | 只裁剪发送给模型的内容 |
| 摘要不是无损 | 失败、截断、工具调用都要拒绝写入 |

---

## 3. 讨论与确认记录

| 日期 | 类型 | 内容 | 对 B 的影响 |
| --- | --- | --- | --- |
| 2026-11-26 | 进度 | 课程 14 验收通过，开始课程 15 A | 待 A 完成后讨论 B |
| 2026-11-26 | 学习 | 用户读完 A | 进入 B 讨论 |
| 2026-11-26 | 确认 | 四项按原项目：同一 `StreamFn`、`retryAssistantCall`、`appendCompaction` 补齐参数、分支摘要只做生成与存储 | B 通过，写入 D-082 至 D-085 |

---

## 4. B：具体实现规划

> B 已实现（2026-11-26）。任务 T-15-1 至 T-15-5；决策见 `BUILD_PLAN.md` D-082 至 D-085。

### 4.1 原项目实现

| 文件 | 职责 |
| --- | --- |
| `core/compaction/compaction.ts` | 估算 token、判断阈值、找切点、生成摘要、组装 `CompactionResult` |
| `core/compaction/branch-summarization.ts` | 收集被放弃的分支、按预算裁剪、生成分支摘要 |
| `core/compaction/utils.ts` | 文件操作统计、消息序列化、摘要系统提示 |
| `core/session-manager.ts` | `getLatestCompactionEntry`、`appendCompaction`、`branchWithSummary`、`selectContextEntries` |
| `core/messages.ts` | `compactionSummary`、`branchSummary` 消息与转换 |
| `core/agent-session.ts` | 触发阈值/溢出压缩、手动压缩、扩展钩子、压缩后继续 |

关键实现：

1. `DEFAULT_COMPACTION_SETTINGS`：`enabled`、`reserveTokens = 16384`、`keepRecentTokens = 20000`。
2. `estimateContextTokens`：复用最后一条有效 assistant 的 `usage`，只估算它之后的消息；单条消息按字符数除以 4，图片按 4800 字符折算。
3. `shouldCompact`：`contextTokens > contextWindow - reserveTokens`。
4. `findCutPoint`：从后往前累加到 `keepRecentTokens`，再退到最近合法切点；工具结果不能切；切在助手消息上时工具结果保留在后。
5. `prepareCompaction`：跳过“最后一条已经是压缩”的情况；从上一次压缩边界继续；产出 `messagesToSummarize`、`turnPrefixMessages`、`firstKeptEntryId`、`tokensBefore`、`previousSummary`、`fileOps`。
6. split turn：切点落在一轮中间时，历史摘要与前半轮摘要分别生成后拼接。
7. `generateSummaryWithUsage`：首次摘要与更新摘要使用不同 prompt；对话转成文本放进 `<conversation>`；自定义指令追加；输出上限 `0.8 * reserveTokens`；摘要请求不允许调用工具，长度截断视为失败。
8. `compact`：返回 `{ summary, firstKeptEntryId, tokensBefore, usage, details }`，`details` 带文件清单。
9. `selectContextEntries`：最新压缩条目 + `firstKeptEntryId` 到压缩之间的条目 + 压缩之后的条目；被压缩的条目仍在磁盘。
10. 分支摘要：从旧 leaf 上溯到公共祖先，按 token 预算从新到旧收集；摘要条目可以越过预算保留；生成后写入 `branch_summary`，记录 `fromId`。
11. 扩展钩子 `session_before_compact` 可以取消或直接提供结果；压缩前后发事件。
12. 压缩后旧的 `usage` 不再代表当前上下文，界面查询会等压缩后的新响应。

### 4.2 新项目实现建议

建议新增：

```text
packages/harness/src/compaction/
├── types.ts                 CompactionSettings、CompactionResult、CompactionPreparation
├── estimate.ts              token 估算、阈值判断
├── utils.ts                 文件操作、消息序列化、摘要系统提示
├── compaction.ts            切点、摘要生成、split turn、compact
├── branch-summarization.ts  分支收集、预算裁剪、分支摘要
└── index.ts
```

会话层扩展：

| 文件 | 改动 |
| --- | --- |
| `session/types.ts` | 新增 `BranchSummaryEntry`；`CompactionEntry` 已有，`appendCompaction` 增加 `details`、`usage`、`fromHook` |
| `session/messages.ts` | 新增 `BranchSummaryMessage` 与 `convertToLlm` 分支；`compactionSummary` 已存在 |
| `session/context.ts` | `entryToContextMessages` 支持 `branch_summary` |
| `session/manager.ts` | 新增 `getLatestCompactionEntry`、`branchWithSummary`；`appendCompaction` 补齐参数 |

不在本课：

- `AgentSession` 的触发、事件、扩展钩子（课程 17、20）
- `SettingsManager` 的读取与持久化（课程 16）
- `/compact`、RPC、TUI 交互（课程 19、23）
- 压缩后 `getContextUsage` 的显示逻辑（课程 17）

模型调用建议沿用 `StreamFn`：

```ts
compact(preparation, options: {
  model: Model;
  streamFn: StreamFn;          // 必传，与课程 09 的约定一致
  signal?: AbortSignal;
  customInstructions?: string;
  ...
}): Promise<CompactionResult>
```

摘要请求的上下文只包含系统提示与一条用户消息；不复用主对话状态，不触发工具。

重试有两种做法，见待确认项。

### 4.3 任务拆分

| 任务 | 范围 | 主要文件 |
| --- | --- | --- |
| T-15-1 | 估算与文件操作：`estimateTokens`、`estimateContextTokens`、`shouldCompact`、文件清单、序列化 | `compaction/{types,estimate,utils}.ts` |
| T-15-2 | 压缩核心：切点、prepare、摘要生成、split turn、`compact` | `compaction/compaction.ts` |
| T-15-3 | 分支摘要：收集、预算裁剪、生成 | `compaction/branch-summarization.ts` |
| T-15-4 | 会话层：`BranchSummaryEntry`、消息转换、上下文重建、`getLatestCompactionEntry`、`branchWithSummary`、`appendCompaction` 扩展 | `session/{types,messages,context,manager}.ts` |
| T-15-5 | 导出、测试与 changelog | `index.ts`、`test/compaction/*`、`CHANGELOG.md` |

### 4.4 测试与验收

- 估算：无 usage 全量估算；有 usage 只估后续；图片与工具调用参数计入
- 阈值：`enabled`、`reserveTokens` 边界
- 切点：预算边界、工具结果不可切、辅助消息保留、split turn 识别
- `prepareCompaction`：首次与二次压缩边界、最后一条已压缩、空内容
- 摘要：首次/更新 prompt、自定义指令、split turn 拼接、文件清单、长度截断与工具调用失败
- 分支摘要：公共祖先收集、预算裁剪、空分支、摘要条目越预算保留
- 会话：`branchWithSummary` 写入与路径重建、`selectContextEntries` 裁剪、`branchSummary` 转消息
- 模型调用用测试 stream，不访问真实 provider

### 4.5 已确认结论

| 事项 | 结论 |
| --- | --- |
| 模型调用接口 | 沿用同一个 `StreamFn`，调用方可选传入 `completeSimple` 回调兜底（D-082） |
| 摘要重试 | 在 `@pipi/llm` 增加 `retryAssistantCall` 与策略类型（D-083） |
| `appendCompaction` 参数 | 补齐 `details`、`usage`、`fromHook`（D-084） |
| 分支摘要的导航集成 | 本课只做生成与存储，导航在 17/23 课（D-085） |
