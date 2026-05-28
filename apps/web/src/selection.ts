export type Selection =
  | { kind: "controller"; id: string }
  | { kind: "program"; id: string }
  | { kind: "routine"; id: string }
  | { kind: "tag"; id: string }
  | null;
