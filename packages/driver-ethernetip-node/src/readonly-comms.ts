/**
 * EthernetIpReadOnlyComms — the ESCO EtherNet/IP implementation of the
 * `ReadOnlyControllerComms` safety seam from `@esco/controller-comm`.
 *
 * This is the adapter the seam was designed to receive: it wires the
 * backend-only `LogixTcpClient` (which drives the ESCO-owned protocol stack)
 * into the safety-gated session architecture.
 *
 * HONESTY RULES — these are load-bearing.
 *
 * - CAPABILITIES ARE CONSERVATIVE: `canRead` is the only capability declared
 *   true. `canMonitor` stays false (no Forward Open / subscription support
 *   exists), and `canReadFaults` stays false (only identity fault bits are
 *   readable today — that is not a fault-diagnostics surface). Declaring less
 *   than we might get away with keeps the command gate honest.
 * - VERIFIED IS NEVER SET HERE: {@link createEthernetIpReadOnlyTransport}
 *   deliberately accepts no `verified` option. The transport it returns
 *   always carries `verified: false`, so the controller-comm safety gate
 *   routes every connect to `safety-blocked` — by design. Flipping `verified`
 *   requires real, signed hardware-validation evidence and a direct,
 *   deliberate `InjectedReadOnlyControllerTransport` construction at the
 *   integration point that holds that evidence. There is no convenience
 *   parameter on purpose.
 * - OPEN NEVER THROWS: the seam reports failures as `{ ok: false, message }`
 *   so the session layer can surface "Controller Link Unavailable" instead of
 *   crashing a UI flow.
 * - READ-ONLY: every operation delegates to the read-only client; the seam
 *   interface itself has no write method to implement.
 */

import type {
  ReadOnlyCommsCapabilities,
  ReadOnlyCommsOpenResult,
  ReadOnlyControllerComms,
  ReadOnlyControllerIdentity,
} from "@esco/controller-comm";
import { InjectedReadOnlyControllerTransport } from "@esco/controller-comm";
import {
  ENIP_DEFAULT_PORT,
  formatSerialNumber,
  isProgramSymbol,
  type RouteHop,
} from "@esco/driver-ethernetip";
import { LogixTcpClient, type LogixTcpClientOptions } from "./tcp-client";

export interface EthernetIpReadOnlyCommsOptions extends LogixTcpClientOptions {
  /**
   * Optional Unconnected Send route to the controller CPU (e.g.
   * `backplaneRoute(0)` for slot 0 behind a chassis EtherNet/IP module).
   * Omit to address the device terminating the TCP connection.
   */
  route?: readonly RouteHop[];
}

export class EthernetIpReadOnlyComms implements ReadOnlyControllerComms {
  readonly displayName: string;
  readonly capabilities: ReadOnlyCommsCapabilities = {
    canRead: true,
    canMonitor: false,
    canReadFaults: false,
  };

  private client: LogixTcpClient | undefined;

  constructor(private readonly options: EthernetIpReadOnlyCommsOptions) {
    const port = options.port ?? ENIP_DEFAULT_PORT;
    this.displayName = `ESCO EtherNet/IP read-only link (${options.host}:${port})`;
  }

  async open(): Promise<ReadOnlyCommsOpenResult> {
    if (this.client) {
      return { ok: false, message: "link is already open — close it first" };
    }
    const client = new LogixTcpClient(this.options);
    try {
      await client.connect();
    } catch (error) {
      client.close();
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        message: `EtherNet/IP session to ${this.displayHost()} failed: ${reason}`,
      };
    }
    this.client = client;
    return { ok: true, message: `EtherNet/IP session registered with ${this.displayHost()}` };
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    client?.close();
  }

  async readIdentity(): Promise<ReadOnlyControllerIdentity> {
    const identity = await this.requireClient("readIdentity").readIdentityObject({
      route: this.options.route,
    });
    return {
      vendor: identity.vendorName ?? `CIP vendor ${identity.vendorId}`,
      productName: identity.productName,
      revision: identity.revision,
      serialNumber: formatSerialNumber(identity.serialNumber),
      // Mode from the identity status word's keyswitch encoding when known;
      // faulted wins; otherwise honestly undefined.
      controllerMode: identity.faulted ? "Faulted" : identity.keyswitch,
    };
  }

  async readTag(path: string): Promise<number | boolean | string | undefined> {
    const result = await this.requireClient("readTag").readTag(path, 1, {
      route: this.options.route,
    });
    const value = result.value;
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
      return value;
    }
    if (typeof value === "bigint") {
      // LINT/ULINT: stay exact — number when safe, decimal string otherwise.
      const asNumber = Number(value);
      return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
    }
    // Arrays and undecoded structures are not representable in this seam's
    // scalar surface — report "no scalar value" rather than mangling data.
    return undefined;
  }

  async listTags(): Promise<readonly string[]> {
    const browse = await this.requireClient("listTags").browseAllTags({
      route: this.options.route,
    });
    const names: string[] = [];
    for (const symbol of browse.controller) {
      if (!symbol.isSystem && !isProgramSymbol(symbol)) names.push(symbol.name);
    }
    for (const [programName, symbols] of Object.entries(browse.programs)) {
      for (const symbol of symbols) {
        if (!symbol.isSystem) names.push(`${programName}.${symbol.name}`);
      }
    }
    return names;
  }

  private requireClient(operation: string): LogixTcpClient {
    if (!this.client) {
      throw new Error(`${operation} requires an open link — call open() first`);
    }
    return this.client;
  }

  private displayHost(): string {
    return `${this.options.host}:${this.options.port ?? ENIP_DEFAULT_PORT}`;
  }
}

/**
 * Builds the controller-comm transport for an ESCO EtherNet/IP read-only
 * link. The returned transport ALWAYS carries `verified: false` — this
 * factory deliberately exposes no way to change that. See the honesty rules
 * at the top of this file.
 */
export function createEthernetIpReadOnlyTransport(
  options: EthernetIpReadOnlyCommsOptions,
): InjectedReadOnlyControllerTransport {
  return new InjectedReadOnlyControllerTransport(new EthernetIpReadOnlyComms(options));
}
