import { arrayDimensionsOf } from "@esco/core";

export function parseDimensionsAttr(value: string | undefined): number[] {
  return (value ?? "")
    .trim()
    .split(/[\s,]+/)
    .map((part) => Number(part))
    .filter((dimension) => Number.isInteger(dimension) && dimension > 0);
}

export function dimensionProps(value: string | undefined): { dimension?: number; dimensions?: number[] } {
  const dimensions = parseDimensionsAttr(value);
  return {
    ...(dimensions[0] ? { dimension: dimensions[0] } : {}),
    ...(dimensions.length > 1 ? { dimensions } : {}),
  };
}

export function l5xDimensions(value: { dimension?: number; dimensions?: readonly number[] }): string | undefined {
  const dimensions = arrayDimensionsOf(value);
  return dimensions.length > 0 ? dimensions.join(" ") : undefined;
}
