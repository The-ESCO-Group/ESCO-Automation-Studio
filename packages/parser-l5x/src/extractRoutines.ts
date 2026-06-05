import { createRoutine, type Routine, type RoutineLanguage } from "@esco/core";
import type { InstructionRegistry } from "@esco/instructions";
import { createLadderRoutine, createRung } from "@esco/ladder";
import { attr, child, text, toArray, type L5XNode } from "./parseL5X";
import { parseRungText } from "./parseRungText";
import { analyzeStructuredText } from "./structuredText";

/** Cap on Structured Text syntax warnings per routine, so a badly-broken file can't flood the import log. */
const MAX_ST_SYNTAX_WARNINGS = 20;

export interface ExtractedRoutines {
  routines: Routine[];
  warnings: string[];
}

/** Map an L5X `<Routine Type>` to a domain routine language. */
const LANGUAGE_BY_TYPE: Record<string, RoutineLanguage> = {
  RLL: "ladder",
  ST: "structured-text",
  FBD: "function-block",
  SFC: "sfc",
};

/** Content element name that carries each language's body. */
const CONTENT_TAG: Record<RoutineLanguage, string> = {
  ladder: "RLLContent",
  "structured-text": "STContent",
  "function-block": "FBDContent",
  sfc: "SFCContent",
};

/** Resolve the routine language from the Type attribute, falling back to which content child is present. */
function detectLanguage(routineNode: L5XNode): RoutineLanguage {
  const type = (attr(routineNode, "Type") ?? "").toUpperCase();
  if (LANGUAGE_BY_TYPE[type]) return LANGUAGE_BY_TYPE[type];
  for (const language of ["ladder", "structured-text", "function-block", "sfc"] as RoutineLanguage[]) {
    if (child(routineNode, CONTENT_TAG[language]) != null) return language;
  }
  return "ladder";
}

/** Join `<STContent><Line>` elements (or raw CDATA) into a single source string. */
function extractStructuredText(routineNode: L5XNode): string {
  const content = child(routineNode, "STContent");
  if (content == null) return "";
  const lines = toArray<L5XNode>(child(content, "Line"));
  if (lines.length > 0) return lines.map((line) => text(line)).join("\n");
  return text(content);
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeXmlAttr(value: string): string {
  return escapeXmlText(value).replace(/"/g, "&quot;");
}

/**
 * Serialize a parsed XML subtree back to readable XML. This is intentionally
 * conservative: imported FBD/SFC bodies remain read-only, but their structural
 * body is preserved so generated L5X exports can round-trip it instead of
 * replacing the routine with an empty stub.
 */
function serializeXmlNode(node: unknown, name: string, depth = 0): string {
  const pad = "  ".repeat(depth);
  if (node == null) return `${pad}<${name}/>`;
  if (typeof node !== "object") {
    const value = String(node).trim();
    return value ? `${pad}<${name}>${escapeXmlText(value)}</${name}>` : `${pad}<${name}/>`;
  }
  const obj = node as Record<string, unknown>;
  const attrText = Object.entries(obj)
    .filter(([key]) => key.startsWith("@_"))
    .map(([key, value]) => ` ${key.slice(2)}="${escapeXmlAttr(String(value))}"`)
    .join("");

  const lines: string[] = [];
  const inlineText = typeof obj["#text"] === "string" ? obj["#text"].trim() : "";
  if (inlineText) lines.push(`${pad}  ${escapeXmlText(inlineText)}`);
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith("@_") || key === "#text") continue;
    for (const item of toArray(value)) {
      lines.push(serializeXmlNode(item, key, depth + 1));
    }
  }

  if (lines.length === 0) return `${pad}<${name}${attrText}/>`;
  lines.unshift(`${pad}<${name}${attrText}>`);
  lines.push(`${pad}</${name}>`);
  return lines.join("\n");
}

function extractGraphicalSource(routineNode: L5XNode, contentTag: string): string {
  const content = child(routineNode, contentTag);
  if (content == null) return "";
  return serializeXmlNode(content, contentTag);
}

/**
 * Extract `<Routine>` elements for a program. Ladder (RLL) routines get their
 * rungs parsed into the semantic AST; the original rung text is preserved on
 * each rung's `sourceText`. Non-ladder routines (Structured Text / Function
 * Block / SFC) are imported **read-only**: their source/structure is preserved
 * for display (`structuredText` / `sourceText`) but never parsed into ladder or
 * executed.
 */
export function extractRoutineList(
  routineNodes: L5XNode[],
  ownerName: string,
  ownerId: string,
  registry: InstructionRegistry,
  knownInstructionTypes: Set<string> = new Set(),
): ExtractedRoutines {
  const warnings: string[] = [];
  const routines = routineNodes.flatMap(
    (routineNode) => {
      const name = attr(routineNode, "Name");
      if (!name) return [];
      const language = detectLanguage(routineNode);
      const routine = createRoutine(ownerId, name, language);
      const description = child(routineNode, "Description");
      if (description) routine.description = text(description);

      const where = `${ownerName}/${name}`;
      const aoiBody = ownerName.startsWith("AOI ");

      if (language === "ladder") {
        const rllContent = child(routineNode, "RLLContent");
        if (rllContent) {
          const ladder = createLadderRoutine();
          toArray<L5XNode>(child(rllContent, "Rung")).forEach((rungNode, index) => {
            const number = Number(attr(rungNode, "Number") ?? index);
            const rungText = text(child(rungNode, "Text"));
            const comment = child(rungNode, "Comment");
            const parsed = parseRungText(rungText, registry, knownInstructionTypes);

            const rung = createRung(
              ladder.id,
              Number.isFinite(number) ? number : index,
              [],
              comment ? text(comment) : undefined,
            );
            rung.root = parsed.root;
            rung.sourceText = rungText;
            ladder.rungs.push(rung);

            const location = `${where} rung ${rung.number}`;
            for (const type of parsed.unsupportedTypes) {
              warnings.push(`${location}: unsupported instruction "${type}" (preserved, not simulated).`);
            }
            if (parsed.complexBranch) {
              warnings.push(`${location}: unrepresentable branch flattened to a series (simulation may differ).`);
            }
          });
          routine.ladder = ladder;
        }
      } else if (language === "structured-text") {
        const source = extractStructuredText(routineNode);
        if (source) {
          routine.structuredText = source;
          // Structural syntax check only; execution coverage is a conservative offline subset.
          const syntax = analyzeStructuredText(source).findings;
          for (const finding of syntax.slice(0, MAX_ST_SYNTAX_WARNINGS)) {
            const at = finding.line ? ` (line ${finding.line})` : "";
            warnings.push(`${where}: Structured Text syntax${at}: ${finding.message}`);
          }
          if (syntax.length > MAX_ST_SYNTAX_WARNINGS) {
            warnings.push(`${where}: Structured Text syntax: and ${syntax.length - MAX_ST_SYNTAX_WARNINGS} more issue(s).`);
          }
        }
        warnings.push(
          aoiBody
            ? `${where}: Structured Text AOI body imported read-only (source preserved, not simulated).`
            : `${where}: Structured Text routine imported (source preserved; limited offline execution subset).`,
        );
      } else {
        const source = extractGraphicalSource(routineNode, CONTENT_TAG[language]);
        if (source) routine.sourceText = source;
        const label = language === "function-block" ? "Function Block" : "SFC";
        warnings.push(`${where}: ${label} routine imported read-only (structure preserved, not simulated).`);
      }

      return [routine];
    },
  );

  return { routines, warnings };
}

export function extractRoutines(
  programNode: L5XNode,
  programName: string,
  programId: string,
  registry: InstructionRegistry,
  knownInstructionTypes: Set<string> = new Set(),
): ExtractedRoutines {
  return extractRoutineList(
    toArray<L5XNode>(child(child(programNode, "Routines"), "Routine")),
    programName,
    programId,
    registry,
    knownInstructionTypes,
  );
}
