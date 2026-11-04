import {
	AssistantMessageEventStream,
	EventStream,
	lazyStream,
	parseJsonWithRepair,
	parseStreamingJson,
	repairJson,
} from "@pipi/llm";
import { describe, expect, it } from "vitest";

describe("public API", () => {
	it("exports stream protocol utilities", () => {
		expect(typeof EventStream).toBe("function");
		expect(typeof AssistantMessageEventStream).toBe("function");
		expect(typeof lazyStream).toBe("function");
		expect(typeof repairJson).toBe("function");
		expect(typeof parseJsonWithRepair).toBe("function");
		expect(typeof parseStreamingJson).toBe("function");
	});
});
