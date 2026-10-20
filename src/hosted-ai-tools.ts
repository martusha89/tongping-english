import { isIP } from "node:net";
import type { HostedAiScope } from "./hosted-ai-config.js";

/**
 * Batch 1 tool catalog (Architecture packet section 8).
 *
 * All 13 tools use strict object schemas (additionalProperties:false). The
 * twelve browser action tools require an explicit opaque route handle. The
 * delegated AI credential never appears in a tool argument.
 */

export const HOSTED_TOOL_NAMES = [
  "browser_routes",
  "browser_open",
  "browser_read",
  "browser_snapshot",
  "browser_screenshot",
  "browser_click",
  "browser_type",
  "browser_press",
  "browser_scroll",
  "browser_wait",
  "browser_back",
  "browser_forward",
  "browser_reload",
  "browser_hover",
  "browser_double_click",
  "browser_select",
  "browser_set_files",
] as const;

export type HostedToolName = (typeof HOSTED_TOOL_NAMES)[number];

/** Every hosted tool except browser_routes is a route-bound Worker action. */
export const HOSTED_WORKER_ACTIONS: readonly HostedToolName[] = [
  "browser_open",
  "browser_read",
  "browser_snapshot",
  "browser_screenshot",
  "browser_click",
  "browser_type",
  "browser_press",
  "browser_scroll",
  "browser_wait",
  "browser_back",
  "browser_forward",
  "browser_reload",
  "browser_hover",
  "browser_double_click",
  "browser_select",
  "browser_set_files",
];

export const ROUTE_HANDLE_PATTERN = /^rt_[A-Za-z0-9_-]{22}$/;

export const PRESS_KEYS = [
  "Enter",
  "Escape",
  "Tab",
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
] as const;

export const HOSTED_TOOL_ERROR_CODES = [
  "INVALID_ARGUMENTS",
  "ROUTE_NOT_GRANTED",
  "ROUTE_OFFLINE",
  "ROUTE_BUSY",
  "PERMISSION_DENIED",
  "TIMEOUT",
  "CANCELLED",
  "OUTCOME_UNKNOWN",
  "WORKER_ERROR",
  "RESULT_TOO_LARGE",
  "UNAVAILABLE",
] as const;

export type HostedToolErrorCode = (typeof HOSTED_TOOL_ERROR_CODES)[number];

export interface JsonObjectSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
}

export interface HostedToolDefinition {
  readonly name: HostedToolName;
  /** null means "any valid grant" (browser_routes). */
  readonly permissionClass: HostedAiScope | null;
  readonly requiresRoute: boolean;
  readonly timeoutMs: number;
  readonly responseCapBytes: number;
  readonly screenshot: boolean;
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly openWorldHint: boolean;
  readonly description: string;
  readonly inputSchema: JsonObjectSchema;
  /** Validated, default-applied arguments without `route` (Worker args). */
  readonly validate: (
    raw: Record<string, unknown>,
  ) => ToolValidation;
}

export type ToolValidation =
  | { readonly ok: true; readonly args: Record<string, unknown> }
  | {
      readonly ok: false;
      readonly code: "INVALID_ARGUMENTS";
      readonly message: string;
    };

const SELECTOR_MAX = 512;
const SELECTOR_DEFAULT = "body";
const URL_MAX = 2_048;
const CONTROL = /[\u0000-\u001f\u007f]/;
const CHAT_SELECTOR_PREFIX = "__tongping_chat_push__::";
export const UPLOAD_MAX_FILES = 4;
export const UPLOAD_MAX_BYTES = 4_000_000;
export const UPLOAD_NAME = /^[a-zA-Z0-9._ -]{1,120}$/;

function invalid(message: string): ToolValidation {
  return { ok: false, code: "INVALID_ARGUMENTS", message };
}

function selectorArg(raw: Record<string, unknown>): ToolValidation {
  const value = raw.selector === undefined ? SELECTOR_DEFAULT : raw.selector;
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > SELECTOR_MAX ||
    CONTROL.test(value) ||
    value.startsWith(CHAT_SELECTOR_PREFIX)
  ) {
    return invalid("selector is invalid");
  }
  return { ok: true, args: { selector: value } };
}

function boundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number | string {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    return `${label} must be an integer between ${min} and ${max}`;
  }
  return value;
}

function routeProperty(): unknown {
  return {
    type: "string",
    pattern: "^rt_[A-Za-z0-9_-]{22}$",
    description: "Opaque route handle from browser_routes.",
  };
}

function actionSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
): JsonObjectSchema {
  return {
    type: "object",
    properties: { route: routeProperty(), ...properties },
    required: ["route", ...required],
    additionalProperties: false,
  };
}

function define(
  name: HostedToolName,
  permissionClass: HostedAiScope | null,
  timeoutMs: number,
  responseCapBytes: number,
  description: string,
  inputSchema: JsonObjectSchema,
  validate: HostedToolDefinition["validate"],
  options: { screenshot?: boolean } = {},
): HostedToolDefinition {
  const readOnly = permissionClass === "browser.read" || permissionClass === null;
  const wrapped: HostedToolDefinition["validate"] = (raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return invalid("arguments must be an object");
    }
    const allowed = new Set(Object.keys(inputSchema.properties));
    for (const key of Object.keys(raw)) {
      if (!allowed.has(key)) return invalid(`unknown argument: ${key}`);
    }
    return validate(raw);
  };
  return Object.freeze({
    name,
    permissionClass,
    requiresRoute: permissionClass !== null,
    timeoutMs,
    responseCapBytes,
    screenshot: options.screenshot ?? false,
    readOnlyHint: readOnly,
    destructiveHint: !readOnly,
    openWorldHint: !readOnly,
    description,
    inputSchema,
    validate: wrapped,
  });
}

export const HOSTED_TOOLS: Readonly<Record<HostedToolName, HostedToolDefinition>> = Object.freeze({
  browser_routes: define(
    "browser_routes",
    null,
    3_000,
    16 * 1024,
    "List only the browser routes granted to this connector.",
    { type: "object", properties: {}, required: [], additionalProperties: false },
    (raw) =>
      Object.keys(raw).length === 0
        ? { ok: true, args: {} }
        : invalid("browser_routes takes no arguments"),
  ),
  browser_open: define(
    "browser_open",
    "browser.navigate",
    45_000,
    16 * 1024,
    "Open an absolute http(s) URL in the granted profile.",
    actionSchema(
      {
        url: {
          type: "string",
          minLength: 1,
          maxLength: URL_MAX,
          description: "Absolute http(s) URL without credentials.",
        },
      },
      ["url"],
    ),
    (raw) => {
      const url = raw.url;
      if (typeof url !== "string" || url.length < 1 || url.length > URL_MAX) {
        return invalid("url must be a string of at most 2048 characters");
      }
      if (CONTROL.test(url) || isBlockedNavigationTarget(url)) {
        return invalid("url targets a blocked address");
      }
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return invalid("url must be absolute");
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return invalid("url must use http or https");
      }
      return { ok: true, args: { url } };
    },
  ),
  browser_read: define(
    "browser_read",
    "browser.read",
    20_000,
    256 * 1024,
    "Read visible text or HTML from the granted profile.",
    actionSchema(
      {
        selector: { type: "string", minLength: 1, maxLength: SELECTOR_MAX },
        maxChars: { type: "integer", minimum: 1_000, maximum: 50_000 },
        format: { type: "string", enum: ["text", "html"] },
      },
      [],
    ),
    (raw) => {
      const selector = selectorArg(raw);
      if (!selector.ok) return selector;
      const maxChars = boundedInteger(raw.maxChars, 20_000, 1_000, 50_000, "maxChars");
      if (typeof maxChars === "string") return invalid(maxChars);
      const format = raw.format === undefined ? "text" : raw.format;
      if (format !== "text" && format !== "html") {
        return invalid("format must be text or html");
      }
      return { ok: true, args: { ...selector.args, maxChars, format } };
    },
  ),
  browser_snapshot: define(
    "browser_snapshot",
    "browser.read",
    20_000,
    256 * 1024,
    "Capture a semantic snapshot with temporary refs.",
    actionSchema(
      {
        selector: { type: "string", minLength: 1, maxLength: SELECTOR_MAX },
        maxElements: { type: "integer", minimum: 1, maximum: 250 },
        offset: { type: "integer", minimum: 0, maximum: 10_000 },
        includeImages: { type: "boolean" },
      },
      [],
    ),
    (raw) => {
      const selector = selectorArg(raw);
      if (!selector.ok) return selector;
      const maxElements = boundedInteger(raw.maxElements, 100, 1, 250, "maxElements");
      if (typeof maxElements === "string") return invalid(maxElements);
      const offset = boundedInteger(raw.offset, 0, 0, 10_000, "offset");
      if (typeof offset === "string") return invalid(offset);
      const includeImages = raw.includeImages === undefined ? false : raw.includeImages;
      if (typeof includeImages !== "boolean") {
        return invalid("includeImages must be a boolean");
      }
      return {
        ok: true,
        args: { ...selector.args, maxElements, offset, includeImages },
      };
    },
  ),
  browser_screenshot: define(
    "browser_screenshot",
    "browser.read",
    45_000,
    2_306_867,
    "Capture a screenshot of the computer's browser right now (ahead of a delayed Watch Together view). The picture comes back as an image item after the JSON text (in ChatGPT: content_items, the item with type image); look at that image itself before you answer, do not stop at the text.",
    actionSchema({
      fullPage: { type: "boolean", enum: [false] },
    }),
    (raw) => {
      if (raw.fullPage !== undefined && raw.fullPage !== false) {
        return invalid("fullPage must be false or omitted in Batch 1");
      }
      return { ok: true, args: {} };
    },
    { screenshot: true },
  ),
  browser_click: define(
    "browser_click",
    "browser.interact",
    30_000,
    32 * 1024,
    "Click a semantic ref or viewport coordinate.",
    actionSchema(
      {
        ref: { type: "string", minLength: 1, maxLength: 128 },
        x: { type: "number", minimum: 0, maximum: 100_000 },
        y: { type: "number", minimum: 0, maximum: 100_000 },
      },
      [],
    ),
    (raw) => {
      const hasRef = raw.ref !== undefined;
      const hasX = raw.x !== undefined;
      const hasY = raw.y !== undefined;
      if (raw.approvalId !== undefined) return invalid("approvalId is not supported");
      if (hasRef && (hasX || hasY)) {
        return invalid("provide ref or x/y, not both");
      }
      if (hasRef) {
        if (typeof raw.ref !== "string" || raw.ref.length < 1 || raw.ref.length > 128) {
          return invalid("ref is invalid");
        }
        return { ok: true, args: { ref: raw.ref } };
      }
      if (!hasX || !hasY) return invalid("provide ref or both x and y");
      if (!isFiniteCoordinate(raw.x) || !isFiniteCoordinate(raw.y)) {
        return invalid("x and y must be finite numbers between 0 and 100000");
      }
      return { ok: true, args: { x: raw.x, y: raw.y } };
    },
  ),
  browser_type: define(
    "browser_type",
    "browser.interact",
    30_000,
    4 * 1024,
    "Type text into a semantic ref.",
    actionSchema(
      {
        ref: { type: "string", minLength: 1, maxLength: 128 },
        text: { type: "string", maxLength: 4_096 },
        append: { type: "boolean" },
      },
      ["ref", "text"],
    ),
    (raw) => {
      if (typeof raw.ref !== "string" || raw.ref.length < 1 || raw.ref.length > 128) {
        return invalid("ref is invalid");
      }
      if (typeof raw.text !== "string") return invalid("text is required");
      if (raw.text.includes("\u0000")) return invalid("text must not contain NUL");
      if (Buffer.byteLength(raw.text, "utf8") > 4_096) {
        return invalid("text exceeds 4096 UTF-8 bytes");
      }
      const append = raw.append === undefined ? false : raw.append;
      if (typeof append !== "boolean") return invalid("append must be a boolean");
      return { ok: true, args: { ref: raw.ref, text: raw.text, append } };
    },
  ),
  browser_press: define(
    "browser_press",
    "browser.interact",
    20_000,
    4 * 1024,
    "Press a safe key on a semantic ref.",
    actionSchema(
      {
        ref: { type: "string", minLength: 1, maxLength: 128 },
        key: { type: "string", enum: [...PRESS_KEYS] },
      },
      ["ref", "key"],
    ),
    (raw) => {
      if (typeof raw.ref !== "string" || raw.ref.length < 1 || raw.ref.length > 128) {
        return invalid("ref is invalid");
      }
      if (typeof raw.key !== "string" || !(PRESS_KEYS as readonly string[]).includes(raw.key)) {
        return invalid("key is not allowed");
      }
      return { ok: true, args: { ref: raw.ref, key: raw.key } };
    },
  ),
  browser_scroll: define(
    "browser_scroll",
    "browser.interact",
    15_000,
    8 * 1024,
    "Scroll the page by a relative delta.",
    actionSchema({
      deltaY: { type: "integer", minimum: -10_000, maximum: 10_000 },
    }),
    (raw) => {
      const deltaY = boundedInteger(raw.deltaY, 800, -10_000, 10_000, "deltaY");
      if (typeof deltaY === "string") return invalid(deltaY);
      return { ok: true, args: { deltaY } };
    },
  ),
  browser_wait: define(
    "browser_wait",
    "browser.read",
    15_000,
    2 * 1024,
    "Wait for a bounded number of milliseconds.",
    actionSchema({
      ms: { type: "integer", minimum: 0, maximum: 10_000 },
    }),
    (raw) => {
      const ms = boundedInteger(raw.ms, 1_000, 0, 10_000, "ms");
      if (typeof ms === "string") return invalid(ms);
      return { ok: true, args: { ms } };
    },
  ),
  browser_back: define(
    "browser_back",
    "browser.navigate",
    20_000,
    8 * 1024,
    "Go back in the granted profile history.",
    actionSchema({}),
    () => ({ ok: true, args: {} }),
  ),
  browser_forward: define(
    "browser_forward",
    "browser.navigate",
    20_000,
    8 * 1024,
    "Go forward in the granted profile history.",
    actionSchema({}),
    () => ({ ok: true, args: {} }),
  ),
  browser_reload: define(
    "browser_reload",
    "browser.navigate",
    20_000,
    8 * 1024,
    "Reload the current page in the granted profile.",
    actionSchema({}),
    () => ({ ok: true, args: {} }),
  ),
  browser_hover: define(
    "browser_hover",
    "browser.interact",
    30_000,
    32 * 1024,
    "Hover a semantic ref or viewport coordinate (reveals menus and tooltips).",
    actionSchema(
      {
        ref: { type: "string", minLength: 1, maxLength: 128 },
        x: { type: "number", minimum: 0, maximum: 100_000 },
        y: { type: "number", minimum: 0, maximum: 100_000 },
      },
      [],
    ),
    (raw) => {
      const hasRef = raw.ref !== undefined;
      const hasX = raw.x !== undefined;
      const hasY = raw.y !== undefined;
      if (hasRef && (hasX || hasY)) return invalid("provide ref or x/y, not both");
      if (hasRef) {
        if (!isRef(raw.ref)) return invalid("ref is invalid");
        return { ok: true, args: { ref: raw.ref } };
      }
      if (!hasX || !hasY) return invalid("provide ref or both x and y");
      if (!isFiniteCoordinate(raw.x) || !isFiniteCoordinate(raw.y)) {
        return invalid("x and y must be finite numbers between 0 and 100000");
      }
      return { ok: true, args: { x: raw.x, y: raw.y } };
    },
  ),
  browser_double_click: define(
    "browser_double_click",
    "browser.interact",
    30_000,
    32 * 1024,
    "Double-click a semantic ref.",
    actionSchema({ ref: { type: "string", minLength: 1, maxLength: 128 } }, ["ref"]),
    (raw) => (isRef(raw.ref) ? { ok: true, args: { ref: raw.ref } } : invalid("ref is invalid")),
  ),
  browser_select: define(
    "browser_select",
    "browser.interact",
    30_000,
    8 * 1024,
    "Choose an option (by value or label) in a <select> ref.",
    actionSchema(
      {
        ref: { type: "string", minLength: 1, maxLength: 128 },
        value: { type: "string", minLength: 1, maxLength: 512 },
      },
      ["ref", "value"],
    ),
    (raw) => {
      if (!isRef(raw.ref)) return invalid("ref is invalid");
      if (
        typeof raw.value !== "string" ||
        raw.value.length < 1 ||
        raw.value.length > 512 ||
        CONTROL.test(raw.value)
      ) {
        return invalid("value is invalid");
      }
      return { ok: true, args: { ref: raw.ref, value: raw.value } };
    },
  ),
  browser_set_files: define(
    "browser_set_files",
    "browser.interact",
    60_000,
    8 * 1024,
    "Put files into a file-input ref by URL: the device downloads each http(s) URL (max 4 MB each, 4 files) and attaches it, as if the user picked it.",
    actionSchema(
      {
        ref: { type: "string", minLength: 1, maxLength: 128 },
        files: {
          type: "array",
          minItems: 1,
          maxItems: UPLOAD_MAX_FILES,
          items: {
            type: "object",
            properties: {
              url: { type: "string", minLength: 1, maxLength: URL_MAX },
              name: { type: "string", minLength: 1, maxLength: 120 },
            },
            required: ["url"],
            additionalProperties: false,
          },
        },
      },
      ["ref", "files"],
    ),
    (raw) => {
      if (!isRef(raw.ref)) return invalid("ref is invalid");
      if (!Array.isArray(raw.files) || raw.files.length < 1 || raw.files.length > UPLOAD_MAX_FILES) {
        return invalid(`files must list 1-${UPLOAD_MAX_FILES} files`);
      }
      const files: Array<{ url: string; name?: string }> = [];
      for (const item of raw.files) {
        if (!item || typeof item !== "object" || Array.isArray(item)) return invalid("each file must be an object");
        const record = item as Record<string, unknown>;
        for (const key of Object.keys(record)) {
          if (key !== "url" && key !== "name") return invalid(`unknown file field: ${key}`);
        }
        if (!isUploadUrl(record.url)) return invalid("file url must be a public http(s) URL");
        if (record.name !== undefined && (typeof record.name !== "string" || !UPLOAD_NAME.test(record.name))) {
          return invalid("file name is invalid");
        }
        files.push({ url: record.url, ...(record.name !== undefined ? { name: record.name as string } : {}) });
      }
      return { ok: true, args: { ref: raw.ref, files } };
    },
  ),
});

/** A public http(s) URL the device may download for browser_set_files. */
export function isUploadUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > URL_MAX || CONTROL.test(value)) return false;
  if (isBlockedNavigationTarget(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isRef(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 128;
}

export function isHostedToolName(value: unknown): value is HostedToolName {
  return typeof value === "string" && (HOSTED_TOOL_NAMES as readonly string[]).includes(value);
}

export function isHostedWorkerAction(value: unknown): value is HostedToolName {
  return typeof value === "string" && (HOSTED_WORKER_ACTIONS as readonly string[]).includes(value);
}

export type ToolResultValidation =
  | { readonly ok: true; readonly bytes: Buffer }
  | {
      readonly ok: false;
      readonly code: "RESULT_TOO_LARGE" | "INVALID_RESULT";
    };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringValue(value: unknown): value is string {
  return typeof value === "string";
}

function isBoolValue(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isFiniteNumberValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isViewport(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    isFiniteNumberValue(value.width) &&
    isFiniteNumberValue(value.height) &&
    value.width > 0 &&
    value.height > 0
  );
}

function hasStrings(result: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => isStringValue(result[key]));
}

/**
 * Frozen per-tool success-result validators (Architecture section 8). Each
 * returns true only when the shape the Worker actually produces for that tool
 * is present; arbitrary bounded JSON is rejected.
 */
const RESULT_VALIDATORS: Readonly<Record<HostedToolName, (result: Record<string, unknown>) => boolean>> =
  Object.freeze({
    browser_routes: (r) =>
      Array.isArray(r.routes) &&
      r.routes.every(
        (route) =>
          isPlainObject(route) &&
          hasStrings(route, ["route", "device_label", "profile_alias"]) &&
          isBoolValue(route.online) &&
          isStringArray(route.permissions),
      ),
    browser_open: (r) =>
      hasStrings(r, ["profile", "title", "url"]) &&
      isViewport(r.viewport) &&
      (r.siteRisk === undefined || isPlainObject(r.siteRisk)),
    browser_read: (r) => {
      if (!hasStrings(r, ["title", "url"]) || !isBoolValue(r.truncated)) return false;
      if (r.format === "text") return isStringValue(r.text);
      if (r.format === "html") return isStringValue(r.html);
      return false;
    },
    browser_snapshot: (r) =>
      hasStrings(r, ["title", "url", "selector"]) &&
      isFiniteNumberValue(r.offset) &&
      (r.nextOffset === null || isFiniteNumberValue(r.nextOffset)) &&
      isBoolValue(r.hasMore) &&
      Array.isArray(r.elements),
    browser_screenshot: (r) => isPngResult(r),
    browser_click: (r) =>
      hasStrings(r, ["url", "title"]) &&
      (isStringValue(r.clicked) ||
        (isPlainObject(r.clicked) &&
          isFiniteNumberValue(r.clicked.x) &&
          isFiniteNumberValue(r.clicked.y))) &&
      isPlainObject(r.target) &&
      isPlainObject(r.risk),
    browser_type: (r) =>
      isStringValue(r.typed) &&
      isFiniteNumberValue(r.chars) &&
      isBoolValue(r.append),
    browser_press: (r) => isStringValue(r.pressed) && isStringValue(r.key),
    browser_scroll: (r) =>
      (r.mode === "element" || r.mode === "window") &&
      isFiniteNumberValue(r.deltaY) &&
      isFiniteNumberValue(r.windowScrollY),
    browser_wait: (r) =>
      isFiniteNumberValue(r.waitedMs) && isStringValue(r.url),
    browser_back: (r) =>
      hasStrings(r, ["profile", "title", "url"]) &&
      r.direction === "back" &&
      isBoolValue(r.changed),
    browser_forward: (r) =>
      hasStrings(r, ["profile", "title", "url"]) &&
      r.direction === "forward" &&
      isBoolValue(r.changed),
    browser_reload: (r) =>
      hasStrings(r, ["profile", "title", "url"]) && isBoolValue(r.reloaded),
    browser_hover: (r) =>
      isStringValue(r.url) &&
      (isStringValue(r.hovered) ||
        (isPlainObject(r.hovered) &&
          isFiniteNumberValue(r.hovered.x) &&
          isFiniteNumberValue(r.hovered.y))) &&
      (r.target === null || isPlainObject(r.target)),
    browser_double_click: (r) =>
      isStringValue(r.doubleClicked) && isStringValue(r.url) && isPlainObject(r.target),
    browser_select: (r) => isStringValue(r.ref) && isStringArray(r.selected),
    browser_set_files: (r) =>
      isStringValue(r.ref) && isFiniteNumberValue(r.count) && isStringArray(r.names) && isFiniteNumberValue(r.totalBytes),
  });

/**
 * Validate and serialize a tool success result within its per-tool cap. The
 * result must match the exact frozen shape for that tool; screenshots must be a
 * validated PNG within 1.5 MiB raw.
 */
export function validateToolResult(
  tool: HostedToolDefinition,
  result: unknown,
): ToolResultValidation {
  if (!isPlainObject(result)) return { ok: false, code: "INVALID_RESULT" };
  let bytes: Buffer;
  try {
    bytes = Buffer.from(JSON.stringify(result), "utf8");
  } catch {
    return { ok: false, code: "INVALID_RESULT" };
  }
  const cap = tool.screenshot ? 2_306_867 : tool.responseCapBytes;
  if (bytes.length > cap) return { ok: false, code: "RESULT_TOO_LARGE" };
  const validate = RESULT_VALIDATORS[tool.name];
  if (!validate(result)) return { ok: false, code: "INVALID_RESULT" };
  return { ok: true, bytes };
}

/**
 * Validate the Worker failure envelope separately from success results. A
 * legitimate `ok:false` reply carries at most a 500-character message and must
 * never be required to carry a tool result (e.g. a screenshot PNG).
 */
export function validateWorkerFailure(reply: unknown): boolean {
  if (!isPlainObject(reply) || reply.ok !== false) return false;
  if (reply.error === undefined) return true;
  return typeof reply.error === "string" && reply.error.length <= 500;
}

function isPngResult(result: Record<string, unknown>): boolean {
  const base64 = result.base64;
  if (typeof base64 !== "string" || base64.length === 0) return false;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    return false;
  }
  // A headed browser has no fixed viewport, so Playwright reports null.
  if (result.viewport !== undefined && result.viewport !== null && !isViewport(result.viewport)) return false;
  return isPng(bytes) || isJpeg(bytes);
}

/** A JPEG screenshot (newer Workers send JPEG: a fraction of the PNG size). */
export function isJpeg(bytes: Buffer): boolean {
  return (
    bytes.length >= 4 &&
    bytes.length <= 1_572_864 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  );
}

export function isPng(bytes: Buffer): boolean {
  if (bytes.length < 33 || bytes.length > 1_572_864) return false;
  return (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.readUInt32BE(8) === 13 &&
    bytes.toString("ascii", 12, 16) === "IHDR" &&
    bytes.readUInt32BE(16) > 0 &&
    bytes.readUInt32BE(20) > 0 &&
    bytes.toString("ascii", bytes.length - 8, bytes.length - 4) === "IEND"
  );
}

function isFiniteCoordinate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100_000
  );
}

/**
 * D5: block literal loopback, private, link-local and metadata targets plus
 * `localhost`, `*.local` and `*.internal`. DNS-resolved private targets cannot
 * be blocked cloud-side without a Worker change; that residual is documented.
 */
export function isBlockedNavigationTarget(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return true;
  }
  if (url.username !== "" || url.password !== "") return true;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  const bare =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const family = isIP(bare);
  if (family === 4) return isPrivateIpv4(bare);
  if (family === 6) return isPrivateIpv6(bare);
  return false;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [a = 0, b = 0] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && (b === 0 || b === 168)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(address: string): boolean {
  // isIP already validated the literal. Expand compressed words rather than
  // relying on text prefixes: URL canonicalization rewrites mapped IPv4.
  const halves = address.toLowerCase().split("::");
  const left = halves[0] ? halves[0].split(":").map((word) => parseInt(word, 16)) : [];
  const right = halves[1] ? halves[1].split(":").map((word) => parseInt(word, 16)) : [];
  const words = halves.length === 2
    ? [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right]
    : left;
  if (words.length !== 8) return true;
  const first = words[0]!;
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return true; // deprecated site-local
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7
  if (words.slice(0, 5).every((word) => word === 0) &&
      (words[5] === 0 || words[5] === 0xffff)) {
    // IPv4-compatible and IPv4-mapped literals use the same IPv4 policy.
    const high = words[6]!;
    const low = words[7]!;
    return isPrivateIpv4(`${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`);
  }
  return false;
}
