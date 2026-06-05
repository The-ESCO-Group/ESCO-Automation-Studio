export interface DimensionInput {
  dimension?: number;
  dimensions?: readonly number[];
}

export interface DimensionProps {
  dimension?: number;
  dimensions?: number[];
}

export function hasDimensionInput(value: DimensionInput): boolean {
  return value.dimension !== undefined || value.dimensions !== undefined;
}

export function dimensionPropsFrom(value: DimensionInput, label: string): { props: DimensionProps; error?: string } {
  if (value.dimensions !== undefined) {
    if (value.dimensions.length === 0) return { props: {} };
    if (!value.dimensions.every((dimension) => Number.isInteger(dimension) && dimension > 0)) {
      return { props: {}, error: `${label} dimensions must be positive integers.` };
    }
    const dimensions = value.dimensions.map((dimension) => Math.floor(dimension));
    return {
      props: {
        dimension: dimensions[0],
        ...(dimensions.length > 1 ? { dimensions } : {}),
      },
    };
  }

  if (value.dimension !== undefined) {
    if (!Number.isInteger(value.dimension) || value.dimension < 0) {
      return { props: {}, error: `${label} dimension must be a non-negative integer.` };
    }
    return value.dimension > 0 ? { props: { dimension: value.dimension } } : { props: {} };
  }

  return { props: {} };
}

export function mergeDimensionPatch(
  current: DimensionInput,
  patch: DimensionInput,
  label: string,
): { props: DimensionProps; error?: string } {
  return hasDimensionInput(patch) ? dimensionPropsFrom(patch, label) : dimensionPropsFrom(current, label);
}
