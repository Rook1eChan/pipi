# 13 会话持久化与分支

> 课程状态：验收通过
> 覆盖模块：`coding-agent/src/core/session-manager.ts`、`messages.ts`、`session-export.ts`、`session-cwd.ts`
> 课程文件：13-session-persistence.md
> 本课产出：对话能落盘、能恢复、能回退，也能从一个旧节点分叉出新的尝试。

---

## 0. 阅读前

| 术语 | 含义 |
| --- | --- |
| entry | 会话文件里的一行记录，带 `id` 与 `parentId`。 |
| leaf | 当前的“叶”节点，下一次追加会挂在它下面。 |
| branch | 把 leaf 指回旧节点，之后的追加形成新分支。 |
| resume | 从文件恢复会话，重建消息列表与模型状态。 |
| compaction | 上下文压缩条目，用摘要替代被裁掉的历史。 |
| branch summary | 离开一条分支时生成的摘要，避免上下文断裂。 |

---

## 1. 构建目标

Agent 的对话只在内存里，进程退出就没了。需要四件事：

1. **恢复**：下次启动接着上次的对话继续
2. **回退**：改掉一条消息，从那里重新走
3. **分叉**：同一处尝试两个方向，分别保留
4. **长会话**：压缩旧内容后，历史还能重建

约束是**不能因为崩溃或中断丢整份会话**，所以文件格式必须支持“只追加”。

---

## 2. A：概念与功能讲解

### 2.1 主线：存什么、怎么存、怎么还原

```text
存什么    消息、模型切换、思考级别、压缩、分支摘要
怎么存    每行一个 JSON 事件，id + parentId 连成树
怎么还原  从 leaf 沿 parentId 上溯到根，裁剪压缩段，转成消息
```

三个问题分别对应 `SessionEntry`、`SessionManager`、`getSessionContext()`。

### 2.2 文件格式：一行一个 JSON

会话文件是 `.jsonl`，第一行是头部，之后每行一个条目：

```ts
export interface SessionHeader {
	type: "session";
	id: string;
	timestamp: string;
	projectDir: string;
	parentSession?: string;   // fork 来源
}
```

实际文件长这样（省略细节字段）：

```jsonl
{"type":"session","id":"a1b2","timestamp":"2026-11-25T10:00:00.000Z","projectDir":"/work/project"}
{"type":"message","id":"e1","parentId":null,"timestamp":"2026-11-25T10:00:01.000Z","message":{"role":"user","content":"读一下 read.ts"}}
{"type":"message","id":"e2","parentId":"e1","timestamp":"2026-11-25T10:00:02.000Z","message":{"role":"assistant","content":[...]}}
```

为什么不用“一个大的 JSON 数组”：

| 做法 | 崩溃/中断后的结果 |
|---|---|
| 整个数组重写 | 写到一半可能留下半截 JSON，整份损坏 |
| 每行一个 JSON 追加 | 最多丢最后一行，前面的都能解析 |

读取时逐行解析，坏行直接跳过：

```ts
function parseSessionEntryLine(line: string): FileEntry | null {
	if (!line.trim()) return null;
	try {
		return JSON.parse(line) as FileEntry;
	} catch {
		return null;
	}
}
```

### 2.3 八种条目

```ts
export type SessionEntry =
	| SessionMessageEntry        // 一条对话消息
	| ThinkingLevelChangeEntry   // 思考级别切换
	| ModelChangeEntry           // 模型切换
	| CompactionEntry            // 上下文压缩
	| BranchSummaryEntry         // 分支摘要
	| CustomEntry                // 扩展私有数据，不进上下文
	| CustomMessageEntry         // 扩展注入的消息，进上下文
	| SessionInfoEntry;          // 会话元信息，例如显示名
```

这些条目共享一个基类：

```ts
export interface SessionEntryBase {
	type: string;
	id: string;
	parentId: string | null;
	timestamp: string;
}
```

`type` 是判别字段，`id`/`parentId` 构成树。模型切换、思考级别这些不是消息，但必须记录下来，否则恢复后模型状态会退回默认值。

### 2.4 树结构：leaf 指针决定往哪写

```ts
private leafId: string | null = null;

appendMessage(message) {
	const entry = {
		type: "message",
		id: generateId(this.byId),
		parentId: this.leafId,          // 挂在当前叶下
		timestamp: new Date().toISOString(),
		message,
	};
	this._appendEntry(entry);          // push + 索引 + 更新 leaf
	return entry.id;
}
```

`_appendEntry` 做三件事：加入内存列表、登记到 `byId`、把 `leafId` 指向新条目。

回退只移动指针：

```ts
branch(branchFromId: string): void {
	if (!this.byId.has(branchFromId)) throw new Error(`Entry ${branchFromId} not found`);
	this.leafId = branchFromId;
}
```

没有任何条目被删除或改写。之后的新消息成为旧节点的另一个子节点，两条分支持续共存于同一文件。

### 2.5 上下文重建：从叶到根

LLM 只认线性消息列表，所以要把树“取直”：

```ts
getEntryPath(fromId?: string): SessionEntry[] {
	const path: SessionEntry[] = [];
	let current = this.byId.get(fromId ?? this.leafId);
	while (current) {
		path.push(current);
		current = current.parentId ? this.byId.get(current.parentId) : undefined;
	}
	path.reverse();
	return path;
}
```

这条路径包含**所有物理条目**，包括已经被压缩的旧内容和被放弃的分支摘要。

接着裁剪：

```ts
export function selectContextEntries(path: SessionEntry[]): SessionEntry[] {
	let compaction: CompactionEntry | null = null;
	for (const entry of path) if (entry.type === "compaction") compaction = entry;
	if (!compaction) return path;
	// 摘要排在最前，之后是 firstKeptEntryId 到压缩点的条目，再之后是压缩之后的条目
}
```

最后逐条转成消息：

```ts
entryToContextMessages(entry)  // message → 原消息；custom_message → 用户消息；
                               // compaction → 摘要消息；branch_summary → 摘要消息；其余 → []
```

模型与思考级别另外重放，用的是**未裁剪**的完整路径，这样压缩前的模型切换依然生效：

```ts
getSessionContext(): SessionContext {
	const path = this.getEntryPath();
	const { thinkingLevel, model } = getSessionContextSettings(path);
	const messages = selectContextEntries(path).flatMap(entryToContextMessages);
	return { messages, thinkingLevel, model };
}
```

### 2.6 压缩与分支摘要

压缩条目记录“从哪里开始保留”：

```ts
export interface CompactionEntry extends SessionEntryBase {
	type: "compaction";
	summary: string;
	firstKeptEntryId: string;   // 这条及其之后的条目保留，之前的被摘要替代
	tokensBefore: number;
}
```

离开一条分支时，可以顺手生成摘要：

```ts
branchWithSummary(branchFromId, summary) {
	const fromId = this.leafId ?? "root";
	this.leafId = branchFromId;
	// 追加 branch_summary 条目，fromId 记录从哪条分支离开
}
```

两者区别：compaction 替换历史，branch_summary 说明“我从另一条路过来”。细节在课程 15 展开。

### 2.7 抽取单条分支

树在一个文件里，想单独拿走一条路径：

```ts
createBranchedSession(leafId: string): string | undefined {
	const path = this.getEntryPath(leafId);
	const header = { type: "session", id: newSessionId, ..., parentSession: previousSessionFile };
	this.fileEntries = [header, ...path.map((entry) => ({ ...entry }))];
	// 写入新文件
}
```

`getEntryPath` 返回的链天然满足 `parentId` 自洽，直接搬过去即可。新文件的 header 用 `parentSession` 指回原会话。

### 2.8 何时写盘，怎么恢复

写盘是延迟的：第一条用户消息不会立刻建文件，等到出现助手消息才把内存里的条目一次写出：

```ts
_persist(entry: SessionEntry): void {
	const hasAssistant = this.fileEntries.some((e) => e.type === "message" && e.message.role === "assistant");
	if (!hasAssistant) {
		this.flushed = false;   // 等 assistant 到来再统一写
		return;
	}
	if (!this.flushed) {
		const fd = openSync(this.sessionFile, "wx");
		for (const e of this.fileEntries) writeFileSync(fd, `${JSON.stringify(e)}\n`);
		this.flushed = true;
	} else {
		appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
	}
}
```

这样避免留下“只有提问、没有任何回复”的残缺会话文件。

恢复时按修改时间找最近的会话：

```ts
export function findMostRecentSession(sessionDir: string, projectDir?: string): string | null {
	const files = readdirSync(sessionDir)
		.filter((f) => f.endsWith(".jsonl"))
		.map((path) => ({ path, header: readSessionHeaderForDiscovery(path) }))
		.filter((file) => file.header !== null && (!projectDir || sameProjectDir(file.header.projectDir, projectDir)))
		.map(({ path }) => ({ path, mtime: statSync(path).mtime }))
		.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
	return files[0]?.path || null;
}
```

### 2.9 容错与格式约定

| 情况 | 处理 |
|---|---|
| 某行 JSON 损坏 | 跳过该行，保留其余内容 |
| 文件为空 | 补一个合法 header 后继续 |
| 文件非空但不是会话 | 报错，不覆盖原文件 |
| 旧格式会话 | 不保留迁移；格式变更后旧文件直接不兼容（D-071） |
| 末尾没有换行 | 读取后补一个 `\n`，保证后续追加不粘连 |

### 2.10 存储位置

```text
~/.pipi/agent/sessions/--work-project--/2026-11-25T10-00-00-000Z_<id>.jsonl
```

目录名由 projectDir 转义而来，文件名由时间戳与 id 组成。这样同一个项目的会话聚在一起，不同项目不混。

### 2.11 与整体系统的关系

```text
@pipi/agent             Agent 只产生事件
      ↑ 订阅 message_end / model_change 等
@pipi/harness           本课：SessionManager、消息类型、导出
      ↑ 启动时读取、结束前追加
@pipi/harness 会话编排   课程 17：AgentSession 把工具、会话、压缩串起来
```

分工要点：Agent 不知道文件存在。`AgentSession` 订阅事件后调用 `appendMessage` 等方法，恢复时用 `getSessionContext()` 直接构造 `Agent` 的初始状态。

### 2.12 小结

| 结论 | 说明 |
|---|---|
| 文件是事件流 | 一行一个 JSON，追加写入，崩溃只丢最后一行 |
| 树靠 id/parentId | 分支只移动 leaf 指针，旧数据不删 |
| 上下文靠上溯 + 裁剪 | 沿 parentId 到根，再让 compaction 替换旧段 |
| 状态单独重放 | 模型与思考级别不混在消息里 |
| 延迟写盘 | 没有助手回复前不建文件 |
| 恢复按最近修改 | 目录按 projectDir 分组，文件按时间排序 |

---

## 3. 讨论与确认记录

| 日期 | 类型 | 内容 | 对 B 的影响 |
| --- | --- | --- | --- |
| 2026-11-25 | 范围 | 课程 13 改为会话持久化（原工具治理课取消，D-068） | A 讲文件格式、树与恢复 |
| 2026-11-25 | 确认 | 扩展条目本课实现，分支摘要后置到课程 15 | B 范围收敛为 5 个任务 |
| 2026-11-25 | 决策 | 不保留会话版本与迁移，只读写当前格式（D-071） | 删除版本字段与迁移函数 |
| 2026-11-25 | 实现 | T-13-1、T-13-2 落地：条目、JSONL、树、压缩裁剪、上下文重建 | 实现位置已补入 B |
| 2026-11-25 | 实现 | T-13-3 至 T-13-5 落地：分叉、抽取单路径、会话发现、JSONL 导出 | 课程 13 进入待验收 |
| 2026-11-25 | 补漏 | 名称写入清洗、读取取最后一条、空名称视为清除 | 列表与界面共用同一规则 |
| 2026-11-25 | 验收 | 用户验收 T-13-1 至 T-13-5 | 课程 13 完成 |

---

## 4. B：具体实现规划

> B 已确认（2026-11-25）。决策见 `BUILD_PLAN.md` D-069 至 D-071；任务 T-13-1 至 T-13-5。

实现位置：`packages/harness/src/session/`（`types.ts`、`manager.ts`、`context.ts`、`messages.ts`、`name.ts`、`discovery.ts`、`export.ts`）。

### 4.1 原项目实现

| 文件 | 行数 | 职责 |
| --- | ---: | --- |
| `core/session-manager.ts` | 1642 | 条目类型、JSONL 读写、树、分支、压缩与导出、会话发现 |
| `core/messages.ts` | 195 | 自定义消息类型与转 LLM 消息的转换器 |
| `core/session-export.ts` | 42 | 把当前分支导出成独立 JSONL |
| `core/session-cwd.ts` | 60 | 会话与工作目录的匹配 |

相关测试在 `coding-agent/test/session-manager/*`（加载、保存、分支、树遍历等）。原项目还含旧版本迁移测试，本项目不保留迁移。

### 4.2 新项目实现建议

| 模块 | 建议 | 原因 |
| --- | --- | --- |
| 条目类型与 JSONL 读写 | 复现 | 格式是兼容性的核心 |
| 树与上下文重建 | 复现 | 分支与压缩都依赖它 |
| 延迟写盘 | 复现 | 避免残缺会话 |
| 分支与 `createBranchedSession` | 复现 | 回退与分叉的产品基础 |
| 分支摘要 | 后置到课程 15（D-070） | 摘要生成依赖压缩逻辑 |
| 会话导出（JSONL） | 复现 | 仅 42 行，输出当前分支 |
| 会话目录 | `~/.pipi/agent/sessions/--projectDir--` | 结构与原项目一致，前缀换成本项目名称 |
| 扩展条目（custom / custom_message） | 复现（D-069） | 本课实现，读取时未知类型忽略 |
| `bashExecution` 消息 | 后置 | 属于交互模式（课程 23） |
| HTML 导出 / 分享 | 后置 | 展示层需求 |
| `forkFrom`（跨项目派生） | 后置到课程 16 | 属于 CLI 的 `--fork` 命令 |
| `listAll` 与进度回调 | 不实现 | 只做单目录 `listSessions` 与最近会话 |
| 文件锁 | 不复现 | 原项目会话文件也采用单进程假设 |

### 4.3 建议任务拆分

| 任务 | 范围 |
| --- | --- |
| T-13-1 | 条目类型与 JSONL 读写：头部、逐行解析、延迟写盘 |
| T-13-2 | 树与上下文重建：`id`/`parentId`、`getEntryPath`、`selectContextEntries`、消息转换 |
| T-13-3 | 分支：`branch`、`branchWithSummary`、`createBranchedSession` |
| T-13-4 | 会话发现与恢复：目录规则、最近会话、projectDir 匹配 |
| T-13-5 | 与 `AgentSession` 的接线（课程 17 完成） |

### 4.4 复现选项

| 选项 | 范围 |
| --- | --- |
| A | 完整复现四个文件，含扩展条目与导出 |
| B（建议） | 复现核心：条目、树、分支、恢复；扩展条目与导出后置 |
| C | 只做消息追加与恢复，不做分支 |

### 4.5 已确认结论

已写入 `BUILD_PLAN.md` 决策表，此处只列结论。

| 事项 | 结论 |
| --- | --- |
| 扩展条目 | 本课实现 `custom`、`custom_message`、`session_info`（D-069） |
| 分支摘要 | 后置到课程 15（D-070） |
