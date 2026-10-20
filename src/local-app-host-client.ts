import {
  AppBridge,
  PostMessageTransport,
  type McpUiDisplayMode,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/client";

type LocalConfig = {
  csrf: string;
  identity: string;
  profile: string;
};

type Bootstrap = {
  initialResult: CallToolResult;
};

const configNode = document.getElementById("tongping-local-config");
const iframe = document.getElementById("card") as HTMLIFrameElement | null;
const statusNode = document.getElementById("status");
const fatal = document.getElementById("fatal");
const fatalText = document.getElementById("fatalText");

if (!configNode?.textContent || !iframe || !statusNode || !fatal || !fatalText) {
  throw new Error("TongPing local host markup is incomplete");
}

const cardFrame = iframe;
const config = JSON.parse(configNode.textContent) as LocalConfig;
let currentMode: McpUiDisplayMode = "fullscreen";

function setStatus(text: string): void {
  statusNode!.textContent = text;
}

function fail(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  fatalText!.textContent = message || "Ask Hearthside to open the TongPing room again.";
  fatal!.classList.add("on");
  setStatus("Room unavailable");
}

async function localApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("x-tongping-csrf", config.csrf);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      value && typeof value.error === "string"
        ? value.error
        : `Local TongPing request failed (${response.status})`;
    throw new Error(detail);
  }
  return value as T;
}

function messageText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (item): item is { type: "text"; text: string } =>
        Boolean(
          item &&
            typeof item === "object" &&
            (item as { type?: unknown }).type === "text" &&
            typeof (item as { text?: unknown }).text === "string",
        ),
    )
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function applyMode(mode: McpUiDisplayMode): McpUiDisplayMode {
  currentMode = mode === "inline" ? "inline" : "fullscreen";
  document.body.dataset.mode = currentMode;
  return currentMode;
}

async function openRoom(): Promise<void> {
  setStatus("Authorising local room…");
  const bootstrap = await localApi<Bootstrap>("/v1/local-app/bootstrap", {
    method: "POST",
    body: "{}",
  });

  const bridge = new AppBridge(
    null,
    { name: "tongping-local-host", version: "1.0.0" },
    {
      openLinks: {},
      serverTools: {},
      updateModelContext: { text: {}, structuredContent: {} },
      message: { text: {} },
      sandbox: {
        permissions: { camera: {}, microphone: {}, clipboardWrite: {} },
      },
    },
    {
      hostContext: {
        theme: "dark",
        displayMode: currentMode,
        availableDisplayModes: ["inline", "fullscreen"],
      },
    },
  );

  bridge.oncalltool = async ({ name, arguments: args }) =>
    localApi<CallToolResult>("/v1/local-app/tool", {
      method: "POST",
      body: JSON.stringify({ name, arguments: args ?? {} }),
    });

  bridge.onupdatemodelcontext = async () => ({});

  bridge.onmessage = async ({ role, content }) => {
    if (role !== "user") return { isError: true };
    const text = messageText(content);
    if (!text) return { isError: true };
    try {
      await localApi<{ ok: true }>("/v1/local-app/message", {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      return {};
    } catch {
      return { isError: true };
    }
  };

  bridge.onopenlink = async ({ url }) => {
    try {
      const parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) return { isError: true };
      const opened = window.open(parsed.toString(), "_blank", "noopener,noreferrer");
      return opened ? {} : { isError: true };
    } catch {
      return { isError: true };
    }
  };

  bridge.onrequestdisplaymode = async ({ mode }) => {
    const applied = applyMode(mode);
    bridge.setHostContext({
      theme: "dark",
      displayMode: applied,
      availableDisplayModes: ["inline", "fullscreen"],
    });
    return { mode: applied };
  };

  bridge.oninitialized = () => {
    void (async () => {
      await bridge.sendToolInput({
        arguments: {
          identity: config.identity,
          profile: config.profile,
        },
      });
      await bridge.sendToolResult(bootstrap.initialResult);
      setStatus("Cass · connected");
    })().catch(fail);
  };

  applyMode("fullscreen");
  const transport = new PostMessageTransport(
    cardFrame.contentWindow!,
    cardFrame.contentWindow!,
  );
  await bridge.connect(transport);
  window.addEventListener("pagehide", () => {
    void bridge.close().catch(() => {});
  }, { once: true });
  cardFrame.src = "/v1/local-app/card";
}

void openRoom().catch(fail);
