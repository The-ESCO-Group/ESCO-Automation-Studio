import analogInputUrl from "./assets/device-images/analog_input.png";
import analogOutputUrl from "./assets/device-images/analog_output.png";
import chassisUrl from "./assets/device-images/chassis.png";
import communicationUrl from "./assets/device-images/communication.png";
import controllerUrl from "./assets/device-images/controller.png";
import digitalInputUrl from "./assets/device-images/digital_input.png";
import digitalOutputUrl from "./assets/device-images/digital_output.png";
import driveUrl from "./assets/device-images/drive.png";
import gatewayUrl from "./assets/device-images/gateway.png";
import genericUrl from "./assets/device-images/generic.png";
import hmiUrl from "./assets/device-images/hmi.png";
import meterUrl from "./assets/device-images/meter.png";
import motionUrl from "./assets/device-images/motion.png";
import remoteIoUrl from "./assets/device-images/remote_io.png";
import safetyUrl from "./assets/device-images/safety.png";
import specialtyUrl from "./assets/device-images/specialty.png";
import { ioDeviceFamilyImageKey, type IoDeviceImageLookupInput } from "./io-device-catalog";

const DEVICE_IMAGE_URLS: Record<string, string> = {
  analog_input: analogInputUrl,
  analog_output: analogOutputUrl,
  chassis: chassisUrl,
  communication: communicationUrl,
  controller: controllerUrl,
  digital_input: digitalInputUrl,
  digital_output: digitalOutputUrl,
  drive: driveUrl,
  gateway: gatewayUrl,
  generic: genericUrl,
  hmi: hmiUrl,
  meter: meterUrl,
  motion: motionUrl,
  remote_io: remoteIoUrl,
  safety: safetyUrl,
  specialty: specialtyUrl,
};

export function deviceImageUrl(input: string | IoDeviceImageLookupInput | undefined): string {
  const imageKey = typeof input === "string" ? ioDeviceFamilyImageKey({ imageKey: input }) : ioDeviceFamilyImageKey(input);
  return DEVICE_IMAGE_URLS[imageKey] ?? DEVICE_IMAGE_URLS.generic!;
}
