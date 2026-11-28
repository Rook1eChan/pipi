# 16 CLI、配置与项目信任

> 课程状态：待用户验收
> 覆盖模块：`cli/args.ts`、`main.ts`、`config.ts`、`core/settings-manager.ts`、`core/trust-manager.ts`、`core/project-trust.ts`
> 课程文件：16-cli-config-trust.md
> 本课产出：启动参数、agent 级与项目配置、项目信任三件事能串起来，并把结果交给资源加载与模型运行时。

---

## 0. 阅读前

| 术语 | 含义 |
| --- | --- |
| settings | 持久化配置，分 agent 与 project 两层，保存在 `settings.json`。 |
| scope | 配置作用域：`agent`（全局级）或 `project`（项目级）。 |
| trust | 是否允许加载并执行某个项目的本地配置、资源与扩展。 |
| trust store | 记录每个目录信任结论的文件，默认在 agent 目录下的 `trust.json`。 |
| bootstrap settings | 启动早期只读 agent 配置的设置实例，用于决定后续流程。 |
| runtime settings | 信任结论确定后创建的最终设置实例，绑定实际 projectDir。 |
| CLI override | 本次运行临时生效的命令行参数，不写入磁盘。 |
| deep merge | 项目配置按字段递归覆盖 agent 配置，未写的字段保留 agent 值。 |
| diagnostics | 配置或参数解析产生的警告与错误，不中断启动的记录下来。 |

---

## 1. 构建目标

一个 agent 产品启动时，要先回答四个问题：

1. 这次运行用什么模型、什么模式、启用哪些工具与资源？
2. 用户上次保存的偏好是什么？
3. 当前项目自己的配置能不能用？
4. 项目里的扩展与规则能不能执行？

命令行参数解决“这一次”，settings 解决“长期偏好”，项目信任解决“能不能相信当前目录”。三者必须在启动阶段按固定顺序合并，否则会出现同一项配置在不同入口表现不一致。

本课的目标：

- 定义参数解析结果与诊断
- 实现 agent/project 两层 settings 的读取、合并、保存
- 实现项目信任的判定、缓存与存储
- 把信任状态与配置快照交给资源加载器
- 在配置损坏时保留可恢复路径，不直接崩溃

---

## 2. A：概念与功能讲解

### 2.1 启动顺序：先确定“谁说了算”

启动不是一次把所有配置读进来。它分阶段推进，因为项目信任本身依赖前面的结果。

```text
1. 读取 agent 目录，创建 bootstrap settings
   只读 agent 配置，强制不信任项目
2. 解析命令行参数，得到本次运行的覆盖项
3. 创建 startup settings
   用于默认信任策略、首次启动、主题等
4. 确定本次会话的 projectDir（可能来自 --session / --resume）
5. 查 trust store，必要时询问用户
6. 用最终 projectDir 与 trust 创建 runtime settings
7. 用 runtime settings 填充资源加载器与模型运行时
```

这里有两个容易混淆的点：

- bootstrap 与 startup settings 都用于“启动早期决策”，它们可能还不是最终 projectDir。
- 真正提供项目配置与资源的是 runtime settings；它必须等信任结论确定后再创建。

### 2.2 命令行参数：一次运行的覆盖层

参数解析的目标是把 `process.argv` 变成结构化 `Args`，并把错误留在诊断里，而不是边解析边执行。

参数可以分成几组：

| 组 | 例子 | 作用 |
| --- | --- | --- |
| 元信息 | `--help`、`--version`、`--list-models` | 打印信息后退出 |
| 会话 | `--continue`、`--resume`、`--session`、`--fork`、`--session-dir` | 选择或恢复会话 |
| 模型 | `--provider`、`--model`、`--thinking`、`--models` | 选择模型与思考档位 |
| 工具 | `--tools`、`--exclude-tools`、`--no-tools` | 调整工具集合 |
| 资源 | `--extension`、`--skill`、`--prompt-template`、`--no-*` | 追加或关闭资源 |
| 提示 | `--system-prompt`、`--append-system-prompt` | 覆盖或追加系统提示 |
| 模式 | `--print`、`--mode`、`--export` | 选择运行模式 |
| 信任 | `--approve`、`--no-approve` | 本次强制信任或拒绝 |
| 扩展自定义 | 未识别的 `--flag` | 交给扩展系统处理 |

解析规则里几个细节：

- `--` 之后的全部当位置参数，不再当 flag
- `@file` 记为文件参数，后续展开成文本或图片
- 同一个可重复参数累积成数组，例如 `--extension a --extension b`
- 无法识别的长选项进入 `unknownFlags`，保留给扩展
- 短选项未知时直接记一条 error 诊断
- 缺值、非法枚举值、互斥组合都写诊断；有 error 时启动中止

诊断分两级：

```text
warning  可以继续启动，例如未知的思考档位
error    必须退出，例如缺少参数值、未知短选项
```

### 2.3 settings 分层：agent 保存偏好，项目覆盖局部

settings 有两层：

```text
agent 级  ~/.pipi/agent/settings.json
项目  <projectDir>/.pipi/settings.json
```

合并规则是深合并：

```text
最终值 = deepMerge(agent 值, 项目值)
```

项目层只覆盖它写过的字段。例如 agent 级设置了 `defaultModel`，项目只设置 `theme`，模型仍然来自 agent 级。

项目层有一个前提：**项目必须被信任**。未信任时，项目 settings 完全不读，避免项目通过配置注入扩展或修改行为。

读取失败的处理：

- `settings.json` 不存在：当作空对象
- JSON 损坏：记录错误诊断，使用空对象继续启动
- 字段类型不对：读取时按默认值或跳过，不中断启动

保存时只写改过的字段：

- agent 与项目分别记录修改过的字段
- 嵌套字段按子键记录，例如只改 `compaction.reserveTokens`，不覆盖同级的其它键
- 写入串行排队，避免并发写互相覆盖
- 文件锁与原子替换保证进程间与崩溃场景下的完整性

### 2.4 配置项的分类

配置项很多，按用途可以分成几组：

| 组 | 典型字段 |
| --- | --- |
| 模型与思考 | `defaultProvider`、`defaultModel`、`defaultThinkingLevel`、`modelThinkingLevels` |
| 资源 | `packages`、`extensions`、`skills`、`prompts`、`enableSkillCommands` |
| 长会话 | `compaction`、`branchSummary`、`retry` |
| 工具 | `defaultTools`、`shellPath`、`shellCommandPrefix` |
| 会话 | `sessionDir`、`steeringMode`、`followUpMode` |
| 界面 | `theme`、`tuiMode`、`markdown`、`terminal`、`images` |
| 启动 | `quietStartup`、`collapseChangelog`、`defaultProjectTrust` |

读取时使用带默认值的 getter，调用方不需要自己处理 `undefined`。例如压缩设置：

```text
enabled           默认 true
reserveTokens     默认 16384
keepRecentTokens  默认 20000
```

命令行参数在最后一步覆盖 settings，但只覆盖本次运行，不写回文件。

### 2.5 项目信任：为什么需要

项目目录里的这些东西会改变 agent 的行为：

```text
.pipi/settings.json
.pipi/extensions/        扩展代码，会被执行
.pipi/skills/            技能说明，会进入提示
.pipi/prompts/           命令模板
.pipi/SYSTEM.md          系统提示覆盖
.pipi/APPEND_SYSTEM.md   追加系统提示
.agents/skills/          项目或祖先目录共享技能
```

扩展会执行任意代码；技能与提示会改变模型行为。用户从网上 clone 一个仓库后直接启动，不应该默认执行仓库里的代码。

信任判定的顺序：

```text
1. --approve / --no-approve：命令行强制
2. 扩展的 project_trust 钩子：扩展可以给出结论
3. trust store：当前目录或最近祖先的记录
4. defaultProjectTrust：
     always  直接信任
     never   直接拒绝
     ask     有 UI 就询问，没有 UI 默认拒绝
5. 都没有 → 拒绝
```

询问界面提供几种选择：

- 信任当前目录
- 信任父目录，并清除当前目录的记录
- 只信任本次会话（不写 trust store）
- 不信任
- 只不信任本次会话

一个优化：如果目录里根本没有“需要信任的资源”，就不询问，直接视为信任。这样普通项目不会每次启动都弹窗。

### 2.6 未信任时发生什么

未信任不是“禁用 agent”，而是收紧项目层：

- 不读项目 `settings.json`
- 不扫描项目 `.pipi/extensions`、`.pipi/skills`、`.pipi/prompts`
- 不加载项目 `SYSTEM.md` / `APPEND_SYSTEM.md`
- 不扫描项目与祖先的 `.agents/skills`
- 仍然加载 agent 资源与命令行显式传入的资源
- 仍然可以使用当前目录作为工作目录读写文件

命令行显式传入的扩展与技能属于用户本次的明确意图，通常不受项目信任影响。

### 2.7 trust store：把结论记下来

trust store 是一个 JSON 文件，默认在 agent 目录：

```text
~/.pipi/agent/trust.json
```

结构是“绝对路径 → 结论”：

```json
{
  "/work/a": true,
  "/work/b": false
}
```

查询时从当前目录向上找最近的一条记录，所以信任父目录可以覆盖子目录。记录 `null` 表示删除该路径的结论。

写入时：

- 按 key 排序，输出稳定
- 使用文件锁，避免多个进程同时写坏
- 目录不存在时自动创建

### 2.8 配置、信任与资源加载的衔接

runtime settings 最终要变成资源加载器能用的快照：

```text
SettingsManager
  ├─ agentDir / projectDir
  ├─ projectTrusted
  ├─ extensions / skills / prompts 的 agent 与项目条目
  └─ packages
        ↓
ResourceSettings
        ↓
ResourceResolver
```

命令行参数作为额外路径追加：

```text
additionalExtensionPaths
additionalSkillPaths
additionalPromptTemplatePaths
```

`--no-extensions` / `--no-skills` / `--no-prompt-templates` / `--no-context-files` 只关闭自动发现，不关闭命令行显式路径。

模型运行时也读 settings：默认 provider / model、思考档位、各 provider 的 retry 与超时。这些在后续课程接入。

### 2.9 环境变量与路径覆盖

agent 目录允许通过环境变量覆盖，便于测试与多实例：

```text
PIPI_CODING_AGENT_DIR
PIPI_CODING_AGENT_SESSION_DIR
```

没有覆盖时使用：

```text
~/.pipi/agent
```

配置路径集中在 `config.ts`，避免各模块自己拼 `~/.pipi`。

### 2.10 设计取舍

| 取舍 | 原因 |
|---|---|
| 两阶段 settings | 信任结论依赖 projectDir 与扩展，必须先有 agent 配置才能询问 |
| 项目未信任时完全不读 | 避免项目配置影响信任判定本身 |
| 无信任资源时自动信任 | 普通项目不需要每次弹窗 |
| 配置损坏只记诊断 | 一个坏文件不应让整个 CLI 无法启动 |
| 信任记录按最近祖先生效 | 父目录信任可以覆盖整个仓库 |
| CLI 覆盖不落盘 | 临时实验不应污染长期配置 |
| 保存只写改动字段 | 避免覆盖用户手写的其它配置 |

### 2.11 小结

| 结论 | 说明 |
|---|---|
| 启动有先后 | bootstrap → 参数 → startup → projectDir → trust → runtime |
| 参数是覆盖层 | 只影响本次运行，不写 settings |
| settings 两层深合并 | 项目覆盖 agent，未信任时项目层不读 |
| trust 决定项目资源 | 扩展、技能、模板、项目提示与项目 `.agents` 都受控 |
| trust store 按最近祖先生效 | 父目录信任可覆盖子目录 |
| 配置与资源解耦 | settings 先转成快照，resolver 只认快照 |

---

## 3. 讨论与确认记录

| 日期 | 类型 | 内容 | 对 B 的影响 |
| --- | --- | --- | --- |
| 2026-11-26 | 进度 | 课程 15 验收通过，开始课程 16 A | 待 A 完成后讨论 B |
| 2026-11-27 | 学习 | 用户读完 A | 进入 B 讨论 |
| 2026-11-27 | 确认 | 四项均采用建议；开始实现 | B 通过，写入 D-087 至 D-090 |

---

## 4. B：具体实现规划

> B 已确认（2026-11-27）。任务 T-16-1 至 T-16-5；决策见 `BUILD_PLAN.md` D-087 至 D-090。

### 4.1 原项目实现

| 文件 | 职责 |
| --- | --- |
| `config.ts` | agent 目录、settings、auth、sessions 等路径；`PIPI_CODING_AGENT_DIR` 等环境覆盖 |
| `cli/args.ts` | 参数解析、诊断、帮助文本、未知 flag |
| `core/settings-manager.ts` | 两层 settings 的存储、深合并、字段级写回、getter/setter、错误收集 |
| `core/trust-manager.ts` | `trust.json` 读写、最近祖先查询、需信任资源检测 |
| `core/project-trust.ts` | 信任判定顺序、UI 选择、扩展 `project_trust` 钩子 |
| `core/settings-diagnostics.ts` | 把 settings 错误转成启动诊断 |
| `main.ts` | bootstrap → 参数 → startup settings → projectDir → trust → runtime settings → 服务创建 |

关键行为：

1. `SettingsStorage.withLock(scope, fn)` 负责读写：加文件锁、读当前内容、交给回调生成新内容、整文件写回。
2. 两层深合并：项目层覆盖 agent 层；未信任时项目层完全不读。
3. 修改追踪：`modifiedFields` / `modifiedNestedFields` 只把改动写回，不覆盖用户其它字段。
4. 写盘串行：`writeQueue` 排队，文件锁处理跨进程并发。
5. 解析错误记录为 `SettingsError`，启动继续；`drainErrors` 供诊断展示。
6. trust store 是路径到布尔值的映射，按最近祖先生效；`null` 删除记录。
7. 需信任资源检测：项目 `.pipi` 下的 settings、extensions、skills、prompts、SYSTEM.md、APPEND_SYSTEM.md，以及当前目录或祖先的 `.agents/skills`。
8. 信任顺序：CLI 覆盖 → 扩展钩子 → trust store → `defaultProjectTrust` → 询问或以拒绝收尾。
9. 启动阶段创建多个 SettingsManager：bootstrap（不信任）、startup（默认信任策略）、runtime（最终 projectDir + trust）。

### 4.2 新项目实现建议

建议目录：

```text
packages/harness/src/
├── config.ts                 现有路径函数，补环境覆盖与 settings/trust 路径
├── cli/args.ts               参数解析
├── settings/
│   ├── types.ts              Settings、scope、错误类型
│   ├── manager.ts            SettingsStorage、SettingsManager
│   ├── trust.ts              ProjectTrustStore、需信任资源检测
│   ├── project-trust.ts      信任判定
│   ├── diagnostics.ts        settings 错误转诊断
│   └── resource-settings.ts  SettingsManager → ResourceSettings
└── startup.ts                bootstrap → trust → runtime 的编排
```

核心接口：

```ts
type SettingsScope = "agent" | "project";

interface SettingsManager {
  static create(projectDir, agentDir, options?: { projectTrusted?: boolean }): SettingsManager;
  static inMemory(settings?: Partial<Settings>, options?): SettingsManager;

  getAgentSettings(): Settings;
  getProjectSettings(): Settings;
  getSettings(): Settings;
  isProjectTrusted(): boolean;
  setProjectTrusted(trusted: boolean): void;
  reload(): Promise<void>;
  applyOverrides(overrides: Partial<Settings>): void;
  drainErrors(): SettingsError[];

  getDefaultProvider(): string | undefined;
  getDefaultModel(): string | undefined;
  getCompactionSettings(): CompactionSettings;
  getBranchSummarySettings(): { reserveTokens: number; skipPrompt: boolean };
  getRetrySettings(): RetryPolicy;
  getDefaultProjectTrust(): "ask" | "always" | "never";
  getExtensionPaths(): string[];
  getSkillPaths(): string[];
  getPromptTemplatePaths(): string[];
  getPackages(): PackageSource[];
}
```

资源层衔接：

```ts
function toResourceSettings(manager: SettingsManager): ResourceSettings {
  return createResourceSettings({
    projectDir: manager.getCwd(),
    agentDir: manager.getAgentDir(),
    projectTrusted: manager.isProjectTrusted(),
    extensions: {
      agent: manager.getExtensionPaths(),
      project: manager.getProjectSettings().extensions ?? [],
    },
    skills: { ... },
    prompts: { ... },
  });
}
```

命令行参数按原项目实现完整 `Args`，但本课只接入当前已有消费者：

- 已接入：`--provider`、`--model`、`--thinking`、`--system-prompt`、`--append-system-prompt`、`--extension`、`--skill`、`--prompt-template`、`--no-*`、`--approve`/`--no-approve`、`--no-session`、`--session-dir`
- 解析但不消费：`--mode`、`--print`、`--export`、`--continue`、`--resume`、`--fork`、`--tui-mode`、`--list-models`、`--offline`
- 未知长选项进入 `unknownFlags`，留给课程 20 的扩展系统

信任判定保留接缝：

```ts
resolveProjectTrusted({
  projectDir,
  trustStore,
  trustOverride,
  defaultProjectTrust,
  hasUI,
  select: (prompt, options) => Promise<string | undefined>,
  extensionDecision?: () => Promise<boolean | undefined>, // 课程 20
})
```

没有 UI 时 `ask` 按拒绝处理，与原项目一致。

启动编排：

```ts
resolveStartup({
  args: string[],
  projectDir: string,
  agentDir: string,
  askTrust?: TrustSelector,
}): Promise<{
  args: Args;
  agentDir: string;
  projectDir: string;
  settingsManager: SettingsManager;
  trustStore: ProjectTrustStore;
  projectTrusted: boolean;
  resourceSettings: ResourceSettings;
  diagnostics: ConfigDiagnostic[];
}>
```

本课不创建 `AgentSession`、不选模型、不恢复会话、不处理包安装命令；这些分别留给课程 17、18、20。`startup.ts` 只负责把参数、settings、trust 组织成后续可用的结构。

本课不实现：

- 首次启动的主题与遥测选择（课程 23）
- `--list-models`、`--export`、print/RPC 模式（课程 19）
- 包安装、更新、卸载命令（课程 20）
- 扩展 `project_trust` 钩子（课程 20）
- TUI 信任选择器（课程 23）；本课用注入的 `select` 回调

### 4.3 任务拆分

| 任务 | 范围 | 主要文件 |
| --- | --- | --- |
| T-16-1 | settings 类型、存储、深合并、修改追踪、读写队列 | `settings/{types,manager}.ts` |
| T-16-2 | settings getter/setter、诊断、`ResourceSettings` 桥接 | `settings/{manager,diagnostics,resource-settings}.ts` |
| T-16-3 | trust store、需信任资源检测、信任判定 | `settings/{trust,project-trust}.ts` |
| T-16-4 | CLI 参数解析与诊断 | `cli/args.ts` |
| T-16-5 | 启动编排、环境变量路径、导出、测试与 changelog | `startup.ts`、`config.ts`、`index.ts` |

### 4.4 测试与验收

- settings：两层合并、项目覆盖、未信任不读、未知字段保留、字段级写回、损坏文件诊断
- settings 并发：连续修改不丢字段；写队列串行
- trust store：最近祖先命中、`null` 删除、排序输出、路径规范化
- 需信任资源：各类文件与祖先 `.agents/skills` 的检测
- 信任判定：CLI 覆盖、store、`always`/`never`/`ask`、无 UI 拒绝、session-only
- 参数解析：各组 flag、重复参数、`--`、`@file`、未知 flag、非法值诊断
- 启动编排：bootstrap 不读项目、trust 后运行时读取、资源快照正确
- 测试不写用户目录，全部使用临时目录或内存 storage

### 4.5 待确认决策

| 事项 | 选项 | 影响 |
| --- | --- | --- |
| settings 字段范围 | A. 完整原项目 `Settings` 接口（建议）；B. 只定义当前会消费的字段 | A 后续课程直接使用；B 类型少，后续补字段 |
| 文件锁 | A. 引入 `proper-lockfile@4.1.2`（原项目，建议）；B. 原子写 + 进程内队列 | A 跨进程安全；B 少一个依赖 |
| 参数解析范围 | A. 完整 `Args` 与解析逻辑（建议）；B. 只解析本课接入的 flag | A 锁定 CLI 契约；B 范围小，后续补 |
| 启动编排 | A. 实现 `resolveStartup` 返回设置与资源快照（建议）；B. 只提供各模块，编排留给课程 17 | A 本课可端到端测试；B 避免提前接触会话 |
