# 07 API Key 认证与 credential

> 课程状态：待学习
> 覆盖模块：`@pipi/llm` 的认证解析、credential 存储，以及登录与登出编排
> 课程文件：07-auth-and-credentials.md
> 本课产出：key 可以从环境变量或本地文件解析，登录/登出可持久化，解析失败有明确错误。

---

## 0. 阅读前

| 术语 | 含义 |
| --- | --- |
| credential | 调用 provider 所需的认证记录，当前只有 API key 一种。 |
| auth | 一次请求最终使用的认证结果，包含 `apiKey`、`headers`、`baseUrl`。 |
| ambient | 不经过本地存储、直接从环境读取的来源，例如环境变量、配置文件。 |
| CredentialStore | credential 的读写接口，决定存在哪、怎么改。 |
| 登录 | 引导用户输入 key 并写入 CredentialStore。 |
| 登出 | 删除某个 provider 的 credential。 |
| 原子替换 | 先写临时文件再 `rename`，避免读到写了一半的内容。 |
| 文件模式 | Unix 权限位，`0600` 表示只有属主可读写。 |

---

## 1. 构建目标

课程 04 已经能解析 API key，但只支持内存存储，进程退出就丢失。

本课补齐：

```text
环境变量中的apikey   ─┐
本地文件存储的apikey ─┼→ 解析 → AuthResult → 请求
请求中附带的apikey   ─┘
```

具体目标：

1. key 可以从 `DEEPSEEK_API_KEY` 等环境变量读取
2. key 可以写入本地 `auth.json` 并持久化
3. 支持登录与登出
4. 解析顺序与错误语义明确
5. 文件权限与写入安全可控

不在本课范围：

- OAuth 登录与 token 刷新（D-019 后置）
- 多账号切换
- 系统钥匙串集成
- 团队级密钥分发

---

## 2. A：概念与功能讲解

### 2.1 本课主线

认证要回答三个问题：

```text
1. 用哪一把 key？       解析
2. 这把 key 存在哪？     存储
3. 怎么让它进去/出来？   登录与登出
```

三者分开实现，但共享一个 `CredentialStore` 接口。

### 2.2 认证来源与优先级

解析顺序是固定的三层：

```text
1. 请求显式传入的 apiKey
2. CredentialStore 中的 credential
3. ambient 来源（环境变量、配置文件）
```

| 顺序 | 理由 |
| --- | --- |
| 请求覆盖最先 | 临时请求、测试、代理需要绕过默认值 |
| 存储其次 | 用户显式登录过，应当优先于环境变量 |
| 环境最后 | 环境常来自 shell 配置，属于兜底 |


### 2.3 credential 的数据模型

```ts
interface ApiKeyCredential {
	type: "api_key";
	key?: string;
	env?: ProviderEnv;
}
```

字段说明：

| 字段 | 作用 |
| --- | --- |
| `type` | 区分认证方式，为 OAuth 预留 |
| `key` | 密钥；允许为空，表示只提供 env 配置 |
| `env` | 一些附加的元数据 |

一个 provider 只保留一条 credential。多账号需要在更高层实现，不能靠数组塞进同一个 provider。

### 2.4 CredentialStore 的语义

```ts
interface CredentialStore {
	read(providerId, options?): Promise<Credential | undefined>;
	list(options?): Promise<readonly CredentialInfo[]>;
	write(providerId, credential, options?): Promise<void>;
	delete(providerId, options?): Promise<void>;
}
```

| 方法 | 语义 |
| --- | --- |
| `read` | 不存在返回 `undefined`，存储故障才 reject |
| `list` | 只返回元数据，不暴露密钥 |
| `write` | 覆盖写入一条记录 |
| `delete` | 删除记录，不存在也算成功 |

原项目把写入设计成 `modify(providerId, fn)`：读取、修改、写回在同一把锁内完成。这样 OAuth 刷新不会并发写坏 token。

当前只有 API key，不存在刷新，`write` 足够；课程 04 的接口保持不动，本课只新增文件实现。

### 2.5 本地存储实现

文件位置：

```text
~/.pi/auth.json
```

结构：

```json
{
  "deepseek": { "type": "api_key", "key": "sk-..." },
  "openai": { "type": "api_key", "key": "sk-..." }
}
```

安全性要求：

| 要求 | 做法 |
| --- | --- |
| 目录权限 | 目录创建为 `0700` |
| 文件权限 | 首次创建用 `0600` |
| 防止半写 | 写临时文件，再 `rename` 覆盖 |
| 防止并发覆盖 | 进程内串行化写入；跨进程锁可选 |
| 不泄露密钥 | 日志与状态只显示来源，不打印 key |

**为什么要原子替换**

直接 `writeFile` 时，如果进程在写一半时崩溃，文件会变成非法 JSON，所有 provider 的 credential 一起丢失。`rename` 在同一文件系统内是原子操作，读者要么看到旧文件，要么看到新文件。

**为什么权限只在创建时设置**

管理员可能用 ACL 或统一权限策略管理配置。每次写入都 `chmod` 会覆盖这些策略，所以只在创建时指定 `0600`。

### 2.6 登录与登出

登录是“获取 credential 并写入存储”的流程：

```text
选择 provider
  → 提示输入 key
  → 构造 ApiKeyCredential
  → credentials.write()
  → 返回结果
```

登出：

```text
credentials.delete(providerId)
```

要点：

| 点 | 说明 |
| --- | --- |
| 输入不落日志 | 提示类型用 secret，值不进日志 |
| 失败不写入 | 校验失败时保持原 credential |
| 可中止 | 交互过程接受 `signal` |
| 可覆盖 | 已存在 credential 时允许替换 |

原项目还支持 `select`、`manual_code`、`device_code` 等交互，用于 OAuth。当前只需要文本输入。

### 2.7 请求时如何解析

`getAuth` 把三层来源合并成一个 `AuthResult`：

```ts
{
  auth: { apiKey, headers?, baseUrl? },
  env?: ProviderEnv,
  source?: string
}
```

其中 `source` 只用于展示：

| 来源 | `source` |
| --- | --- |
| 环境变量 | `DEEPSEEK_API_KEY` |
| 本地存储 | `stored credential` |
| 请求覆盖 | 调用方自定 |

`applyAuth` 再把它和请求选项合并：

```text
apiKey   = options.apiKey ?? auth.apiKey
headers  = merge(auth.headers, options.headers)
env      = { ...auth.env, ...options.env }
baseUrl  = auth.baseUrl ?? model.baseUrl
```

### 2.8 错误语义

| 情况 | 结果 |
| --- | --- |
| provider 未配置 | `getAuth` 返回 `undefined` |
| 存储读取失败 | 抛 `ModelsError("auth")` |
| 解析过程抛错 | 包成 `ModelsError("auth")` |
| 请求发不出去 | 进入流 `error` 事件 |

关键区分：

```text
undefined  = 没配置，属于正常状态
异常       = 存储或解析坏了，属于故障
```

如果把“没配置”也抛异常，状态查询会变成异常路径；如果把“故障”返回 `undefined`，用户只会看到“未配置”，难以定位。

### 2.9 OAuth 的位置

原项目的 OAuth 解决的是订阅账号：

```text
login → 授权码/设备码 → refresh + access
请求前 → 检查过期 → 加锁刷新 → 写回 → toAuth
```

它与 API key 共享 `CredentialStore`，但需要：

- 加锁刷新，避免并发重复刷新
- 失败时不回退环境变量
- 按 credential 派生 `baseUrl`

D-019 已将 OAuth 后置。本课只保留 `Credential.type` 的扩展点，不实现登录、刷新与派生。

### 2.10 与整体系统的关系

```text
Models
  ├─ getAuth(providerId | model)
  │    ├─ 请求覆盖
  │    ├─ CredentialStore.read
  │    └─ provider.auth.apiKey.resolve（ambient）
  ├─ login(providerId)
  └─ logout(providerId)

CredentialStore
  ├─ InMemory（默认、测试）
  └─ File（本课）

Provider
  └─ auth.apiKey.resolve
```

上层不直接读 `auth.json`，只通过 `Models` 的入口。

### 2.11 小结

1. 认证来源有优先级：请求覆盖 > 存储 > 环境。
2. credential 一个 provider 一条，当前只有 API key。
3. 文件存储要处理权限、原子替换与并发写入。
4. 登录/登出是存储层的编排，不是 provider 的责任。
5. “未配置”返回 `undefined`，故障才抛异常。
6. OAuth 共享同一接口，但刷新与派生后置。

---

## 3. 讨论与确认记录

> 学习本课程时，问题、解释、讨论结论以及对 B 阶段的影响记录在此；已确认决策见 `BUILD_PLAN.md` 决策表。

| 日期 | 类型 | 内容 | 对 B 的影响 |
| --- | --- | --- | --- |
| - | - | 尚无记录 | - |

---

## 4. B：具体实现规划

### 4.1 原项目实现

| 文件 | 职责 | 关键位置 |
| --- | --- | --- |
| `packages/ai/src/auth/types.ts` | credential、store、auth 接口 | `CredentialStore` 65、`AuthContext` 97、`AuthResult` 104、`ApiKeyAuth` 170、`ProviderAuth` 237 |
| `packages/ai/src/auth/resolve.ts` | 认证解析与费用无关的合并 | `resolveProviderAuth` 50、`resolveStoredOAuth` 127、`resolveApiKey` 181 |
| `packages/ai/src/auth/helpers.ts` | 标准 API key 解析 | `envApiKeyAuth` 9、`lazyOAuth` 40 |
| `packages/ai/src/auth/context.ts` | 默认环境上下文 | `defaultProviderAuthContext` 23 |
| `packages/ai/src/auth/credential-store.ts` | 内存实现 | `InMemoryCredentialStore` 9 |
| `packages/coding-agent/src/core/auth-storage.ts` | `auth.json` 持久化 | `FileAuthStorageBackend` 49、`AuthStorage` 327、`read` 441、`modify` 449 |

原项目解析顺序：

```text
1. 请求 apiKey
2. credentials.read(providerId)
   ├─ oauth：检查过期、加锁刷新、toAuth
   └─ api_key：resolve
3. 没有记录：provider.auth.apiKey.resolve(ctx)
4. 包装错误为 ModelsError("auth" / "oauth")
```

存储实现要点：

```text
auth.json          { providerId: Credential }
FileAuthStorageBackend   文件锁 + 同步/异步串行
AuthStorage              解析 JSON、合并写入、缓存 revision
```

### 4.2 新项目实现方案

课程 04 已有接口与内存实现，本课补齐文件存储与登录编排。

新增或修改：

```text
packages/llm/src/
├── auth/
│   ├── types.ts             增加可选 login，保持其它接口不变
│   ├── file-credential-store.ts
│   └── login.ts             login/logout 的编排
└── models.ts                Models 增加 login/logout
```

实现边界：

1. **文件存储**
   `FileCredentialStore` 实现现有 `CredentialStore`。JSON 读写、`0600`、目录 `0700`、临时文件 + `rename`、进程内串行队列、支持 `signal`。跨进程锁后置。

2. **登录**
   `ApiKeyAuth` 增加可选 `login(interaction)`。`Models.login(providerId, interaction)` 调用 provider 的 login，成功后写入 store，返回 credential。

3. **登出**
   `Models.logout(providerId)` 调用 `credentials.delete`，不存在也成功。

4. **解析保持现有实现**
   课程 04 的 `resolveProviderAuth` 已实现三层顺序，本课只补错误包装与 `source`。

5. **OAuth 不做**
   不加 `OAuthAuth`、刷新与派生逻辑；`Credential` 仍只有 `api_key`。

建议的数据流：

```text
login
  → provider.auth.apiKey.login(interaction)
  → credentials.write(providerId, credential)
  → 返回 credential

请求
  → getAuth
  → credentials.read
  → provider.auth.apiKey.resolve
  → AuthResult
```

### 4.3 实现顺序

| 任务 | 内容 | 依赖 | 验收 |
| --- | --- | --- | --- |
| T-07-1 | `FileCredentialStore`：读写删除、原子替换、权限、串行写入、中止 | 04 | 并发写入不丢数据；重启后可读 |
| T-07-2 | `ApiKeyAuth.login` 与 `Models.login` / `logout` | T-07-1 | 登录可持久化；登出可删除 |
| T-07-3 | 解析收尾：错误包装、`source`、`check` 行为 | T-07-1 | 未配置与故障可区分 |
| T-07-4 | 导出、测试与 changelog | T-07-1..3 | `build`、`test`、`check` 通过 |

### 4.4 测试

| 测试 | 验证 |
| --- | --- |
| 优先级 | 请求覆盖 > 存储 > 环境 |
| 内存存储 | 读、写、删、列表 |
| 文件存储 | 写入后重新实例化仍能读到 |
| 权限 | 新建文件为 `0600` |
| 原子替换 | 写入失败不破坏旧内容 |
| 并发写入 | 多次写入后文件仍是合法 JSON |
| 中止 | `signal` 中止后不写入 |
| 登录 | 交互返回 key 后写入 store |
| 登出 | 删除后解析返回 `undefined` |
| 错误 | 存储读失败抛 `ModelsError("auth")` |

测试使用 `os.tmpdir()` 下的临时目录，不写用户目录。

### 4.5 复现选项

| 选项 | 说明 | 建议 |
| --- | --- | --- |
| 文件存储 | 持久化，进程重启仍可用 | 采用 |
| 只保留内存存储 | 实现最简单 | 不采用：无法保存登录 |
| 跨进程文件锁 | 多进程同时写安全 | 后置：单进程场景足够 |
| 实现 OAuth | 订阅账号登录 | 后置：见 D-019 |
| 系统钥匙串 | 更安全的密钥存储 | 后置：平台差异大 |
