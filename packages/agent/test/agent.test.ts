import {
	type AssistantMessage,
	AssistantMessageEventStream,
	type Context,
	type Message,
	type Model,
	type ToolResultMessage,
	type Usage,
} from "@pipi/llm";
import { describe, expect, it, vi } from "vitest";
import { Agent, type AgentOptions, type StreamFn } from "../src/index.ts";

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
		content: [{ type: "text", text: "ok" }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage,
		stopReason: "stop",
		timestamp: 1,
		...overrides,
	};
}

function user(text: string): Message {
	return { role: "user", content: text, timestamp: 1 };
}

function streamOf(...messages: AssistantMessage[]) {
	let index = 0;
	return async () => {
		const message = messages[index++];
		if (!message) throw new Error("unexpected extra model call");
		const stream = new AssistantMessageEventStream();
		stream.push({ type: "start", partial: message });
		if (message.stopReason === "error" || message.stopReason === "aborted") {
			stream.push({ type: "error", reason: message.stopReason, error: message });
		} else {
			stream.push({ type: "done", reason: "stop", message });
		}
		return stream;
	};
}

function newAgent(streamFn: StreamFn, initialState: AgentOptions["initialState"] = {}): Agent {
	return new Agent({ streamFn, initialState: { model, ...initialState } });
}

describe("Agent.prompt", () => {
	it("appends the prompt and the assistant reply to state", async () => {
		const agent = newAgent(streamOf(assistant()));
		await agent.prompt("hi");

		expect(agent.state.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
		expect(agent.state.messages[0]).toMatchObject({ role: "user", content: [{ type: "text", text: "hi" }] });
		expect(agent.state.isRunning).toBe(false);
	});

	it("accepts message arrays and appends images to string prompts", async () => {
		const agent = newAgent(streamOf(assistant(), assistant()));
		await agent.prompt("look", [{ type: "image", data: "abc", mimeType: "image/png" }]);
		const first = agent.state.messages[0] as Message;
		expect(Array.isArray(first.content) ? first.content : []).toEqual([
			{ type: "text", text: "look" },
			{ type: "image", data: "abc", mimeType: "image/png" },
		]);

		await agent.prompt([user("a"), user("b")]);
		expect(agent.state.messages.filter((message) => message.role === "user")).toHaveLength(3);
	});

	it("rejects a second prompt while running", async () => {
		let started!: () => void;
		const startedPromise = new Promise<void>((resolve) => {
			started = resolve;
		});
		const streamFn: StreamFn = (_model, _context, options) => {
			const stream = new AssistantMessageEventStream();
			started();
			options?.signal?.addEventListener("abort", () => {
				stream.push({ type: "error", reason: "aborted", error: assistant({ stopReason: "aborted" }) });
			});
			return stream;
		};
		const agent = newAgent(streamFn);
		const running = agent.prompt("first");
		await startedPromise;

		await expect(agent.prompt("second")).rejects.toThrow(/already processing/);
		agent.abort();
		await running;
	});

	it("aborts the run and records an aborted assistant message", async () => {
		let started!: () => void;
		const startedPromise = new Promise<void>((resolve) => {
			started = resolve;
		});
		const streamFn: StreamFn = (_model, _context, options) => {
			const stream = new AssistantMessageEventStream();
			started();
			options?.signal?.addEventListener("abort", () => {
				stream.push({
					type: "error",
					reason: "aborted",
					error: assistant({ stopReason: "aborted", errorMessage: "user abort" }),
				});
			});
			return stream;
		};
		const agent = newAgent(streamFn);
		const running = agent.prompt("hi");
		await startedPromise;
		expect(agent.signal?.aborted).toBe(false);

		agent.abort();
		await running;

		const last = agent.state.messages.at(-1) as AssistantMessage;
		expect(last.stopReason).toBe("aborted");
		expect(agent.state.isRunning).toBe(false);
	});
});

describe("Agent.waitForIdle", () => {
	it("resolves immediately when idle", async () => {
		const agent = newAgent(streamOf(assistant()));
		await expect(agent.waitForIdle()).resolves.toBeUndefined();
	});

	it("resolves after the active run settles", async () => {
		let started!: () => void;
		const startedPromise = new Promise<void>((resolve) => {
			started = resolve;
		});
		const streamFn: StreamFn = (_model, _context, options) => {
			const stream = new AssistantMessageEventStream();
			started();
			options?.signal?.addEventListener("abort", () => {
				stream.push({ type: "error", reason: "aborted", error: assistant({ stopReason: "aborted" }) });
			});
			return stream;
		};
		const agent = newAgent(streamFn);
		const running = agent.prompt("hi");
		await startedPromise;

		const idle = agent.waitForIdle();
		agent.abort();
		await idle;
		await running;
		expect(agent.state.isRunning).toBe(false);
	});
});

describe("Agent queues", () => {
	it("injects steering messages before the model call", async () => {
		const seen: Context[] = [];
		const streamFn: StreamFn = async (_model, context) => {
			seen.push(context);
			return streamOf(assistant())();
		};
		const agent = newAgent(streamFn);
		const steer = user("steer");
		agent.steer(steer);
		expect(agent.hasQueuedMessages()).toBe(true);

		await agent.prompt("hi");

		expect(seen[0].messages).toContain(steer);
		expect(agent.hasQueuedMessages()).toBe(false);
	});

	it("runs followUp messages after the agent would stop", async () => {
		let calls = 0;
		const seen: Context[] = [];
		const streamFn: StreamFn = async (_model, context) => {
			calls++;
			seen.push(context);
			return streamOf(assistant({ content: [{ type: "text", text: `reply ${calls}` }] }))();
		};
		const agent = newAgent(streamFn);
		const followUp = user("later");
		agent.followUp(followUp);

		await agent.prompt("hi");

		expect(calls).toBe(2);
		expect(seen[1].messages).toContain(followUp);
	});

	it("clears queued messages", () => {
		const agent = newAgent(streamOf(assistant()));
		agent.steer(user("a"));
		agent.followUp(user("b"));
		agent.clearSteeringQueue();
		expect(agent.hasQueuedMessages()).toBe(true);
		agent.clearFollowUpQueue();
		expect(agent.hasQueuedMessages()).toBe(false);
	});
});

describe("Agent.continue", () => {
	it("throws when there is nothing to continue from", async () => {
		const agent = newAgent(streamOf(assistant()));
		await expect(agent.continue()).rejects.toThrow(/No messages/);
	});

	it("throws when the last message is an assistant and no queue has messages", async () => {
		const agent = newAgent(streamOf(assistant()), { messages: [assistant()] });
		await expect(agent.continue()).rejects.toThrow(/Cannot continue/);
	});

	it("continues from a user message without adding a prompt", async () => {
		const seen: Context[] = [];
		const streamFn: StreamFn = async (_model, context) => {
			seen.push(context);
			return streamOf(assistant())();
		};
		const agent = newAgent(streamFn, { messages: [user("pending")] });
		await agent.continue();
		expect(seen[0].messages).toHaveLength(1);
		expect(agent.state.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
	});

	it("passes queued followUp as the prompt when the last message is an assistant", async () => {
		const seen: Context[] = [];
		const streamFn: StreamFn = async (_model, context) => {
			seen.push(context);
			return streamOf(assistant())();
		};
		const followUp = user("later");
		const agent = newAgent(streamFn, { messages: [assistant()] });
		agent.followUp(followUp);

		await agent.continue();

		expect(seen).toHaveLength(1);
		expect(seen[0].messages).toContain(followUp);
	});

	it("injects steering first and followUp on the next turn", async () => {
		const seen: Context[] = [];
		const streamFn: StreamFn = async (_model, context) => {
			seen.push(context);
			return streamOf(assistant())();
		};
		const steer = user("steer");
		const followUp = user("later");
		const agent = newAgent(streamFn, { messages: [assistant()] });
		agent.steer(steer);
		agent.followUp(followUp);

		await agent.continue();

		expect(seen).toHaveLength(2);
		expect(seen[0].messages).toContain(steer);
		expect(seen[0].messages).not.toContain(followUp);
		expect(seen[1].messages).toContain(followUp);
	});

	it("uses queued steering when the last message is an assistant", async () => {
		const seen: Context[] = [];
		const streamFn: StreamFn = async (_model, context) => {
			seen.push(context);
			return streamOf(assistant())();
		};
		const steer = user("steer");
		const agent = newAgent(streamFn, { messages: [assistant()] });
		agent.steer(steer);

		await agent.continue();

		expect(seen[0].messages).toContain(steer);
	});
});

describe("Agent.reset", () => {
	it("clears messages and queues", async () => {
		const agent = newAgent(streamOf(assistant()));
		await agent.prompt("hi");
		agent.steer(user("queued"));

		agent.reset();

		expect(agent.state.messages).toEqual([]);
		expect(agent.state.isRunning).toBe(false);
		expect(agent.hasQueuedMessages()).toBe(false);
	});

	it("throws while a run is active", async () => {
		let started!: () => void;
		const startedPromise = new Promise<void>((resolve) => {
			started = resolve;
		});
		const streamFn: StreamFn = (_model, _context, options) => {
			const stream = new AssistantMessageEventStream();
			started();
			options?.signal?.addEventListener("abort", () => {
				stream.push({ type: "error", reason: "aborted", error: assistant({ stopReason: "aborted" }) });
			});
			return stream;
		};
		const agent = newAgent(streamFn);
		const running = agent.prompt("hi");
		await startedPromise;

		expect(() => agent.reset()).toThrow(/already processing/);
		agent.abort();
		await running;
	});
});

describe("Agent event reduction", () => {
	it("tracks the streaming message until message_end", async () => {
		const partial = assistant({ content: [], stopReason: "pending" });
		const finalMessage = assistant({ content: [{ type: "text", text: "done" }] });
		const streamFn: StreamFn = async () => {
			const stream = new AssistantMessageEventStream();
			stream.push({ type: "start", partial });
			stream.push({
				type: "text_delta",
				contentIndex: 0,
				delta: "do",
				partial: assistant({ content: [{ type: "text", text: "do" }] }),
			});
			stream.push({ type: "done", reason: "stop", message: finalMessage });
			return stream;
		};
		const agent = newAgent(streamFn);
		const snapshots: Array<{ type: string; streaming?: boolean; text?: string }> = [];
		agent.subscribe((event) => {
			if (
				(event.type === "message_start" || event.type === "message_update" || event.type === "message_end") &&
				event.message.role === "assistant"
			) {
				const message = event.message as AssistantMessage;
				const block = message.content[0];
				snapshots.push({
					type: event.type,
					streaming: agent.state.streamingMessage !== undefined,
					text: block?.type === "text" ? block.text : undefined,
				});
			}
		});

		await agent.prompt("hi");

		expect(snapshots).toEqual([
			{ type: "message_start", streaming: true, text: undefined },
			{ type: "message_update", streaming: true, text: "do" },
			{ type: "message_end", streaming: false, text: "done" },
		]);
		expect((agent.state.messages.at(-1) as AssistantMessage).content).toEqual([{ type: "text", text: "done" }]);
	});

	it("tracks pending tool calls", async () => {
		const sizes: number[] = [];
		const streamFn = streamOf(
			assistant({ content: [{ type: "toolCall", id: "c1", name: "echo", arguments: {} }], stopReason: "toolUse" }),
			assistant(),
		);
		const agent = newAgent(streamFn, {
			tools: [
				{
					name: "echo",
					label: "Echo",
					description: "echo",
					parameters: {},
					execute: async () => ({ content: [], details: {} }),
				},
			],
		});
		agent.subscribe((event) => {
			if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
				sizes.push(agent.state.pendingToolCalls.size);
			}
		});

		await agent.prompt("hi");

		expect(sizes).toEqual([1, 0]);
	});

	it("records the error message from a failed turn", async () => {
		const failed = assistant({ content: [], stopReason: "error", errorMessage: "429" });
		const agent = newAgent(streamOf(failed));
		await agent.prompt("hi");
		expect(agent.state.errorMessage).toBe("429");
	});

	it("clears the error message when the next run starts", async () => {
		const failed = assistant({ content: [], stopReason: "error", errorMessage: "429" });
		const agent = newAgent(streamOf(failed, assistant()));
		await agent.prompt("first");
		expect(agent.state.errorMessage).toBe("429");

		await agent.prompt("second");
		expect(agent.state.errorMessage).toBeUndefined();
	});
});

describe("Agent.subscribe", () => {
	it("receives events in order with the run signal", async () => {
		const events: string[] = [];
		const agent = newAgent(streamOf(assistant()));
		agent.subscribe((event, signal) => {
			expect(signal.aborted).toBe(false);
			events.push(event.type);
		});

		await agent.prompt("hi");

		expect(events).toEqual([
			"agent_start",
			"turn_start",
			"message_start",
			"message_end",
			"message_start",
			"message_end",
			"turn_end",
			"agent_end",
		]);
	});

	it("stops notifying after unsubscribe", async () => {
		let count = 0;
		const agent = newAgent(streamOf(assistant(), assistant()));
		const unsubscribe = agent.subscribe(() => {
			count++;
		});
		await agent.prompt("first");
		const firstCount = count;
		unsubscribe();
		await agent.prompt("second");
		expect(count).toBe(firstCount);
	});

	it("awaits listeners in registration order", async () => {
		const order: string[] = [];
		const agent = newAgent(streamOf(assistant()));
		agent.subscribe(async () => {
			await new Promise<void>((resolve) => setTimeout(resolve, 5));
			order.push("first");
		});
		agent.subscribe(async () => {
			order.push("second");
		});

		await agent.prompt("hi");

		expect(order).toHaveLength(16);
		for (let index = 0; index < order.length; index += 2) {
			expect(order.slice(index, index + 2)).toEqual(["first", "second"]);
		}
	});

	it("propagates listener errors", async () => {
		const agent = newAgent(streamOf(assistant()));
		agent.subscribe(() => {
			throw new Error("listener failed");
		});

		await expect(agent.prompt("hi")).rejects.toThrow("listener failed");
		await expect(agent.waitForIdle()).resolves.toBeUndefined();
	});
});

describe("Agent hooks and options", () => {
	it("forwards session and transport options to the stream function", async () => {
		const seen: Array<Record<string, unknown>> = [];
		const streamFn: StreamFn = async (_model, _context, options) => {
			seen.push(options as unknown as Record<string, unknown>);
			return streamOf(assistant())();
		};
		const agent = new Agent({
			streamFn,
			initialState: { model, thinkingLevel: "high" },
			sessionId: "s1",
			transport: "sse",
			maxRetryDelayMs: 100,
			thinkingBudgets: { high: 1000 },
		});

		await agent.prompt("hi");

		expect(seen[0]).toMatchObject({
			sessionId: "s1",
			transport: "sse",
			maxRetryDelayMs: 100,
			thinkingBudgets: { high: 1000 },
			reasoning: "high",
		});
	});

	it("passes beforeToolCall to the loop", async () => {
		const execute = vi.fn(async () => ({ content: [{ type: "text" as const, text: "raw" }], details: {} }));
		const streamFn = streamOf(
			assistant({ content: [{ type: "toolCall", id: "c1", name: "echo", arguments: {} }], stopReason: "toolUse" }),
			assistant(),
		);
		const agent = newAgent(streamFn, {
			tools: [{ name: "echo", label: "Echo", description: "echo", parameters: {}, execute }],
		});
		agent.beforeToolCall = async () => ({ block: true, reason: "denied" });

		await agent.prompt("hi");

		expect(execute).not.toHaveBeenCalled();
		const result = agent.state.messages.find((message) => message.role === "toolResult") as ToolResultMessage;
		expect(result.content).toEqual([{ type: "text", text: "denied" }]);
	});

	it("passes afterToolCall to the loop", async () => {
		const streamFn = streamOf(
			assistant({ content: [{ type: "toolCall", id: "c1", name: "echo", arguments: {} }], stopReason: "toolUse" }),
			assistant(),
		);
		const agent = newAgent(streamFn, {
			tools: [
				{
					name: "echo",
					label: "Echo",
					description: "echo",
					parameters: {},
					execute: async () => ({ content: [], details: {} }),
				},
			],
		});
		agent.afterToolCall = async () => ({ content: [{ type: "text", text: "after" }] });

		await agent.prompt("hi");

		const result = agent.state.messages.find((message) => message.role === "toolResult") as ToolResultMessage;
		expect(result.content).toEqual([{ type: "text", text: "after" }]);
	});

	it("stops after a turn when shouldStopAfterTurn returns true", async () => {
		const streamFn = streamOf(
			assistant({ content: [{ type: "toolCall", id: "c1", name: "echo", arguments: {} }], stopReason: "toolUse" }),
			assistant(),
		);
		const agent = newAgent(streamFn, {
			tools: [
				{
					name: "echo",
					label: "Echo",
					description: "echo",
					parameters: {},
					execute: async () => ({ content: [], details: {} }),
				},
			],
		});
		const seen: string[] = [];
		agent.shouldStopAfterTurn = async () => {
			seen.push("stopped");
			return true;
		};

		await agent.prompt("hi");

		expect(seen).toHaveLength(1);
		expect(agent.state.messages.filter((message) => message.role === "assistant")).toHaveLength(1);
	});

	it("switches model for the next turn via prepareNextTurn", async () => {
		const nextModel: Model = { ...model, id: "m2" };
		const models: string[] = [];
		const streamFn: StreamFn = async (current) => {
			models.push(current.id);
			return streamOf(
				models.length === 1
					? assistant({
							content: [{ type: "toolCall", id: "c1", name: "echo", arguments: {} }],
							stopReason: "toolUse",
						})
					: assistant(),
			)();
		};
		const agent = newAgent(streamFn, {
			tools: [
				{
					name: "echo",
					label: "Echo",
					description: "echo",
					parameters: {},
					execute: async () => ({ content: [], details: {} }),
				},
			],
		});
		agent.prepareNextTurnWithContext = async () => ({ model: nextModel });

		await agent.prompt("hi");

		expect(models).toEqual(["m", "m2"]);
	});
});

describe("Agent failure handling", () => {
	it("turns a loop-level exception into an error message and closes the run", async () => {
		const events: string[] = [];
		const agent = new Agent({
			streamFn: streamOf(assistant()),
			initialState: { model },
			convertToLlm: () => {
				throw new Error("boom");
			},
		});
		agent.subscribe((event) => {
			events.push(event.type);
		});

		await expect(agent.prompt("hi")).resolves.toBeUndefined();

		const last = agent.state.messages.at(-1) as AssistantMessage;
		expect(last.stopReason).toBe("error");
		expect(last.errorMessage).toBe("boom");
		expect(agent.state.errorMessage).toBe("boom");
		expect(agent.state.isRunning).toBe(false);
		expect(events.slice(-4)).toEqual(["message_start", "message_end", "turn_end", "agent_end"]);
	});
});
