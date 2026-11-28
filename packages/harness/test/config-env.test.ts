import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR, ENV_SESSION_DIR, getAgentDir, getSessionsRoot } from "../src/config.ts";

const originalAgentDir = process.env[ENV_AGENT_DIR];
const originalSessionDir = process.env[ENV_SESSION_DIR];

afterEach(() => {
	if (originalAgentDir === undefined) delete process.env[ENV_AGENT_DIR];
	else process.env[ENV_AGENT_DIR] = originalAgentDir;
	if (originalSessionDir === undefined) delete process.env[ENV_SESSION_DIR];
	else process.env[ENV_SESSION_DIR] = originalSessionDir;
});

describe("config environment overrides", () => {
	it("uses PIPI_CODING_AGENT_DIR when set", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pipi-agent-dir-"));
		process.env[ENV_AGENT_DIR] = dir;

		expect(getAgentDir()).toBe(dir);
		await rm(dir, { recursive: true, force: true });
	});

	it("uses PIPI_CODING_AGENT_SESSION_DIR when set", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pipi-session-dir-"));
		process.env[ENV_SESSION_DIR] = dir;

		expect(getSessionsRoot()).toBe(dir);
		await rm(dir, { recursive: true, force: true });
	});
});
