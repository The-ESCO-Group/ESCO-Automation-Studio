/**
 * @esco/driver-ethernetip — ESCO-owned EtherNet/IP / CIP protocol codecs for
 * the Goal B read-only Allen-Bradley driver.
 *
 * SAFETY AND SCOPE — read before extending.
 *
 * - PURE CODECS ONLY (this slice): every export encodes or decodes bytes.
 *   There is NO socket, NO transport, and NO controller endpoint in this
 *   package today. A backend-only transport that carries these frames over
 *   TCP 44818 is a separate, explicitly reviewed slice.
 * - READ-ONLY BY CONSTRUCTION: no Write Tag / Read-Modify-Write / download /
 *   mode-change builder exists here. Adding one is a design decision with its
 *   own gates (confirmation, permission, audit, read-back), not a refactor.
 * - NO ROCKWELL RUNTIME: written from the public ODVA EtherNet/IP and CIP
 *   specifications. No FactoryTalk, RSLinx, Studio 5000, .ACD files, or
 *   vendor binaries are used or required.
 * - VERIFIED STAYS FALSE: nothing in this package may ever claim hardware
 *   validation. The `verified` flag in @esco/controller-comm flips only on
 *   real, signed hardware-validation evidence — never from code in here.
 */

// Byte-level helpers (exported for the future transport and for tests).
export {
  ByteReader,
  ByteWriter,
  bytesEqual,
  concatBytes,
  toHex,
} from "./bytes";

// EtherNet/IP encapsulation layer.
export {
  ENIP_DEFAULT_PORT,
  ENIP_HEADER_SIZE,
  ENIP_MAX_DATA_LENGTH,
  EnipCommand,
  EnipStatus,
  enipStatusMessage,
  zeroSenderContext,
  encodeEncapsulation,
  decodeEncapsulation,
  encodeRegisterSessionRequest,
  decodeRegisterSessionReply,
  encodeUnregisterSessionRequest,
  encodeListIdentityRequest,
  type EncapsulationPacket,
  type EncodeEncapsulationInput,
  type RegisterSessionReply,
  type EnipCommandCode,
} from "./enip/encapsulation";

export { EnipStreamFramer } from "./enip/framing";

export {
  CpfItemType,
  encodeCpf,
  decodeCpf,
  encodeSendRRDataPayload,
  decodeSendRRDataPayload,
  encodeSendUnitDataPayload,
  decodeSendUnitDataPayload,
  extractUnconnectedData,
  type CpfItem,
  type SendRRDataPayload,
  type SendUnitDataPayload,
} from "./enip/cpf";

export {
  SERVICE_FORWARD_OPEN,
  SERVICE_LARGE_FORWARD_OPEN,
  SERVICE_FORWARD_CLOSE,
  TRANSPORT_CLASS_3_SERVER,
  DEFAULT_RPI_MICROSECONDS,
  buildForwardOpenRequest,
  parseForwardOpenReply,
  buildForwardCloseRequest,
  parseForwardCloseReply,
  type ForwardOpenOptions,
  type ForwardOpenReply,
  type ForwardCloseOptions,
  type ForwardCloseReply,
} from "./cip/forward-open";

// CIP layer.
export {
  classSegment,
  instanceSegment,
  attributeSegment,
  memberSegment,
  symbolSegment,
  portSegment,
  encodePaddedEpath,
  tagAddressToSegments,
  type EpathSegment,
  type EncodedEpath,
} from "./cip/epath";

export {
  CipGeneralStatus,
  cipStatusMessage,
  CipResponseError,
  encodeMessageRouterRequest,
  decodeMessageRouterResponse,
  expectCipSuccess,
  type MessageRouterResponse,
} from "./cip/message-router";

export {
  CONNECTION_MANAGER_CLASS,
  SERVICE_UNCONNECTED_SEND,
  backplaneRoute,
  encodeUnconnectedSendRequest,
  type RouteHop,
  type UnconnectedSendOptions,
} from "./cip/unconnected-send";

export {
  MESSAGE_ROUTER_CLASS,
  SERVICE_MULTIPLE_SERVICE_PACKET,
  STATUS_EMBEDDED_SERVICE_ERROR,
  encodeMultipleServicePacket,
  parseMultipleServiceReply,
  encodeMultipleServiceReply,
} from "./cip/multi-service";

export {
  CipType,
  STRUCTURE_TYPE_CODE,
  LOGIX_STRING_STRUCTURE_HANDLE,
  cipTypeName,
  cipScalarSize,
  decodeTypedValue,
  type CipScalar,
  type DecodedTagValue,
} from "./cip/data-types";

// Logix services (read-only).
export {
  SERVICE_READ_TAG,
  SERVICE_READ_TAG_FRAGMENTED,
  buildReadTagRequest,
  buildReadTagFragmentedRequest,
  parseReadTagReply,
  type ReadTagResult,
} from "./logix/read-tag";

export {
  SYMBOL_OBJECT_CLASS,
  SERVICE_GET_INSTANCE_ATTRIBUTE_LIST,
  SYMBOL_ATTRIBUTE_NAME,
  SYMBOL_ATTRIBUTE_TYPE,
  buildTagListRequest,
  parseTagListReply,
  isProgramSymbol,
  type SymbolInstance,
  type TagListPage,
} from "./logix/tag-list";

export {
  IDENTITY_CLASS,
  SERVICE_GET_ATTRIBUTES_ALL,
  buildIdentityRequest,
  parseIdentityReply,
  parseListIdentityItem,
  decodeIdentityStatus,
  decodeKeyswitchPosition,
  formatSerialNumber,
  type CipIdentity,
  type ListIdentityInfo,
  type IdentityFaults,
} from "./logix/identity";

export {
  TEMPLATE_OBJECT_CLASS,
  SERVICE_GET_ATTRIBUTE_LIST,
  SERVICE_READ_TEMPLATE,
  buildTemplateAttributesRequest,
  parseTemplateAttributesReply,
  templateReadSize,
  buildReadTemplateRequest,
  parseTemplateDefinition,
  decodeStructureValue,
  type TemplateAttributes,
  type TemplateMember,
  type LogixTemplate,
  type DecodedStructure,
  type DecodeStructureOptions,
  type StructureMemberValue,
} from "./logix/templates";

// Sans-I/O session core (no sockets — a backend transport drives it).
export {
  LogixSessionCore,
  type SessionState,
  type LogixRequestOptions,
  type LogixSessionCoreHooks,
  type BatchReadOutcome,
  type ConnectedModeOptions,
} from "./session/session-core";
