import crypto from "node:crypto";
import type { BrowserAction, BrowserReply } from "./browser-service.js";
import type { BrowserGateway, HumanBrowserAction } from "./gateway.js";

export type WorkerCommand = {
  id: string;
  op: "call" | "human";
  action: string;
  args: Record<string, unknown>;
  client: string;
};

type PendingWaiter = { command: WorkerCommand; delivered: boolean };
type Inflight = {
  resolve: (reply: BrowserReply) => void;
  timer: NodeJS.Timeout;
};

export type TrustedRelayFailure = BrowserReply & {
  ok: false;
  code: "cancelled" | "timeout" | "outcome_unknown";
};

export class RemoteWorkerRelay implements BrowserGateway {
  private readonly pending: PendingWaiter[] = [];
  private readonly inflight = new Map<string, Inflight>();
  private pollWake?: () => void;
  private lastWorkerSeenAt = 0;

  private retired = false;

  constructor(private readonly timeoutMs = 35_000, private readonly trustedGeneration = false) {}

  workerStatus() {
    const ageMs = this.lastWorkerSeenAt ? Date.now() - this.lastWorkerSeenAt : null;
    return {
      connected: ageMs !== null && ageMs < 45_000,
      lastSeenAt: this.lastWorkerSeenAt
        ? new Date(this.lastWorkerSeenAt).toISOString()
        : null,
      ageMs,
      pending: this.pending.length,
      inflight: this.inflight.size,
      queue: this.pending.slice(0, 12).map((item) => ({
        op: item.command.op,
        action: item.command.action,
        delivered: item.delivered,
        client: item.command.client,
      })),
    };
  }

  async call(
    action: BrowserAction,
    args: Record<string, unknown>,
    clientOverride?: string,
  ): Promise<BrowserReply> {
    return this.enqueue("call", action, args, clientOverride?.trim() || "streamable-http");
  }

  async human(
    action: HumanBrowserAction,
    args: Record<string, unknown>,
    clientOverride?: string,
  ): Promise<BrowserReply> {
    return this.enqueue("human", action, args, clientOverride?.trim() || "human-mobile");
  }

  async nextCommand(waitMs = 20_000): Promise<WorkerCommand | null> {
    if (this.retired) return null;
    this.lastWorkerSeenAt = Date.now();
    const immediate = this.pending.find((item) => !item.delivered);
    if (immediate) {
      immediate.delivered = true;
      return immediate.command;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (this.pollWake === finish) this.pollWake = undefined;
        resolve();
      };
      this.pollWake = finish;
      const timer = setTimeout(finish, waitMs);
      timer.unref?.();
    });

    this.lastWorkerSeenAt = Date.now();
    if (this.retired) return null;
    const next = this.pending.find((item) => !item.delivered);
    if (!next) return null;
    next.delivered = true;
    return next.command;
  }

  complete(id: string, reply: BrowserReply): boolean {
    if (this.retired) return false;
    this.lastWorkerSeenAt = Date.now();
    const item = this.inflight.get(id);
    if (!item) return false;
    this.inflight.delete(id);
    clearTimeout(item.timer);
    const index = this.pending.findIndex((entry) => entry.command.id === id);
    if (index >= 0) this.pending.splice(index, 1);
    item.resolve(reply);
    return true;
  }

  /** Retirement is terminal: pending work is cancelled and delivered work is never replayed. */
  retire(): void {
    if (this.retired) return;
    this.retired = true;
    for (const entry of this.pending) {
      const inflight = this.inflight.get(entry.command.id);
      if (!inflight) continue;
      clearTimeout(inflight.timer);
      inflight.resolve(entry.delivered
        ? { ok: false, code: "outcome_unknown", error: "outcome_unknown" } satisfies TrustedRelayFailure
        : { ok: false, code: "cancelled", error: "cancelled" } satisfies TrustedRelayFailure);
    }
    this.pending.length = 0;
    this.inflight.clear();
    this.pollWake?.();
  }

  private enqueue(
    op: WorkerCommand["op"],
    action: string,
    args: Record<string, unknown>,
    client: string,
  ): Promise<BrowserReply> {
    if (this.retired) return Promise.resolve({ ok: false, code: "cancelled", error: "cancelled" } satisfies TrustedRelayFailure);
    const id = crypto.randomBytes(12).toString("base64url");
    const command: WorkerCommand = { id, op, action, args, client };

    return new Promise<BrowserReply>((resolve) => {
      const actionTimeoutMs =
        action === "browser_screenshot" || action === "human_preview"
          ? Math.max(this.timeoutMs, 90_000)
          : action === "human_media_restart"
            ? Math.max(this.timeoutMs, 60_000)
            : action === "human_live_start" || action === "human_live_stop"
              ? Math.min(this.timeoutMs, 12_000)
              : this.timeoutMs;
      const timer = setTimeout(() => {
        this.inflight.delete(id);
        const index = this.pending.findIndex((entry) => entry.command.id === id);
        const delivered = this.pending[index]?.delivered === true;
        if (index >= 0) this.pending.splice(index, 1);
        resolve(this.trustedGeneration
          ? delivered
            ? { ok: false, code: "outcome_unknown", error: "outcome_unknown" } satisfies TrustedRelayFailure
            : { ok: false, code: "timeout", error: "timeout" } satisfies TrustedRelayFailure
          : { ok: false, error: "TongPing local worker did not answer in time." });
      }, actionTimeoutMs);
      timer.unref?.();

      this.inflight.set(id, { resolve, timer });
      this.pending.push({ command, delivered: false });
      this.pollWake?.();
    });
  }
}
