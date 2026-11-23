import { Compile } from "typebox/compile";
import type { TLocalizedValidationError } from "typebox/error";
import { Value } from "typebox/value";
import type { Tool, ToolCall } from "../types.ts";

type CompiledValidator = ReturnType<typeof Compile>;

// 建立tool schema和校验器的映射
// 当键变为null时，WeakMap的条目自动删除
const validatorCache = new WeakMap<object, CompiledValidator>();

// null 清理只读取这几个结构化关键字，其余关键字交给 Compile
interface JsonSchemaObject {
	type?: string | string[];
	properties?: Record<string, JsonSchemaObject>;
	required?: string[];
	items?: JsonSchemaObject | JsonSchemaObject[];
	$ref?: string;
}

// 找到schema对应的校验器，先找cache，没有则新建
function getValidator(schema: Tool["parameters"]): CompiledValidator {
	const cached = validatorCache.get(schema);
	if (cached) return cached;

	const validator = Compile(schema);
	validatorCache.set(schema, validator);
	return validator;
}

// 字段本身接受 null 时保留原值；无法判断时也保留，避免误删
function acceptsNull(schema: JsonSchemaObject): boolean {
	if (typeof schema.$ref === "string") return true;
	try {
		return getValidator(schema as Tool["parameters"]).Check(null);
	} catch {
		return true;
	}
}

// 把可选且为null的参数删掉
function normalizeOptionalNulls(value: unknown, schema: JsonSchemaObject): void {
	if (Array.isArray(value)) {
		if (Array.isArray(schema.items)) {
			for (let index = 0; index < value.length; index++) {
				const itemSchema = schema.items[index];
				if (itemSchema) normalizeOptionalNulls(value[index], itemSchema);
			}
		} else if (schema.items) {
			for (const item of value) normalizeOptionalNulls(item, schema.items);
		}
		return;
	}

	if (typeof value !== "object" || value === null || !schema.properties) return;

	const object = value as Record<string, unknown>;
	const required = new Set(schema.required ?? []);
	for (const [key, propertySchema] of Object.entries(schema.properties)) {
		if (!(key in object)) continue;

		if (object[key] === null && !required.has(key) && !acceptsNull(propertySchema)) {
			delete object[key];
			continue;
		}
		normalizeOptionalNulls(object[key], propertySchema);
	}
}

// JSON Pointer 转成模型熟悉的点号路径；缺字段报在字段本身
function formatValidationPath(error: TLocalizedValidationError): string {
	if (error.keyword === "required") {
		const requiredProperties = (error.params as { requiredProperties?: string[] }).requiredProperties;
		const requiredProperty = requiredProperties?.[0];
		if (requiredProperty) {
			const basePath = error.instancePath.replace(/^\//, "").replace(/\//g, ".");
			return basePath ? `${basePath}.${requiredProperty}` : requiredProperty;
		}
	}

	const path = error.instancePath.replace(/^\//, "").replace(/\//g, ".");
	return path || "root";
}

/**
 * 按名字在给定工具集中找到定义，再校验这次工具调用的参数。
 * 找不到工具时抛错，与参数校验失败共用同一种错误形式。
 */
export function validateToolCall(tools: Tool[], toolCall: ToolCall): Record<string, unknown> {
	const tool = tools.find((candidate) => candidate.name === toolCall.name);
	if (!tool) {
		throw new Error(`Tool "${toolCall.name}" not found`);
	}
	return validateToolArguments(tool, toolCall);
}

/**
 * 按工具声明的 TypeBox schema 校验调用参数，返回校验并转换后的副本。
 * 失败时抛错，错误信息包含失败路径与模型给出的原始参数。
 */
export function validateToolArguments(tool: Tool, toolCall: ToolCall): Record<string, unknown> {
	const args: Record<string, unknown> = structuredClone(toolCall.arguments); // structuredClone为内置方法，复制一份json

	// 1.把可选且为null的参数删掉，因为Convert会把null变为类型的默认值（0、“null”、false）
	normalizeOptionalNulls(args, tool.parameters as JsonSchemaObject);
	// 2.根据tool schema对参数的类型的定义，把args的类型错误改正
	Value.Convert(tool.parameters, args);

	const validator = getValidator(tool.parameters);
	// 3.用编译后的校验器对args做最终检查
	if (validator.Check(args)) return args;

	const errors =
		validator
			.Errors(args)
			.map((error) => `  - ${formatValidationPath(error)}: ${error.message}`)
			.join("\n") || "Unknown validation error";
	const received = JSON.stringify(toolCall.arguments, null, 2);

	throw new Error(`Validation failed for tool "${toolCall.name}":\n${errors}\n\nReceived arguments:\n${received}`);
}
