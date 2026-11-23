import {
	type AssistantMessage,
	AssistantMessageEventStream,
	type Context,
	type Message,
	type Model,
	type ToolResultMessage,
	type Usage,
} from "@pipi/llm";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import {
	type AgentEvent,
	type AgentLoopConfig,
	type AgentTool,
	type AgentToolResult,
	runAgentLoop,
	type StreamFn,
} from "../src/index.ts";

const model: Model = {
	id: "m",
	name: "m",
	api: "openai-completions",
	provider: "faux",
	baseUrl: "",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1000,
	maxTokens: 100,
};

const usage: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage,
		stopReason: "stop",
		timestamp: 1,
		...overrides,
	};
}

function prompt(text = "hi"): Message {
	return { role: "user", content: text, timestamp: 1 };
}

function toolCall(id: string, name: string, args: Record<string, unknown> = {}) {
	return { type: "toolCall" as const, id, name, arguments: args };
}

function scriptedStreamFn(...messages: AssistantMessage[]) {
	let index = 0;
	return async () => {
		const message = messages[index++];
		if (!message) throw new Error("unexpected extra model call");
		const stream = new AssistantMessageEventStream();
		stream.push({ type: "start", partial: message });
		if (message.stopReason === "error" || message.stopReason === "aborted") {
			stream.push({ type: "error", reason: message.stopReason, error: message });
		} else {
			const reason =
				message.stopReason === "length" ? "length" : message.stopReason === "toolUse" ? "toolUse" : "stop";
			stream.push({ type: "done", reason, message });
		}
		return stream;
	};
}

function tool(name: string, execute: AgentTool["execute"], extra: Partial<AgentTool> = {}): AgentTool {
	return {
		name,
		label: name,
		description: name,
		parameters: {},
		execute,
		...extra,
	};
}

function config(extra: Partial<AgentLoopConfig> = {}): AgentLoopConfig {
	return { model, convertToLlm: (messages) => messages as Message[], ...extra };
}

function collect() {
	const events: AgentEvent[] = [];
	return {
		events,
		emit: (event: AgentEvent) => {
			events.push(event);
		},
	};
}

function types(events: AgentEvent[]): string[] {
	return events.map((event) => event.type);
}

async function run(
	streamFn: StreamFn,
	options: {
		tools?: AgentTool[];
		loopConfig?: Partial<AgentLoopConfig>;
		signal?: AbortSignal;
		prompts?: Message[];
	} = {},
) {
	const { events, emit } = collect();
	const messages = await runAgentLoop(
		(options.prompts ?? [prompt()]) as never,
		{ systemPrompt: "", messages: [], tools: options.tools },
		config(options.loopConfig),
		emit,
		options.signal,
		streamFn,
	);
	return { events, messages };
}

describe("runAgentLoop", () => {
	it("emits the full event sequence for a text reply", async () => {
		const { events, messages } = await run(scriptedStreamFn(assistant({ content: [{ type: "text", text: "ok" }] })));

		expect(types(events)).toEqual([
			"agent_start",
			"turn_start",
			"message_start",
			"message_end",
			"message_start",
			"message_end",
			"turn_end",
			"agent_end",
		]);
		expect(messages).toHaveLength(2);
		expect(messages[0]).toEqual(prompt());
	});

	it("executes a tool, appends its result, and calls the model again", async () => {
		const execute = vi.fn(async (_id: string, _args: unknown) => ({
			content: [{ type: "text" as const, text: "tool output" }],
			details: {},
		}));
		const first = assistant({ content: [toolCall("c1", "echo", { v: "x" })], stopReason: "toolUse" });
		const second = assistant({ content: [{ type: "text", text: "done" }] });

		const { events, messages } = await run(scriptedStreamFn(first, second), {
			tools: [tool("echo", execute)],
		});

		expect(execute).toHaveBeenCalledTimes(1);
		expect(execute.mock.calls[0][1]).toEqual({ v: "x" });
		const eventTypes = types(events);
		expect(eventTypes).toContain("tool_execution_start");
		expect(eventTypes).toContain("tool_execution_end");
		expect(events.filter((event) => event.type === "turn_start")).toHaveLength(2);
		expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult", "assistant"]);
		const result = messages[2] as ToolResultMessage;
		expect(result.content).toEqual([{ type: "text", text: "tool output" }]);
		expect(result.isError).toBe(false);
	});

	it("keeps tool result messages in original order when tools finish out of order", async () => {
		let finishFirst!: (value: AgentToolResult) => void;
		const firstPromise = new Promise<AgentToolResult>((resolve) => {
			finishFirst = resolve;
		});
		const order: string[] = [];
		const first = assistant({
			content: [toolCall("c1", "slow"), toolCall("c2", "fast")],
			stopReason: "toolUse",
		});

		const pending = run(scriptedStreamFn(first), {
			tools: [
				tool("slow", async () => {
					order.push("slow-start");
					const result = await firstPromise;
					order.push("slow-end");
					return result;
				}),
				tool("fast", async () => {
					order.push("fast-end");
					return { content: [{ type: "text", text: "fast" }], details: {} };
				}),
			],
		});
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		finishFirst({ content: [{ type: "text", text: "slow" }], details: {} });
		const { messages, events } = await pending;

		expect(order).toEqual(["slow-start", "fast-end", "slow-end"]);
		const results = messages.filter((message) => message.role === "toolResult") as ToolResultMessage[];
		expect(results.map((result) => (result.content[0] as { text: string }).text)).toEqual(["slow", "fast"]);
		const ends = events.filter((event) => event.type === "tool_execution_end");
		expect(ends.map((event) => (event as { toolName: string }).toolName)).toEqual(["fast", "slow"]);
	});

	it("forces sequential execution when a tool declares it", async () => {
		const order: string[] = [];
		const first = assistant({
			content: [toolCall("c1", "one"), toolCall("c2", "two")],
			stopReason: "toolUse",
		});
		await run(scriptedStreamFn(first), {
			tools: [
				tool("one", async () => {
					order.push("one");
					return { content: [], details: {} };
				}),
				tool(
					"two",
					async () => {
						order.push("two");
						return { content: [], details: {} };
					},
					{ executionMode: "sequential" },
				),
			],
		});
		expect(order).toEqual(["one", "two"]);
	});

	it("does not execute blocked tools", async () => {
		const execute = vi.fn(async () => ({ content: [], details: {} }));
		const first = assistant({ content: [toolCall("c1", "echo")], stopReason: "toolUse" });
		const { messages } = await run(scriptedStreamFn(first), {
			tools: [tool("echo", execute)],
			loopConfig: { beforeToolCall: async () => ({ block: true, reason: "denied" }) },
		});
		expect(execute).not.toHaveBeenCalled();
		const result = messages[2] as ToolResultMessage;
		expect(result.isError).toBe(true);
		expect((result.content[0] as { text: string }).text).toBe("denied");
	});

	it("applies afterToolCall overrides field by field", async () => {
		const first = assistant({ content: [toolCall("c1", "echo")], stopReason: "toolUse" });
		const { messages } = await run(scriptedStreamFn(first), {
			tools: [
				tool("echo", async () => ({ content: [{ type: "text", text: "raw" }], details: { a: 1 }, isError: false })),
			],
			loopConfig: {
				afterToolCall: async () => ({
					content: [{ type: "text", text: "replaced" }],
					isError: true,
					terminate: true,
				}),
			},
		});
		const result = messages[2] as ToolResultMessage;
		expect(result.content).toEqual([{ type: "text", text: "replaced" }]);
		expect(result.details).toEqual({ a: 1 });
		expect(result.isError).toBe(true);
	});

	it("fails all tool calls when the response was truncated", async () => {
		const execute = vi.fn(async () => ({ content: [], details: {} }));
		const truncated = assistant({
			content: [toolCall("c1", "echo", { v: "?" })],
			stopReason: "length",
		});
		const { messages } = await run(scriptedStreamFn(truncated), { tools: [tool("echo", execute)] });
		expect(execute).not.toHaveBeenCalled();
		const result = messages[2] as ToolResultMessage;
		expect(result.isError).toBe(true);
		expect((result.content[0] as { text: string }).text).toContain("token limit");
	});

	it("stops after a batch where every result sets terminate", async () => {
		const streamFn = scriptedStreamFn(
			assistant({ content: [toolCall("c1", "stopper")], stopReason: "toolUse" }),
			assistant({ content: [{ type: "text", text: "should not happen" }] }),
		);
		const { messages } = await run(streamFn, {
			tools: [tool("stopper", async () => ({ content: [], details: {}, terminate: true }))],
		});
		expect(messages.filter((message) => message.role === "assistant")).toHaveLength(1);
	});

	it("does not execute tools when the signal is aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const execute = vi.fn(async () => ({ content: [], details: {} }));
		const first = assistant({ content: [toolCall("c1", "echo")], stopReason: "toolUse" });
		await run(scriptedStreamFn(first), { tools: [tool("echo", execute)], signal: controller.signal });
		expect(execute).not.toHaveBeenCalled();
	});

	it("injects steering messages before the next model call", async () => {
		const seen: Context[] = [];
		const steering = prompt("steer");
		let pulled = 0;
		const streamFn: StreamFn = async (_, context) => {
			seen.push(context);
			return scriptedStreamFn(assistant({ content: [{ type: "text", text: "ok" }] }))();
		};
		await run(streamFn, {
			loopConfig: {
				getSteeringMessages: () => {
					pulled++;
					return pulled === 1 ? [steering] : [];
				},
			},
		});
		expect(seen[0].messages).toContain(steering);
	});

	it("resumes with a followUp message after the turn ends", async () => {
		let modelCalls = 0;
		const streamFn: StreamFn = async () => {
			modelCalls++;
			return scriptedStreamFn(assistant({ content: [{ type: "text", text: `reply ${modelCalls}` }] }))();
		};
		let pulled = 0;
		const { events } = await run(streamFn, {
			loopConfig: {
				getFollowUpMessages: () => {
					pulled++;
					return pulled === 1 ? [prompt("follow up")] : [];
				},
			},
		});
		expect(modelCalls).toBe(2);
		expect(events.filter((event) => event.type === "turn_start")).toHaveLength(2);
	});

	it("turns a throwing streamFn into an error message", async () => {
		const streamFn: StreamFn = async () => {
			throw new Error("network down");
		};
		const { messages, events } = await run(streamFn);
		const last = messages[messages.length - 1] as AssistantMessage;
		expect(last.stopReason).toBe("error");
		expect(last.errorMessage).toBe("network down");
		expect(events.some((event) => event.type === "agent_end")).toBe(true);
	});

	it("emits message_update while streaming and replaces the partial", async () => {
		const partial = assistant({ content: [], stopReason: "pending" });
		const finalMessage = assistant({ content: [{ type: "text", text: "complete" }] });
		const streamFn: StreamFn = async () => {
			const stream = new AssistantMessageEventStream();
			stream.push({ type: "start", partial });
			stream.push({ type: "text_delta", contentIndex: 0, delta: "co", partial: { ...partial } });
			stream.push({ type: "done", reason: "stop", message: finalMessage });
			return stream;
		};
		const { events, messages } = await run(streamFn);
		expect(events.some((event) => event.type === "message_update")).toBe(true);
		expect((messages[1] as AssistantMessage).content).toEqual([{ type: "text", text: "complete" }]);
	});
});

describe("tool argument validation", () => {
	it("coerces arguments before execute", async () => {
		const seen: unknown[] = [];
		const first = assistant({
			content: [toolCall("c1", "echo", { count: "5", label: "a" })],
			stopReason: "toolUse",
		});

		await run(scriptedStreamFn(first, assistant()), {
			tools: [
				tool(
					"echo",
					async (_id, args) => {
						seen.push(args);
						return { content: [], details: {} };
					},
					{ parameters: Type.Object({ count: Type.Number(), label: Type.String() }) },
				),
			],
		});

		expect(seen).toEqual([{ count: 5, label: "a" }]);
	});

	it("turns invalid arguments into an error result without running the tool", async () => {
		const execute = vi.fn(async () => ({ content: [], details: {} }));
		const first = assistant({ content: [toolCall("c1", "echo", { count: "ten" })], stopReason: "toolUse" });

		const { messages } = await run(scriptedStreamFn(first, assistant()), {
			tools: [tool("echo", execute, { parameters: Type.Object({ count: Type.Number() }) })],
		});

		expect(execute).not.toHaveBeenCalled();
		const result = messages.find((message) => message.role === "toolResult") as ToolResultMessage;
		expect(result.isError).toBe(true);
		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain('Validation failed for tool "echo"');
		expect(text).toContain("Received arguments");
	});

	it("gives beforeToolCall the validated arguments", async () => {
		const seen: unknown[] = [];
		const first = assistant({ content: [toolCall("c1", "echo", { count: "7" })], stopReason: "toolUse" });

		await run(scriptedStreamFn(first, assistant()), {
			tools: [
				tool("echo", async () => ({ content: [], details: {} }), {
					parameters: Type.Object({ count: Type.Number() }),
				}),
			],
			loopConfig: {
				beforeToolCall: async (context) => {
					seen.push(context.args);
					return undefined;
				},
			},
		});

		expect(seen).toEqual([{ count: 7 }]);
	});

	it("validates the arguments returned by prepareArguments", async () => {
		const seen: unknown[] = [];
		const first = assistant({ content: [toolCall("c1", "echo", { value: "3" })], stopReason: "toolUse" });

		await run(scriptedStreamFn(first, assistant()), {
			tools: [
				tool(
					"echo",
					async (_id, args) => {
						seen.push(args);
						return { content: [], details: {} };
					},
					{
						parameters: Type.Object({ count: Type.Number() }),
						prepareArguments: (args) => ({ count: (args as { value: string }).value }),
					},
				),
			],
		});

		expect(seen).toEqual([{ count: 3 }]);
	});
});
