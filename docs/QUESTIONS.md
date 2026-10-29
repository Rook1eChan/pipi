# 待确认问题（QUESTIONS）

按影响范围排序。每个问题给出建议，但未经确认不会落为定案。

## Q-001 包名前缀

- 现状：目录已定为 `packages/ai`、`agent`、`tui`、`coding-agent`、`evals`
- 待定：npm 包名是否使用 `@pipi/*`
- 建议：`@pipi/ai` 等，便于 import 与对照原项目的 `@earendil-works/pi-*`
- 阻塞：D01 步骤 B

## Q-002 许可证

- 待定：`pipi` 仓库是否添加 LICENSE
- 建议：暂不添加；若希望公开复用，选 MIT
- 阻塞：首次推送后的仓库整理

## Q-003 首批真实 API 支持范围

- 待定：M2 只做 OpenAI 兼容，还是同时做 Anthropic Messages
- 建议：先 OpenAI 兼容 + faux provider；Anthropic 放到 D06
- 影响：D05/D06 的实现量与测试用例
- 阻塞：D05 步骤 B

## Q-004 模型目录数据

- 待定：是否复现 `generate-models.ts` 的完整代码生成与 27 个 provider 数据文件
- 建议：不复现全量生成；保留数据结构与最小目录，把生成流程作为 D19 的概念讲解
- 影响：`ai` 包体积、测试、D19
- 阻塞：D04 步骤 B

## Q-005 认证范围

- 待定：是否实现 OAuth（Anthropic / Copilot / Codex / Kimi 等）
- 建议：先 API key + 环境变量；OAuth 作为 D07 的可选扩展
- 影响：D07 实现量、凭据存储设计
- 阻塞：D07 步骤 B

## Q-006 图像能力

- 待定：是否复现图像输入、图像生成、剪贴板图片
- 建议：先只做图像输入（多模态消息），图像生成与剪贴板后置
- 影响：D08、D24
- 阻塞：D08 步骤 B

## Q-007 会话格式兼容性

- 待定：`pipi` 的 JSONL 是否要与原项目格式完全兼容（可互相读取）
- 建议：结构对齐、字段允许裁剪，不承诺双向兼容
- 影响：D14、迁移逻辑、导出功能
- 阻塞：D14 步骤 B

## Q-008 TUI 复现深度

- 待定：是否保留全屏模式、鼠标、图片、LaTeX、原生剪贴板
- 建议：先做行渲染 + 编辑器 + 基础组件；其余按需
- 影响：D22–D24 的实现量、跨平台测试
- 阻塞：D22 步骤 B（第 6 批）

## Q-009 扩展系统范围

- 待定：扩展是否需要支持 UI 钩子、自定义 provider、包管理
- 建议：先支持工具注册与事件钩子；包管理后置
- 影响：D21、D24
- 阻塞：D21 步骤 B

## Q-010 evals 是否纳入

- 待定：是否复现 `packages/evals`（docs/extensions/smoke 评测）
- 建议：只做 smoke 与 faux provider 驱动的集成测试，不复现 SWE-bench
- 影响：D25
- 阻塞：D25 步骤 B
