# 14 提示、上下文与技能

> 课程状态：待用户验收
> 覆盖模块：`coding-agent/src/core/system-prompt.ts`、`resource-loader.ts`、`skills.ts`、`prompt-templates.ts`、`package-manager.ts`（资源解析部分）、`source-info.ts`、`diagnostics.ts`
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
默认说明（身份、工具、指南）
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
2. 项目：从项目目录逐级向上，直到根目录
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
~/.pipi/agent/skills/              全局
<projectDir>/.pipi/skills/         项目
~/.agents/skills/                  共享
项目目录到 git 根之间各层的 .agents/skills
外加显式传入的路径
```

目录发现规则：目录里有 `SKILL.md` 时它就是技能入口，不再向子目录递归；根目录的 `.md` 文件也可以作为技能；`.agents/skills` 里则取子目录中的 `.md`。

校验规则来自 Agent Skills 规范：

| 字段 | 规则 |
|---|---|
| `name` | 最长 64，仅小写字母、数字、连字符；不以连字符开头或结尾；不允许连续连字符 |
| `description` | 最长 1024，不能为空 |

名称缺失时回退到技能目录名。名称或描述不合法只产生 warning，技能仍然加载；只有描述缺失或为空才跳过。

同名技能先到先得，后者记为冲突诊断（`collision`），不会覆盖。

拼进提示的只有索引：

```xml
<available_skills>
  <skill>
    <name>pdf-processing</name>
    <description>处理 PDF：抽取文本、合并、拆分</description>
    <location>/home/u/.pipi/agent/skills/pdf-processing/SKILL.md</location>
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

模板来源与技能类似：全局 `agentDir/prompts/`、项目 `<projectDir>/.pipi/prompts/`、显式路径。目录只取当前层的 `.md`，不递归。

### 2.7 资源解析器与加载器

资源分成两层。

`ResourceResolver` 负责“资源在哪里”：

| 输入 | 输出 |
|---|---|
| settings 条目、默认目录、包的资源清单 | `ResolvedResource { path, enabled, metadata }` |

它做目录展开、ignore 规则、启用/禁用模式、优先级排序与真实路径去重，不读取文件内容。

`ResourceLoader` 负责“拿到路径后怎么装载”：

| 方法 | 内容 |
|---|---|
| `getSystemPrompt()` | 覆盖用的自定义系统提示 |
| `getAppendSystemPrompt()` | 追加片段集合 |
| `getAgentsFiles()` | 项目上下文文件 |
| `getSkills()` | 技能与诊断 |
| `getPrompts()` | 命令模板与诊断 |
| `getExtensions()` | 扩展（课程 20） |
| `reload()` / `extendResources()` | 全量重载与增量追加 |

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
SettingsManager → ResourceResolver
                         ↓ 路径 + 来源 + enabled
文件系统：AGENTS.md、SKILL.md、prompts/*.md
      ↓ 读取
ResourceLoader（装载 + 诊断）
      ↓ 结构化数据
buildSystemPrompt（拼装）
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
| 解析与装载分离 | resolver 产出路径，loader 只负责读取与构造 |
| 加载入口有两条 | `reload()` 全量，`extendResources()` 增量 |

---

## 3. 讨论与确认记录

| 日期 | 类型 | 内容 | 对 B 的影响 |
| --- | --- | --- | --- |
| 2026-11-25 | 范围 | 课程 13 验收后开始课程 14 | A 先讲拼装与按需加载 |
| 2026-11-26 | 实现 | 先做 T-14-1：系统提示拼装；默认提示暂时省略原项目的 pi 文档路径段 | 其余任务等待 B 确认 |
| 2026-11-26 | 实现 | T-14-2：项目规则加载；worktree 重复检测未做 | 候选优先级与向上继承已落地 |
| 2026-11-26 | 实现 | T-14-3 至 T-14-5：技能、命令模板、资源加载器；技能按名称排序以保证输出稳定 | 课程 14 进入待验收 |
| 2026-11-26 | 命名 | 选项字段 `cwd` 改为 `projectDir`，与 `agentDir` 对齐（D-075） | 资源加载相关接口统一 |
| 2026-11-26 | 修正 | 补回此前的删减：override、来源、`extendResources`、异步 reload、ignore 文件、符号链接、冲突详情、worktree 遮盖 | 目录改为 `resources/` + `prompt/` |
| 2026-11-26 | 设计 | 用户指出实现与源码差别过大；梳理原项目的 settings → resolver → loader 三层结构 | B 重写为 resolver + loader 两层，配置层后置 |
| 2026-11-26 | 确认 | resolver 只管解析，loader 只管装载；`extendResources` 不改名；项目规则独立文件；本课不写文档路径段 | 见 D-076 至 D-080 |
| 2026-11-26 | 修正 | 除已决策项外，第一部分逻辑与原项目对齐：精确 `+/-` 匹配、缺失 settings 条目静默跳过、读取失败输出 warning、Windows 路径规范化 | 测试同步调整 |
| 2026-11-26 | 命名 | 项目自身品牌统一为 `pipi`：清单 `pipi.extensions`、环境变量 `PIPI_*`、技能发现模式 `pipi` | 见 D-081 |

---

## 4. B：具体实现规划

> B 已实现（2026-11-26）。实现位置：`packages/harness/src/resources/`（解析与装载）、`packages/harness/src/prompt/`（拼装）、`packages/harness/src/utils/`（路径与通用工具）。决策见 `BUILD_PLAN.md` D-073、D-075 至 D-080；任务 T-14-1 至 T-14-5。

### 4.1 原项目实现

资源不只由一个 loader 扫描目录。原项目分成三层：

```text
SettingsManager                   配置与信任
      ↓ settings 条目
DefaultPackageManager.resolve()   把条目、包与默认目录展开成路径
      ↓ ResolvedResource[]（带 metadata、enabled）
DefaultResourceLoader             按路径装载五类资源
      ↓ getter
AgentSession / buildSystemPrompt
```

| 文件 | 行数 | 职责 |
| --- | ---: | --- |
| `core/settings-manager.ts` | 1389 | 读取全局与项目 settings，维护 project trust |
| `core/package-manager.ts` | 2636 | 解析包与本地目录，产出 `ResolvedResource[]`；本课只取解析部分 |
| `core/resource-loader.ts` | 921 | 编排装载顺序、系统提示来源、override、来源标记 |
| `core/skills.ts` | 509 | 技能发现、frontmatter 校验、冲突诊断、提示索引 |
| `core/prompt-templates.ts` | 285 | 命令模板加载、参数解析与占位符替换 |
| `core/source-info.ts` | 40 | `SourceInfo` 与 `PathMetadata` |
| `core/diagnostics.ts` | 15 | 警告、错误与冲突类型 |
| `core/system-prompt.ts` | 149 | 纯函数拼装 |

关键实现点：

1. `ResourceLoader` 构造函数只保存配置，`reload()` 才装载；`sdk.ts` 创建 session 时 `await reload()`。
2. `resolve()` 先处理 project settings，再处理 user settings，随后扫描默认目录；同一路径先到先得。
3. 结果按 `project-local(0) > project-auto(1) > user-local(2) > user-auto(3) > package(4)` 排序，再按真实路径去重，所以项目级资源在重名时胜出。
4. 目录展开规则：技能用 `collectSkillEntries`（`SKILL.md`、根 `.md`、`.agents` 子目录 `.md`），模板只取当前层 `.md`，扩展读取 `pipi.extensions` 或 `index.ts`。
5. `reload()` 用 `includeDefaults: false` 装载技能与模板，默认目录只在 resolver 阶段出现。
6. `extendResources()` 接收带 `metadata` 的路径，只重载技能或模板，不重新解析 settings。
7. 项目规则在 loader 内部查找；`SYSTEM.md` 与 `APPEND_SYSTEM.md` 也由 loader 解析来源，项目级需要 trust。
8. 来源标记在 loader 统一补：显式来源表 → metadata 精确匹配 → 路径前缀匹配 → 默认 agent/project/temporary。
9. 扩展默认由 loader 装载；本课先留 `loadExtensions` 接缝，课程 20 提供真实实现。

### 4.2 新项目实现建议

| 模块 | 建议 | 原因与后果 |
| --- | --- | --- |
| `ResourceSettings` | 定义配置快照：`agentDir`、`projectDir`、`projectTrusted` 与三类资源的 agent/project 条目 | 课程 16 的 `SettingsManager` 直接填充；本课调用方传默认值 |
| `ResourceResolver` | 只做目录展开、enabled 计算、优先级排序与去重，输出 `ResolvedResource[]` | 与 loader 解耦；课程 20 只需把包内路径交给它 |
| `ResourceLoader` | 构造为空，`reload()` 装载；技能与模板用 `includeDefaults: false` | 与原项目的生命周期和职责一致 |
| 技能 | 补齐根目录 `.md`、名称回退父目录名、校验只警告继续加载、保持插入顺序 | 行为与原项目一致 |
| 命令模板 | 返回数组，缺失路径静默跳过，按名去重放在 loader | 去重与冲突诊断集中在 loader |
| 项目规则 | 独立 `context-files.ts`，路径统一走 `utils/paths.ts` | 用户确认独立文件；`~` 与 Unicode 空格可正确解析 |
| 系统提示 | 去掉 pi 文档路径段（D-079） | 文档体系未建好，先不指向不存在的路径 |
| 扩展 | `loadExtensions` 接缝返回空结果；清单字段用 `pipi.extensions` | 课程 20 接入装载器，不改 loader 接口（D-081） |

本课不实现：`SettingsManager`、project trust 的真实判断、npm/git 包安装、扩展执行、`AgentSession` 接入。课程 16 接入前 `projectTrusted` 默认 `true`，避免项目资源被静默禁用。

### 4.3 文件与任务拆分

| 任务 | 范围 | 文件 |
| --- | --- | --- |
| T-14-1 | 系统提示拼装；技能索引格式化归位到 `skills.ts` | `prompt/system-prompt.ts`、`resources/skills.ts` |
| T-14-2 | 路径工具、来源与诊断类型、`ResourceSettings` 契约 | `utils/paths.ts`、`resources/{source-info,diagnostics,settings}.ts` |
| T-14-3 | `ResourceResolver`：默认目录、settings 条目、展开、模式、优先级、诊断 | `resources/resolver.ts` |
| T-14-4 | 技能、命令模板、项目规则按原项目规则加载 | `resources/{skills,prompt-templates,context-files}.ts` |
| T-14-5 | `ResourceLoader` 编排、公共导出、测试与 changelog | `resources/loader.ts`、`index.ts` |

### 4.4 已确认结论

| 事项 | 结论 |
| --- | --- |
| 分层 | resolver 负责路径，loader 负责装载（D-076） |
| 资源归属 | resolver 管 extensions/skills/prompts；项目规则与系统提示在 loader 内（D-077） |
| 加载入口 | `reload()` 全量，`extendResources()` 增量（D-078） |
| 文档路径段 | 本课不实现，文档体系建好后补（D-079） |
| 项目规则文件 | 独立 `resources/context-files.ts`（D-080） |
| 配置目录 | `~/.pipi/agent` 与 `<projectDir>/.pipi`（D-073） |
| 选项命名 | 资源选项用 `projectDir`，提示输出用 `cwd`（D-075） |
| 扩展装载 | 不在本课，留到课程 20 |
