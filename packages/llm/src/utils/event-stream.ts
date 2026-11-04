import type { AssistantMessage, AssistantMessageEvent } from "../types.ts";

/**
 * 用两个数组实现的 FIFO 队列。
 * JS 的顺序存储类型只有 Array，而 Array 的 FIFO 是 O(n)（使用queue.shift()）
 * 出队时如果 outgoing 已空，就把 incoming 整体倒序搬运过去
 * 每次移动整个数组。摊还到每个元素是 O(1)。
 */
class FifoQueue<T> {
	private incoming: T[] = [];
	private outgoing: T[] = [];

	get length(): number {
		return this.incoming.length + this.outgoing.length;
	}

	enqueue(value: T): void {
		this.incoming.push(value);
	}

	dequeue(): T | undefined {
		if (this.outgoing.length === 0) {
			while (this.incoming.length > 0) {
				this.outgoing.push(this.incoming.pop()!);
			}
		}
		return this.outgoing.pop();
	}
}

/**
 * 单消费者异步事件流。
 *
 * 生产者用 push 投递事件，消费者用 for await 逐个读取。生产者先于消费者时事件进入
 */
export class EventStream<T, R = T> implements AsyncIterable<T> {
	private queue = new FifoQueue<T>(); // 数据队列，当生产者快于消费者时，数据先存在这里
	private waiting = new FifoQueue<(result: IteratorResult<T, void>) => void>(); // 消费者等待队列，没有数据时，消费者等待
	private done = false;
	private readonly finalResult: Promise<R>;
	private resolveFinalResult!: (result: R) => void;
	private readonly isComplete: (event: T) => boolean;
	private readonly extractResult: (event: T) => R;

	constructor(isComplete: (event: T) => boolean, extractResult: (event: T) => R) {
		this.isComplete = isComplete;
		this.extractResult = extractResult;
		this.finalResult = new Promise<R>((resolve) => {
			this.resolveFinalResult = resolve;
		});
	}

	push(event: T): void {
		if (this.done) {
			return;
		}

		if (this.isComplete(event)) {
			this.done = true;
			this.resolveFinalResult(this.extractResult(event));
		}

		const waiter = this.waiting.dequeue();
		if (waiter) {
			waiter({ value: event, done: false });
		} else {
			this.queue.enqueue(event);
		}
	}

	end(result?: R): void {
		this.done = true;
		if (result !== undefined) {
			this.resolveFinalResult(result);
		}
		while (this.waiting.length > 0) {
			this.waiting.dequeue()!({ value: undefined, done: true });
		}
	}

	result(): Promise<R> {
		return this.finalResult;
	}

	// 消费者使用 for await，调用 [Symbol.asyncIterator]() 方法
	async *[Symbol.asyncIterator](): AsyncGenerator<T, void, unknown> {
		while (true) {
			// 有数据，拿数据
			if (this.queue.length > 0) {
				yield this.queue.dequeue()!;
			} else if (this.done) {
				return;
			} else {
				// 没数据，新建一个 promise，放进 waiting 队列
				// 唤醒时拿到 result
				const result = await new Promise<IteratorResult<T, void>>((resolve) => this.waiting.enqueue(resolve));
				if (result.done) {
					return;
				}
				yield result.value;
			}
		}
	}
}

/**助手消息事件流：把 EventStream 通用类，包装成助手消息的专门类。
 * 把原类的 T、R 类型定下来；
 * 在 super 中实现 isComplete 和 extractResult */
export class AssistantMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") {
					return event.message;
				}
				if (event.type === "error") {
					return event.error;
				}
				throw new Error(`Unexpected terminal event: ${event.type}`);
			},
		);
	}
}
