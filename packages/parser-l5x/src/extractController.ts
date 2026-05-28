import { attr, child, toArray, type L5XNode } from "./parseL5X";

export interface ResolvedController {
  node: L5XNode;
  name: string;
}

/**
 * Resolve the target `<Controller>` node and its name from the L5X root.
 * Export files may have multiple controllers; the first is used.
 */
export function resolveController(root: L5XNode): ResolvedController {
  const controllers = toArray<L5XNode>(child(root, "Controller"));
  const node = controllers[0];
  if (!node) {
    throw new Error("Invalid L5X: no <Controller> element found.");
  }
  return { node, name: attr(node, "Name") ?? "Controller" };
}

/** Map an L5X task type to the domain task type. */
export function mapTaskType(raw: string | undefined): "continuous" | "periodic" | "event" {
  switch ((raw ?? "").toUpperCase()) {
    case "PERIODIC":
      return "periodic";
    case "EVENT":
      return "event";
    default:
      return "continuous";
  }
}
