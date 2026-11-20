import type {
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Message,
	ToolResultMessage,
	Usage,
} from "@pipi/llm";
import type {
	AfterToolCallResult,
	AgentContext,
	AgentEvent,
	AgentLoopConfig,
	AgentMessage,
	AgentTool,
	AgentToolCall,
	AgentToolResult,
	BeforeToolCallResult,
	PrepareNextTurnContext,
	StreamFn,
} from "./types.ts";

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

interface ExecutedToolCall {
	result: AgentToolResult;
	isError: boolean;
}

interface ToolCallOutcome extends ExecutedToolCall {
	toolCall: AgentToolCall;
}

interface PreparedToolCall {
	toolCall: AgentToolCall;
	tool: AgentTool;
	args: Record<string, unknown>;
}

type Preparation = { kind: "prepared"; value: PreparedToolCall } | { kind: "immediate"; value: ToolCallOutcome };

interface ToolBatch {
	messages: ToolResultMessage[];
	terminate: boolean;
}

function emptyUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function errorAssistantMessage(model: AgentLoopConfig["model"], message: string): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: emptyUsage(),
		stopReason: "error",
		errorMessage: message,
		timestamp: Date.now(),
	};
}

function createErrorToolResult(message: string): AgentToolResult {
	return { content: [{ type: "text", text: message }], details: {} };
}

/**
 * 运行一次 agent 循环：调模型、执行工具、回填结果，直到模型不再要求工具且队列为空。
 */
export async function runAgentLoop(
	prompts: AgentMessage[],
	context: AgentContext,
	config: AgentLoopConfig,
	emit: AgentEventSink,
	signal: AbortSignal | undefined,
	streamFn: StreamFn, // 就是models.streamSimple
): Promise<AgentMessage[]> {
	// 本次loop新产生的messages
	const newMessages: AgentMessage[] = [...prompts];

	let currentContext: AgentContext = {
		...context,
		messages: [...context.messages, ...prompts], // 所有messages
	};
	let currentConfig = config;

	await emit({ type: "agent_start" });
	await emit({ type: "turn_start" });
	for (const prompt of prompts) {
		await emit({ type: "message_start", message: prompt });
		await emit({ type: "message_end", message: prompt });
	}

	let lastTurnSnapshot: PrepareNextTurnContext | undefined;
	let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) ?? [];

	while (true) {
		let moreTurnsNeeded = true; // 表示是否还需要调用一次模型。当本轮无工具或，变为false；一开始为true，确保进入一轮循环

		while (moreTurnsNeeded || pendingMessages.length > 0) {
			if (lastTurnSnapshot) {
				const update = await currentConfig.prepareNextTurn?.(lastTurnSnapshot);
				if (update) {
					currentContext = update.context ?? currentContext;
					currentConfig = {
						...currentConfig,
						model: update.model ?? currentConfig.model,
						reasoning:
							update.thinkingLevel === "off" ? undefined : (update.thinkingLevel ?? currentConfig.reasoning),
					};
				}
				if (pendingMessages.length === 0) {
					pendingMessages = (await currentConfig.getSteeringMessages?.()) ?? [];
				}
				await emit({ type: "turn_start" });
			}

			// 把待处理的信息全部加入messages
			if (pendingMessages.length > 0) {
				for (const message of pendingMessages) {
					await emit({ type: "message_start", message });
					await emit({ type: "message_end", message });
					currentContext.messages.push(message);
					newMessages.push(message);
				}
				pendingMessages = [];
			}

			// 发消息
			const message = await streamAssistantResponse(currentContext, currentConfig, signal, emit, streamFn);
			newMessages.push(message);

			if (message.stopReason === "error" || message.stopReason === "aborted") {
				await emit({ type: "turn_end", message, toolResults: [] });
				await emit({ type: "agent_end", messages: newMessages });
				return newMessages;
			}

			const toolCalls = message.content.filter((block): block is AgentToolCall => block.type === "toolCall");
			const toolResults: ToolResultMessage[] = [];
			moreTurnsNeeded = false;

			// 执行工具
			if (toolCalls.length > 0) {
				const batch =
					message.stopReason === "length"
						? await failTruncatedToolCalls(toolCalls, emit) // 输出因长度被截断
						: await executeToolCalls(currentContext, message, toolCalls, currentConfig, signal, emit);
				toolResults.push(...batch.messages);
				moreTurnsNeeded = !batch.terminate; // batch.terminate=false表示还需要再调用模型
				for (const result of toolResults) {
					currentContext.messages.push(result);
					newMessages.push(result);
				}
			}

			await emit({ type: "turn_end", message, toolResults });

			lastTurnSnapshot = {
				message,
				toolResults,
				context: currentContext,
				newMessages,
			};

			if (await currentConfig.shouldStopAfterTurn?.(lastTurnSnapshot)) {
				await emit({ type: "agent_end", messages: newMessages });
				return newMessages;
			}

			pendingMessages = (await currentConfig.getSteeringMessages?.()) ?? [];
		}

		const followUpMessages = (await currentConfig.getFollowUpMessages?.()) ?? [];
		if (followUpMessages.length > 0) {
			pendingMessages = followUpMessages;
			continue;
		}
		break;
	}

	await emit({ type: "agent_end", messages: newMessages });
	return newMessages;
}

/** 消费模型事件流，维护消息历史里唯一的一条助手消息。 */
async function streamAssistantResponse(
	context: AgentContext,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
	streamFn: StreamFn,
): Promise<AssistantMessage> {
	const messages = config.transformContext
		? await config.transformContext(context.messages, signal)
		: context.messages;
	const llmMessages: Message[] = await config.convertToLlm(messages); // 把AgentMessage[]转换为Message[]
	const llmContext: Context = {
		systemPrompt: context.systemPrompt,
		messages: llmMessages,
		tools: context.tools,
	};
	const resolvedApiKey = (await config.getApiKey?.(config.model.provider)) || config.apiKey;

	let response: AssistantMessageEventStream;
	try {
		response = await streamFn(config.model, llmContext, { ...config, apiKey: resolvedApiKey, signal });
	} catch (error) {
		const message = errorAssistantMessage(config.model, error instanceof Error ? error.message : String(error));
		context.messages.push(message);
		await emit({ type: "message_start", message });
		await emit({ type: "message_end", message });
		return message;
	}

	let partial: AssistantMessage | undefined;
	let addedPartial = false;  // 表示最后一条信息是partial，是不完整的

    // 消费流式事件
	for await (const event of response) {
		switch (event.type) {
			case "start":
				partial = event.partial;
				context.messages.push(partial);
				addedPartial = true;
				await emit({ type: "message_start", message: { ...partial } });
				break;
			case "done":
			case "error": {
				const finalMessage = await response.result(); // 取完整的消息
				if (addedPartial) {
                    // 用完整消息覆盖最后一条消息
					context.messages[context.messages.length - 1] = finalMessage;
				} else {
                    // 没有addedPartial，说明start之前就出现了error / 忘发了start了
                    // 直接把finalMessage加入，补发start
					context.messages.push(finalMessage);
					await emit({ type: "message_start", message: { ...finalMessage } });
				}
				await emit({ type: "message_end", message: finalMessage });
				return finalMessage;
			}
			default:
				if (partial) {
					partial = event.partial;
					context.messages[context.messages.length - 1] = partial;
					await emit({
						type: "message_update",
						assistantMessageEvent: event,
						message: { ...partial },
					});
				}
		}
	}

    // 处理没发done/error的情况
	const finalMessage = await response.result();
	if (addedPartial) {
		context.messages[context.messages.length - 1] = finalMessage;
	} else {
		context.messages.push(finalMessage);
		await emit({ type: "message_start", message: { ...finalMessage } });
	}
	await emit({ type: "message_end", message: finalMessage });
	return finalMessage;
}

/** 输出被长度截断时，工具无法可靠执行。不执行工具，人为构造一个错误的执行结果 */
async function failTruncatedToolCalls(toolCalls: AgentToolCall[], emit: AgentEventSink): Promise<ToolBatch> {
	const messages: ToolResultMessage[] = [];
	for (const toolCall of toolCalls) {
		await emit({
			type: "tool_execution_start",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			args: toolCall.arguments,
		});
		const finalized: ToolCallOutcome = {
			toolCall,
			result: createErrorToolResult(
				`Tool call "${toolCall.name}" was not executed: the response hit the output token limit, so its arguments may be truncated. Re-issue the tool call with complete arguments.`,
			),
			isError: true,
		};
		await emitToolExecutionEnd(finalized, emit);
		const resultMessage = createToolResultMessage(finalized);
		await emitToolResultMessage(resultMessage, emit);
		messages.push(resultMessage);
	}
	return { messages, terminate: false };
}

async function executeToolCalls(
	context: AgentContext,
	assistantMessage: AssistantMessage,
	toolCalls: AgentToolCall[],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<ToolBatch> {
	const hasSequential = toolCalls.some(
		(call) => context.tools?.find((tool) => tool.name === call.name)?.executionMode === "sequential",
	);
	if (config.toolExecution === "sequential" || hasSequential) {
		return executeSequential(context, assistantMessage, toolCalls, config, signal, emit);
	}
	return executeParallel(context, assistantMessage, toolCalls, config, signal, emit);
}

async function executeSequential(
	context: AgentContext,
	assistantMessage: AssistantMessage,
	toolCalls: AgentToolCall[],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<ToolBatch> {
	const finalizedCalls: ToolCallOutcome[] = [];
	const messages: ToolResultMessage[] = [];

	for (const toolCall of toolCalls) {
		await emit({
			type: "tool_execution_start",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			args: toolCall.arguments,
		});
		const finalized = await runPreparedCall(
			await prepareToolCall(context, assistantMessage, toolCall, config, signal),
			context,
			assistantMessage,
			config,
			signal,
			emit,
		);
		await emitToolExecutionEnd(finalized, emit);
		const resultMessage = createToolResultMessage(finalized);
		await emitToolResultMessage(resultMessage, emit);
		finalizedCalls.push(finalized);
		messages.push(resultMessage);
		if (signal?.aborted) break;
	}

	return { messages, terminate: shouldTerminateBatch(finalizedCalls) };
}

async function executeParallel(
	context: AgentContext,
	assistantMessage: AssistantMessage,
	toolCalls: AgentToolCall[],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<ToolBatch> {
	const pending: Array<ToolCallOutcome | (() => Promise<ToolCallOutcome>)> = [];

	for (const toolCall of toolCalls) {
		await emit({
			type: "tool_execution_start",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			args: toolCall.arguments,
		});
		const preparation = await prepareToolCall(context, assistantMessage, toolCall, config, signal);
		if (preparation.kind === "immediate") {
			await emitToolExecutionEnd(preparation.value, emit);
			pending.push(preparation.value);
		} else {
			pending.push(async () => {
				if (signal?.aborted) {
					const finalized: ToolCallOutcome = {
						toolCall,
						result: createErrorToolResult("Operation aborted"),
						isError: true,
					};
					await emitToolExecutionEnd(finalized, emit);
					return finalized;
				}
				const finalized = await runPreparedCall(preparation, context, assistantMessage, config, signal, emit);
				await emitToolExecutionEnd(finalized, emit);
				return finalized;
			});
		}
		if (signal?.aborted) break;
	}

	const finalizedCalls = await Promise.all(
		pending.map((entry) => (typeof entry === "function" ? entry() : Promise.resolve(entry))),
	);
	const messages: ToolResultMessage[] = [];
	for (const finalized of finalizedCalls) {
		const resultMessage = createToolResultMessage(finalized);
		await emitToolResultMessage(resultMessage, emit);
		messages.push(resultMessage);
	}

	return { messages, terminate: shouldTerminateBatch(finalizedCalls) };
}

// toolcall执行前的准备。返回的kind为immediate时tool不需要执行；prepare时待执行
async function prepareToolCall(
	context: AgentContext,
	assistantMessage: AssistantMessage,
	toolCall: AgentToolCall,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
): Promise<Preparation> {
	const tool = context.tools?.find((candidate) => candidate.name === toolCall.name);
	// 没找到tool
	if (!tool) {
		return {
			kind: "immediate",
			value: { toolCall, result: createErrorToolResult(`Tool ${toolCall.name} not found`), isError: true },
		};
	}

	try {
		const args = tool.prepareArguments ? tool.prepareArguments(toolCall.arguments) : toolCall.arguments;
		// hook
		if (config.beforeToolCall) {
			const before: BeforeToolCallResult | undefined = await config.beforeToolCall(
				{ assistantMessage, toolCall, args, context },
				signal,
			);
			if (signal?.aborted || before?.block) {
				const result = createErrorToolResult(
					before?.reason ?? (signal?.aborted ? "Operation aborted" : "Tool execution was blocked"),
				);
				if (before?.terminate === true) result.terminate = true;
				return { kind: "immediate", value: { toolCall, result, isError: true } };
			}
		}
		if (signal?.aborted) {
			return {
				kind: "immediate",
				value: { toolCall, result: createErrorToolResult("Operation aborted"), isError: true },
			};
		}
		return { kind: "prepared", value: { toolCall, tool, args: args as Record<string, unknown> } };
	} catch (error) {
		return {
			kind: "immediate",
			value: {
				toolCall,
				result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
				isError: true,
			},
		};
	}
}

/**
 * 执行一个已准备好的工具调用，并在返回前应用 `afterToolCall`。
 *
 * 不负责发送 `tool_execution_end` 与工具结果消息；这两步由调用方在拿到最终结果后统一完成。
 */
async function runPreparedCall(
	preparation: Preparation,
	context: AgentContext,
	assistantMessage: AssistantMessage,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<ToolCallOutcome> {
	// 预检阶段已经失败：没有工具要执行，直接使用现成的错误结果。
	if (preparation.kind === "immediate") return preparation.value;

	const { toolCall, tool, args } = preparation.value;
	// execute 期间产生的增量事件先收集起来，等 execute 结束再统一等待，避免事件尚未发出就收尾。
	const updateEvents: Promise<void>[] = [];
	let acceptingUpdates = true; // execute 返回后不再接受更新；工具若再使用回调函数，内容会直接丢弃

	let executed: ExecutedToolCall;

	try {
		const result = await tool.execute(
            toolCall.id, args as never, signal, 
            (partialResult) => { // 回调函数，让工具汇报进度
    			if (!acceptingUpdates) return;  // acceptingUpdates=false后，更新内容直接丢弃
    			updateEvents.push(
    				Promise.resolve(
    					emit({ // 工具执行过程中的进度事件
    						type: "tool_execution_update",
    						toolCallId: toolCall.id,
    						toolName: toolCall.name,
    						args,
    						partialResult,
    					}),
    				),
    			);
    		}
        );
		acceptingUpdates = false; // execute结束，关闭闸门
		await Promise.all(updateEvents);
		executed = { result, isError: false };
	} catch (error) {
		// 工具抛错不算循环失败：转成错误结果回填给模型，由模型决定重试或换方案。
		acceptingUpdates = false;
		await Promise.all(updateEvents);
		executed = {
			result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
			isError: true,
		};
	}

	// hook
	if (config.afterToolCall) {
		const after: AfterToolCallResult | undefined = await config.afterToolCall(
			{ assistantMessage, toolCall, args, result: executed.result, isError: executed.isError, context },
			signal,
		);
		if (after) {
			const merged: AgentToolResult = {
				...executed.result,
				content: after.content ?? executed.result.content,
				details: after.details ?? executed.result.details,
				usage: after.usage ?? executed.result.usage,
				terminate: after.terminate ?? executed.result.terminate,
			};
			return { toolCall, result: merged, isError: after.isError ?? executed.isError };
		}
	}

	return { toolCall, ...executed };
}

// 每个工具都返回terminate=true —— true
function shouldTerminateBatch(finalizedCalls: ToolCallOutcome[]): boolean {
	return finalizedCalls.length > 0 && finalizedCalls.every((call) => call.result.terminate === true);
}

function createToolResultMessage(finalized: ToolCallOutcome): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: finalized.toolCall.id,
		toolName: finalized.toolCall.name,
		content: finalized.result.content ?? [],
		details: finalized.result.details,
		usage: finalized.result.usage,
		...(finalized.result.addedToolNames?.length ? { addedToolNames: finalized.result.addedToolNames } : {}),
		isError: finalized.isError,
		timestamp: Date.now(),
	};
}

async function emitToolExecutionEnd(finalized: ToolCallOutcome, emit: AgentEventSink): Promise<void> {
	await emit({
		type: "tool_execution_end",
		toolCallId: finalized.toolCall.id,
		toolName: finalized.toolCall.name,
		result: finalized.result,
		isError: finalized.isError,
	});
}

async function emitToolResultMessage(message: ToolResultMessage, emit: AgentEventSink): Promise<void> {
	await emit({ type: "message_start", message });
	await emit({ type: "message_end", message });
}
