/**
 * LogixTcpClient — the BACKEND-ONLY TCP transport that drives the sans-I/O
 * `LogixSessionCore` from `@esco/driver-ethernetip` over `node:net`.
 *
 * BOUNDARIES — read before extending.
 *
 * - BACKEND ONLY: this package imports `node:net` and must never be bundled
 *   into the browser app. The UI reaches controllers only through the ESCO
 *   gateway/session layers, never through this class directly.
 * - READ-ONLY: the public surface delegates to the session core's read-only
 *   operations (identity, tag browse, tag read). There is no write path.
 * - NO VERIFICATION CLAIM: opening a TCP connection proves nothing about
 *   hardware validation. Nothing here flips `verified: true` in
 *   `@esco/controller-comm` — that requires real, signed hardware evidence.
 * - ESCO-OWNED: protocol behavior lives in `@esco/driver-ethernetip`, written
 *   from public ODVA specs. No Rockwell software or services are involved.
 */

import { createConnection, type Socket } from "node:net";
import {
  ENIP_DEFAULT_PORT,
  LogixSessionCore,
  type BatchReadOutcome,
  type CipIdentity,
  type ConnectedModeOptions,
  type ForwardOpenReply,
  type ListIdentityInfo,
  type LogixRequestOptions,
  type LogixTemplate,
  type ReadTagResult,
  type RegisterSessionReply,
  type SessionState,
  type SymbolInstance,
} from "@esco/driver-ethernetip";

export interface LogixTcpClientOptions {
  /** Controller / EtherNet/IP module host (IP or DNS name). */
  host: string;
  /** TCP port; defaults to the registered EtherNet/IP port 44818. */
  port?: number;
  /** Milliseconds to wait for the TCP connection; default 5000. */
  connectTimeoutMs?: number;
  /**
   * Inactivity watchdog while requests are pending: if no bytes arrive for
   * this long with work in flight, the session fails and the socket is
   * destroyed. Default 5000.
   */
  requestTimeoutMs?: number;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

export class LogixTcpClient {
  private readonly session: LogixSessionCore;
  private socket: Socket | undefined;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private readonly host: string;
  private readonly port: number;
  private readonly connectTimeoutMs: number;
  private readonly requestTimeoutMs: number;

  constructor(options: LogixTcpClientOptions) {
    this.host = options.host;
    this.port = options.port ?? ENIP_DEFAULT_PORT;
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    // Frames are flushed the instant the core emits them — continuation
    // frames surface from promise microtasks, so polling after receive()
    // would race; the hook cannot.
    this.session = new LogixSessionCore({ onOutbound: () => this.flushOutbound() });
  }

  get state(): SessionState {
    return this.session.state;
  }

  get sessionHandle(): number | undefined {
    return this.session.sessionHandle;
  }

  get isConnectedMode(): boolean {
    return this.session.isConnectedMode;
  }

  /** Opens a connected (class-3) channel via Forward Open (read-only traffic). */
  openConnected(options: ConnectedModeOptions): Promise<ForwardOpenReply> {
    return this.tracked(this.session.openConnected(options));
  }

  /** Closes the connected channel (Forward Close); reverts to UCMM routing. */
  closeConnected(): Promise<void> {
    return this.tracked(this.session.closeConnected());
  }

  /** Opens the TCP connection and registers the EtherNet/IP session. */
  async connect(): Promise<RegisterSessionReply> {
    if (this.socket) {
      throw new Error("connect() called twice — create a new client per connection");
    }
    this.socket = await this.dialSocket();
    this.socket.on("data", (chunk: Uint8Array) => {
      this.session.receive(chunk);
      this.armWatchdog();
    });
    this.socket.on("error", (error: Error) => this.teardown(error));
    this.socket.on("close", () => {
      if (this.session.state !== "closed" && this.session.state !== "failed") {
        this.teardown(new Error("connection closed by peer"));
      }
    });
    return this.tracked(this.session.open());
  }

  /**
   * Sends UnregisterSession and closes the socket. Safe to call at any time.
   */
  close(): void {
    this.clearWatchdog();
    // Order matters: close the session FIRST so the UnregisterSession frame
    // flushes through the still-attached socket, then end gracefully —
    // destroying immediately could discard the buffered frame.
    this.session.close();
    const socket = this.socket;
    this.socket = undefined;
    if (socket && !socket.destroyed) {
      socket.end();
      const fallback = setTimeout(() => socket.destroy(), 1000);
      unrefTimer(fallback);
      socket.once("close", () => clearTimeout(fallback));
    }
  }

  // ── read-only operations (delegate to the session core) ──────────────────

  listIdentity(): Promise<ListIdentityInfo> {
    return this.tracked(this.session.listIdentity());
  }

  readIdentityObject(options?: LogixRequestOptions): Promise<CipIdentity> {
    return this.tracked(this.session.readIdentityObject(options));
  }

  readTag(
    tagAddress: string,
    elementCount = 1,
    options?: LogixRequestOptions,
  ): Promise<ReadTagResult> {
    return this.tracked(this.session.readTag(tagAddress, elementCount, options));
  }

  readTagsBatch(
    tagAddresses: readonly string[],
    options?: LogixRequestOptions & { chunkSize?: number },
  ): Promise<BatchReadOutcome> {
    return this.tracked(this.session.readTagsBatch(tagAddresses, options));
  }

  readTemplate(templateInstance: number, options?: LogixRequestOptions): Promise<LogixTemplate> {
    return this.tracked(this.session.readTemplate(templateInstance, options));
  }

  listTags(
    scope?: { programName?: string },
    options?: LogixRequestOptions,
  ): Promise<SymbolInstance[]> {
    return this.tracked(this.session.listTags(scope, options));
  }

  browseAllTags(options?: LogixRequestOptions): Promise<{
    controller: SymbolInstance[];
    programs: Record<string, SymbolInstance[]>;
  }> {
    return this.tracked(this.session.browseAllTags(options));
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private dialSocket(): Promise<Socket> {
    return new Promise<Socket>((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port });
      socket.setNoDelay(true);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(
          new Error(
            `connect to ${this.host}:${this.port} timed out after ${this.connectTimeoutMs} ms`,
          ),
        );
      }, this.connectTimeoutMs);
      unrefTimer(timer);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once("error", (error: Error) => {
        clearTimeout(timer);
        socket.destroy();
        reject(error);
      });
    });
  }

  private flushOutbound(): void {
    const socket = this.socket;
    if (!socket || socket.destroyed) return;
    for (const frame of this.session.takeOutbound()) {
      socket.write(frame);
    }
  }

  /** Wraps a session promise so the watchdog covers its full lifetime. */
  private tracked<T>(promise: Promise<T>): Promise<T> {
    this.armWatchdog();
    return promise.finally(() => this.armWatchdog());
  }

  /** Inactivity timer: only runs while requests are pending. */
  private armWatchdog(): void {
    this.clearWatchdog();
    if (this.session.pendingRequestCount === 0) return;
    if (this.session.state === "closed" || this.session.state === "failed") return;
    this.watchdog = setTimeout(() => {
      this.teardown(
        new Error(
          `no response from ${this.host}:${this.port} for ${this.requestTimeoutMs} ms with requests pending`,
        ),
      );
    }, this.requestTimeoutMs);
    unrefTimer(this.watchdog);
  }

  private clearWatchdog(): void {
    if (this.watchdog !== undefined) {
      clearTimeout(this.watchdog);
      this.watchdog = undefined;
    }
  }

  private teardown(error: Error): void {
    this.clearWatchdog();
    this.session.fail(error);
    if (this.socket) {
      this.socket.destroy();
      this.socket = undefined;
    }
  }
}

/** `unref` exists on Node timers; keep the call duck-typed for portability. */
function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  (timer as { unref?: () => void }).unref?.();
}
