import { describe, expect, it } from "vitest";
import * as pkg from "../src/index.ts";

describe("@pipi/agent public entry", () => {
	it("exports the runtime classes and loop", () => {
		expect(typeof pkg.Agent).toBe("function");
		expect(typeof pkg.PendingMessageQueue).toBe("function");
		expect(typeof pkg.runAgentLoop).toBe("function");
	});

	it("constructs an Agent from the public API", () => {
		const agent = new pkg.Agent({
			streamFn: () => {
				throw new Error("unused");
			},
		});
		expect(agent.state.messages).toEqual([]);
		expect(agent.hasQueuedMessages()).toBe(false);
	});
});
