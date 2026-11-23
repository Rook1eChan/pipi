import type { AgentMessage, QueueMode } from "./types.ts";

/**
 * 排队消息：steering 与 followUp 共用同一套行为。
 *
 * `drain()` 按 `mode` 决定一次取多少条：
 * - `"all"`：取走全部
 * - `"single"`：只取最早的一条
 */
export class PendingMessageQueue {
	private messages: AgentMessage[] = [];
	public mode: QueueMode;

	constructor(mode: QueueMode = "single") {
		this.mode = mode;
	}

	/** 追加到队尾。 */
	enqueue(message: AgentMessage): void {
		this.messages.push(message);
	}

	/** 队列里是否还有消息。 */
	hasItems(): boolean {
		return this.messages.length > 0;
	}

	/** 按当前模式取走消息，并保持剩余消息的顺序。 */
	drain(): AgentMessage[] {
		if (this.mode === "all") {
			const drained = this.messages.slice();
			this.messages = [];
			return drained;
		}

		const first = this.messages[0];
		if (!first) return [];
		this.messages = this.messages.slice(1);
		return [first];
	}

	/** 丢弃全部排队消息。 */
	clear(): void {
		this.messages = [];
	}
}
