import type { AgentTool, AgentToolResult } from "@pipi/agent";
import type { Tool } from "@pipi/llm";

// 原始tool描述
export interface ToolDefinition<TInput, TDetails = unknown> {
	name: string;
	label: string;
	description: string;
	parameters: Tool["parameters"];
	promptSnippet?: string; // 工具简介，进入system prompt
	promptGuidelines?: readonly string[]; // 工具规则，进入system prompt
	constrainedSampling?: Tool["constrainedSampling"];
	prepareArguments?: (args: unknown) => Record<string, unknown>; // 工具自带的参数预处理函数
	executionMode?: AgentTool["executionMode"];
	execute: (
		toolCallId: string,
		input: TInput,
		signal?: AbortSignal,
		onUpdate?: (partial: AgentToolResult<TDetails>) => void,
	) => Promise<AgentToolResult<TDetails>>;
}

/** 把tool原始定义转成context里能用的 AgentTool。 */
export function wrapToolDefinition<TInput, TDetails = unknown>(
	definition: ToolDefinition<TInput, TDetails>,
): AgentTool<Record<string, unknown>, TDetails> {
	const tool: AgentTool<Record<string, unknown>, TDetails> = {
		name: definition.name,
		label: definition.label,
		description: definition.description,
		parameters: definition.parameters,
		prepareArguments: definition.prepareArguments,
		executionMode: definition.executionMode,
		execute: (toolCallId, params, signal, onUpdate) =>
			definition.execute(toolCallId, params as TInput, signal, onUpdate),
	};
	// constrainedSampling 属于 llm 的 Tool 字段，AgentTool 继承自 Tool
	if (definition.constrainedSampling !== undefined) tool.constrainedSampling = definition.constrainedSampling;
	return tool;
}
