/**
 * @esco/driver-ethernetip-node — BACKEND-ONLY TCP transport for the ESCO
 * EtherNet/IP read-only driver.
 *
 * This package is the only place in the EtherNet/IP stack that touches a
 * socket. It must never be imported by browser code: the UI talks to the
 * ESCO gateway/session layers, which (in a future slice) talk to this
 * transport on the backend.
 *
 * Read-only by construction (delegates to the read-only session core), and
 * makes no hardware-validation claim — `verified` stays false everywhere
 * until real, signed hardware evidence exists.
 */

export { LogixTcpClient, type LogixTcpClientOptions } from "./tcp-client";
export {
  EthernetIpReadOnlyComms,
  createEthernetIpReadOnlyTransport,
  type EthernetIpReadOnlyCommsOptions,
} from "./readonly-comms";
export {
  EthernetIpGatewayDriver,
  ETHERNETIP_GATEWAY_DRIVER_ID,
  type EthernetIpGatewayDriverOptions,
} from "./gateway-driver";

// TEST-ONLY loopback target (canned CIP responses — not a controller
// emulator; proves transport mechanics, never hardware validation). Exported
// so downstream backend tests can exercise the full stack without hardware.
export {
  FakeLogixServer,
  type FakeLogixServerOptions,
} from "./testing/fake-logix-server";
