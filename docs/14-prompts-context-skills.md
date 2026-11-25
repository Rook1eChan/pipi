# 14 提示、上下文与技能

> 课程状态：A 学习中
> 覆盖模块：`coding-agent/src/core/system-prompt.ts`、`resource-loader.ts`、`skills.ts`、`prompt-templates.ts`
> 课程文件：14-prompts-context-skills.md
> 本课产出：模型每次请求看到的系统提示，由默认说明、项目规则、技能索引与命令模板拼装而成。

---

## 0. 阅读前

| 术语 | 含义 |
| --- | --- |
| system prompt | 每次请求开头那段固定文本，描述身份、工具与规则。 |
| context file | 项目里的 `AGENTS.md` / `CLAUDE.md`，注入为项目规则。 |
| skill | 一个带 frontmatter 的 `SKILL.md`，描述某类任务的做法。 |
| prompt template | 用户输入 `/name args` 时展开的 Markdown 片段。 |
| frontmatter | 文件顶部 `---` 之间的 YAML 元数据。 |
| resource loader | 统一装载 context file、skill、prompt 模板与系统提示覆盖的组件。 |

---

## 1. 构建目标

Agent 的能力不只来自工具。每次请求还需要告诉模型：

1. 它是什么、有哪些工具可用、遵守哪些规则
2. 这个项目有什么额外要求（`AGENTS.md`）
3. 有哪些“技能说明书”可以按需查阅
4. 用户自定义的 `/命令` 怎么展开

这些内容不能全部塞进提示：技能正文可能很长，项目规则可能有多层。目标是**拼装得当、按需加载**。

---

## 2. A：概念与功能讲解

### 2.1 主线：四类输入拼成一个字符串

```text
默认说明（身份、工具、指南、文档路径）
  + appendSystemPrompt（用户追加）
  + 项目上下文（AGENTS.md 等）
  + 技能索引（只有名称、描述、路径）
  + 当前工作目录
= system prompt
```

入口是 `buildSystemPrompt(options)`：

```ts
export interface BuildSystemPromptOptions {
	customPrompt?: string;
	selectedTools?: string[];
	toolSnippets?: Record<string, string>;
	promptGuidelines?: string[];
	appendSystemPrompt?: string;
	cwd: string;
	contextFiles?: Array<{ path: string; content: string }>;
	skills?: Skill[];
}
```

注意最后三个参数是**已经加载好的内容**：拼装与加载分开，`buildSystemPrompt` 是纯函数，便于测试。

### 2.2 工具列表：有简介才显示

```ts
const visibleTools = tools.filter((name) => !!toolSnippets?.[name]);
const toolsList = visibleTools.map((name) => `- ${name}: ${toolSnippets![name]}`).join("\n");
```

工具是否出现在提示里，取决于它的定义是否提供了 `promptSnippet`。没提供就不列，避免“提示里写了但模型调不到”。

### 2.3 指南：按可用工具生成

固定两条永远存在：

```ts
addGuideline("Be concise in your responses");
addGuideline("Show file paths clearly when working with files");
```

条件生成的一条处理“没有专用搜索工具”的情况：

```ts
if ((hasBash || hasPowerShell) && !hasGrep && !hasFind && !hasLs) {
	addGuideline("Use bash for file operations like ls, rg, find");
}
```

其余来自各工具的 `promptGuidelines`，去重后拼接。

### 2.4 项目上下文：从当前目录向上找

`loadProjectContextFiles` 的顺序：

```text
1. 全局：agentDir 下的 AGENTS.md
2. 项目：从 cwd 逐级向上，直到根目录
```

每一层只取**第一个存在的**候选文件：

```ts
const candidates = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];
```

所以同一个目录里 `AGENTS.override.md` 会遮住 `AGENTS.md`。向上收集时用 `unshift`，保证最终顺序是“从远到近”，离项目近的规则排在后面，更容易被模型当作补充。

去重靠 `seenPaths`，避免同一份文件被全局与项目各加载一次。

拼进提示时带路径：

```ts
prompt += "<project_context>\n\nProject-specific instructions and guidelines:\n\n";
prompt += `<project_instructions path="${filePath}">\n${content}\n</project_instructions>\n`;
```

路径让模型知道规则来自哪个文件，需要时可以自己打开。

### 2.5 技能：只放索引，正文按需读

技能是目录里的 `SKILL.md`：

```markdown
---
name: pdf-processing
description: 处理 PDF：抽取文本、合并、拆分
---

# 步骤
...
```

frontmatter 只有两个必填字段，另有可选开关：

```ts
export interface SkillFrontmatter {
	name?: string;
	description?: string;
	"disable-model-invocation"?: boolean;
}
```

加载位置：

```text
~/.pi/agent/skills/           全局
<cwd>/.pi/skills/             项目
外加显式传入的路径
```

校验规则来自 Agent Skills 规范：

| 字段 | 规则 |
|---|---|
| `name` | 最长 64，仅小写字母、数字、连字符；不以连字符开头或结尾；不允许连续连字符 |
| `description` | 最长 1024，不能为空 |

同名技能先到先得，后者记为冲突诊断（`collision`），不会覆盖。

拼进提示的只有索引：

```xml
<available_skills>
  <skill>
    <name>pdf-processing</name>
    <description>处理 PDF：抽取文本、合并、拆分</description>
    <location>/home/u/.pi/agent/skills/pdf-processing/SKILL.md</location>
  </skill>
</available_skills>
```

正文不注入，模型判断任务匹配后用 `read` 打开 `location`。这样几十个技能也只占几行 token。

`disable-model-invocation: true` 的技能不出现在索引里，只能由用户显式调用。

### 2.6 命令模板：`/name` 的展开

`prompts/` 目录下的 Markdown 就是一个命令：

```markdown
---
description: 审查改动
argument-hint: <文件或目录>
---
请审查 $1 的改动，重点关注 $2。
```

用户输入 `/review src/auth.ts 错误处理`，展开过程：

```text
1. parseCommandArgs   → ["src/auth.ts", "错误处理"]   （支持引号）
2. substituteArgs     → 替换占位符
3. 得到最终文本，当作普通用户消息发送
```

占位符支持：

| 写法 | 含义 |
|---|---|
| `$1` | 第 1 个参数 |
| `$@` / `$ARGUMENTS` | 全部参数 |
| `${1:-默认值}` | 参数缺省时用默认值 |
| `${@:2:3}` | 从第 2 个开始取 3 个 |

模板来源与技能类似：全局 `agentDir/prompts/`、项目 `<cwd>/.pi/prompts/`、显式路径。

### 2.7 资源加载器：把上面几件事收在一起

`DefaultResourceLoader` 统一装载：

| 方法 | 内容 |
|---|---|
| `getSystemPrompt()` | 覆盖用的自定义系统提示 |
| `getAppendSystemPrompt()` | 追加片段集合 |
| `getAgentsFiles()` | 项目上下文文件 |
| `getSkills()` | 技能与诊断 |
| `getPrompts()` | 命令模板与诊断 |
| `getExtensions()` | 扩展（课程 20） |
| `reload()` / `extendResources()` | 运行中重载与追加 |

它还提供 `*Override` 钩子，让产品层在装载结果上做修改；以及 `--no-skills`、`--no-prompts`、`--no-context-files` 这类开关。

### 2.8 拼装时机

```text
启动：加载资源 → 第一次 buildSystemPrompt
切换工具：重新拼（工具列表与指南随之变化）
用户改设置/重载：重新加载 → 重新拼
```

`AgentSession` 负责编排（课程 17）；`buildSystemPrompt` 保持纯函数，输入什么就拼什么。

### 2.9 与整体系统的关系

```text
文件系统：AGENTS.md、SKILL.md、prompts/*.md
      ↓ 读取
resource-loader（装载 + 诊断）
      ↓ 结构化数据
system-prompt（拼装）
      ↓ 字符串
Agent.state.systemPrompt
      ↓
每次模型请求的 system 消息
```

技能正文只有在模型调用 `read` 时才进入上下文，因此技能数量与提示体量解耦。

### 2.10 小结

| 结论 | 说明 |
|---|---|
| 拼装与加载分离 | `buildSystemPrompt` 是纯函数，便于测试 |
| 工具按 snippet 显示 | 没有简介的工具不出现在提示里 |
| 项目规则向上继承 | 近的覆盖远的，带路径注入 |
| 技能只放索引 | 正文由模型按需读取 |
| 命令模板是文本展开 | 不进入系统提示，属于用户消息 |
| 资源加载器统一入口 | 技能、模板、上下文、系统提示覆盖 |

---

## 3. 讨论与确认记录

| 日期 | 类型 | 内容 | 对 B 的影响 |
| --- | --- | --- | --- |
| 2026-11-25 | 范围 | 课程 13 验收后开始课程 14 | A 先讲拼装与按需加载 |

---

## 4. B：具体实现规划

> B 尚未展开。以下只为讨论准备结构。

### 4.1 原项目实现

| 文件 | 行数 | 职责 |
| --- | ---: | --- |
| `core/system-prompt.ts` | 149 | 拼装系统提示 |
| `core/resource-loader.ts` | 921 | 统一装载上下文、技能、模板、扩展与覆盖 |
| `core/skills.ts` | 509 | 技能发现、frontmatter 校验、冲突诊断、提示索引 |
| `core/prompt-templates.ts` | 285 | 命令模板加载、参数解析与占位符替换 |
| `utils/frontmatter.ts` | 约 40 | `---` YAML 解析 |
| `core/diagnostics.ts`、`core/source-info.ts` | 较小 | 诊断类型与来源标记 |

### 4.2 新项目实现建议

| 模块 | 建议 | 原因 |
| --- | --- | --- |
| `buildSystemPrompt` | 复现 | 纯函数，参考点清晰 |
| 上下文文件向上查找 | 复现 | 规则继承是核心行为 |
| 技能加载与索引 | 复现 | 懒加载模式是重点 |
| 命令模板 | 复现 | 参数替换规则固定 |
| 资源加载器 | 简化 | 先只做上下文、技能、模板三项，扩展留到课程 20 |
| worktree shadow 检测 | 后置 | 针对 `git worktree` 的重复上下文，边缘场景 |
| diagnostics 与 sourceInfo | 简化 | 先保留最小诊断，来源标记随扩展系统补 |

配置目录：原项目用 `~/.pi/agent` 与项目内的 `.pi/`；本项目已有 `~/.pipi/sessions`，建议统一到 `~/.pipi` 与项目内 `.pipi/`。

### 4.3 建议任务拆分

| 任务 | 范围 |
| --- | --- |
| T-14-1 | `buildSystemPrompt`：工具列表、指南、上下文与技能拼接 |
| T-14-2 | 上下文文件加载：候选顺序、向上查找、去重 |
| T-14-3 | 技能：发现、frontmatter 校验、冲突处理、提示索引 |
| T-14-4 | 命令模板：加载、参数解析、占位符替换 |
| T-14-5 | 资源加载器汇总、公共导出、测试与 changelog |

### 4.4 复现选项

| 选项 | 范围 |
| --- | --- |
| A | 完整复现四个文件与诊断体系 |
| B（建议） | 复现四项核心能力，简化诊断与 worktree 检测，扩展留到课程 20 |
| C | 只做系统提示拼装与上下文文件 |

### 4.5 待确认决策

| 事项 | 来源 | 选项 | 原仓库做法 |
| --- | --- | --- | --- |
| 资源加载器是否包含扩展装载 | 依赖课程 20 的扩展系统 | 本课只做三项 / 一起做 | `DefaultResourceLoader` 同时装载扩展，并提供 `--no-extensions` |
| worktree 重复上下文检测 | 边缘场景，需要 Git 布局判断 | 后置 / 本课 | `findShadowedContextFile` 识别 linked worktree 并去重 |
| 配置目录 | 本项目已有 `~/.pipi` 约定 | `~/.pipi` 与 `.pipi/` / 沿用 `.pi` | 原项目用 `~/.pi/agent` 与项目 `.pi/` |
