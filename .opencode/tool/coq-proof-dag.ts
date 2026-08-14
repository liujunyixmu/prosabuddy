/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import * as fs from "fs"
import * as path from "path"

/**
 * coq-proof-dag: Parse Coq proof dependencies and generate a proof DAG.
 *
 * Given a Coq source file or a proof name, this tool analyzes the dependency
 * structure and outputs a JSON DAG representation showing which lemmas/theorems
 * depend on which others.
 */
export default tool({
  description: [
    "Analyze Coq proof dependencies and generate a proof DAG (Directed Acyclic Graph).",
    "",
    "This tool can:",
    "- Parse a .v file to extract all lemma/theorem definitions and their dependencies",
    "- Read an existing levels.json DAG structure",
    "- Generate a dependency tree showing proof order",
    "",
    "Use this to understand proof structure before attempting automated verification.",
    "",
    "Actions:",
    "- 'parse': Parse a .v file and extract lemma/theorem/definition structure",
    "- 'dag': Read or generate a full dependency DAG from levels.json or source files",
    "- 'deps': Show dependencies for a specific theorem name",
  ].join("\n"),
  args: {
    action: tool.schema
      .enum(["parse", "dag", "deps"])
      .describe("Action to perform"),
    file: tool.schema
      .string()
      .optional()
      .describe("Path to .v file (for 'parse' action)"),
    levels_json: tool.schema
      .string()
      .optional()
      .describe("Path to levels.json file (for 'dag' action)"),
    theorem_name: tool.schema
      .string()
      .optional()
      .describe("Fully qualified theorem name (for 'deps' action)"),
    benchmarks_dir: tool.schema
      .string()
      .optional()
      .describe("Path to benchmarks directory containing level_N/ subdirectories"),
    format: tool.schema
      .enum(["json", "mermaid", "text"])
      .optional()
      .describe("Output format (default: text)"),
  },
  async execute(args, context) {
    const fmt = args.format ?? "text"

    if (args.action === "parse") {
      if (!args.file) throw new Error("file is required for parse action")
      const filePath = path.isAbsolute(args.file)
        ? args.file
        : path.resolve(context.directory, args.file)

      const content = fs.readFileSync(filePath, "utf-8")
      const items = parseCoqFile(content)

      if (fmt === "json") return JSON.stringify(items, null, 2)

      const output = [`## Proof Structure: ${path.basename(filePath)}`, ""]
      for (const item of items) {
        const deps = item.deps.length > 0 ? ` (uses: ${item.deps.join(", ")})` : ""
        output.push(`- **${item.kind}** \`${item.name}\`${deps}`)
        if (item.tactics.length > 0) {
          output.push(`  Tactics: ${item.tactics.join(", ")}`)
        }
      }
      return output.join("\n")
    }

    if (args.action === "dag") {
      const levelsPath = args.levels_json
        ? path.isAbsolute(args.levels_json)
          ? args.levels_json
          : path.resolve(context.directory, args.levels_json)
        : path.join(context.directory, "benchmarks_dag", "levels.json")

      if (!fs.existsSync(levelsPath)) {
        throw new Error(`levels.json not found at ${levelsPath}`)
      }

      const data = JSON.parse(fs.readFileSync(levelsPath, "utf-8"))

      if (fmt === "json") return JSON.stringify(data.summary, null, 2)

      if (fmt === "mermaid") {
        return generateMermaidDag(data)
      }

      const output = [
        "## Proof DAG Summary",
        `Total theorems: ${data.summary.total_theorems}`,
        `Max level: ${data.summary.max_level}`,
        `Levels: ${data.summary.num_levels}`,
        "",
      ]

      for (const [level, theorems] of Object.entries(data.levels)) {
        const list = theorems as string[]
        output.push(`### Level ${level} (${list.length} theorems)`)
        for (const t of list.slice(0, 10)) {
          output.push(`  - ${t}`)
        }
        if (list.length > 10) output.push(`  ... and ${list.length - 10} more`)
        output.push("")
      }

      return output.join("\n")
    }

    if (args.action === "deps") {
      if (!args.theorem_name) throw new Error("theorem_name is required for deps action")
      if (!args.benchmarks_dir) throw new Error("benchmarks_dir is required for deps action")

      const benchDir = path.isAbsolute(args.benchmarks_dir)
        ? args.benchmarks_dir
        : path.resolve(context.directory, args.benchmarks_dir)

      // Find the theorem's .v file
      const safeName = args.theorem_name.replace(/\./g, "_")
      let vFile = ""

      for (let lvl = 0; lvl <= 15; lvl++) {
        const candidate = path.join(benchDir, `level_${lvl}`, `${safeName}.v`)
        if (fs.existsSync(candidate)) {
          vFile = candidate
          break
        }
      }

      if (!vFile) {
        return `Theorem file not found for: ${args.theorem_name}`
      }

      const content = fs.readFileSync(vFile, "utf-8")
      const items = parseCoqFile(content)
      const requires = extractRequires(content)

      const output = [
        `## Dependencies for: ${args.theorem_name}`,
        `**File:** ${vFile}`,
        "",
        "### Required modules:",
        ...requires.map((r) => `  - ${r}`),
        "",
        "### Proof items:",
        ...items.map(
          (i) =>
            `  - ${i.kind} \`${i.name}\`${i.deps.length ? " depends on: " + i.deps.join(", ") : ""}`
        ),
      ]

      return output.join("\n")
    }

    throw new Error(`Unknown action: ${args.action}`)
  },
})

interface ProofItem {
  kind: "Lemma" | "Theorem" | "Definition" | "Corollary" | "Fact" | "Remark" | "Proposition"
  name: string
  deps: string[]
  tactics: string[]
  line: number
}

function parseCoqFile(content: string): ProofItem[] {
  const items: ProofItem[] = []
  const lines = content.split("\n")
  const kinds = ["Lemma", "Theorem", "Definition", "Corollary", "Fact", "Remark", "Proposition"]
  const kindRegex = new RegExp(`^\\s*(${kinds.join("|")})\\s+(\\w+)`, "m")

  let inProof = false
  let current: ProofItem | null = null
  let proofBody = ""

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const match = kindRegex.exec(line)

    if (match && !inProof) {
      current = {
        kind: match[1] as ProofItem["kind"],
        name: match[2],
        deps: [],
        tactics: [],
        line: i + 1,
      }
    }

    if (/^\s*Proof\b/.test(line) && current) {
      inProof = true
      proofBody = ""
    }

    if (inProof) {
      proofBody += line + "\n"
    }

    if (/^\s*(Qed|Defined|Admitted|Abort)\s*\./.test(line) && current) {
      inProof = false
      // Extract tactics used
      current.tactics = extractTactics(proofBody)
      // Extract lemma references
      current.deps = extractDeps(proofBody)
      items.push(current)
      current = null
    }
  }

  return items
}

function extractTactics(proofBody: string): string[] {
  const tactics = new Set<string>()
  const tacticNames = [
    "auto", "eauto", "omega", "lia", "nia", "ring", "field",
    "simpl", "unfold", "rewrite", "apply", "exact", "destruct",
    "induction", "inversion", "contradiction", "discriminate",
    "split", "left", "right", "exists", "intro", "intros",
    "assert", "pose", "set", "remember", "generalize",
    "specialize", "exploit", "feed", "first", "by", "done",
    "move", "case", "elim", "have", "suff", "wlog",
    "ssromega", "ssrlia",
  ]
  for (const t of tacticNames) {
    const re = new RegExp(`\\b${t}\\b`, "i")
    if (re.test(proofBody)) tactics.add(t)
  }
  return Array.from(tactics)
}

function extractDeps(proofBody: string): string[] {
  const deps = new Set<string>()
  // Match "apply IDENT", "rewrite IDENT", "exact IDENT", etc.
  const patterns = [
    /\bapply\s+(\w+)/g,
    /\brewrite\s+[<>!-]*\s*(\w+)/g,
    /\bexact\s+(\w+)/g,
    /\bpose\s+proof\s+(\w+)/g,
    /\bspecialize\s+\((\w+)/g,
    /\bexploit\s+(\w+)/g,
    /\bfeed\s+(\w+)/g,
  ]
  for (const re of patterns) {
    let m
    while ((m = re.exec(proofBody))) {
      const name = m[1]
      // Filter out common tactics/keywords
      if (name && name.length > 2 && !/^(H\d*|IH\w*|n|m|k|x|y|z|t|s|p|q)$/.test(name)) {
        deps.add(name)
      }
    }
  }
  return Array.from(deps)
}

function extractRequires(content: string): string[] {
  const requires: string[] = []
  const re = /Require\s+(?:Import|Export)\s+([\s\S]*?)\./g
  let m
  while ((m = re.exec(content))) {
    const modules = m[1].trim().split(/\s+/)
    for (const mod of modules) {
      if (mod && !mod.startsWith("(*")) requires.push(mod)
    }
  }
  return requires
}

function generateMermaidDag(data: any): string {
  const lines = ["graph TD"]
  const levels = Object.entries(data.levels) as [string, string[]][]
  
  // Add nodes grouped by level
  for (const [level, theorems] of levels) {
    const list = theorems as string[]
    for (const t of list.slice(0, 5)) {
      // Shorten name for display
      const short = t.split(".").slice(-2).join(".")
      const id = t.replace(/[^a-zA-Z0-9]/g, "_")
      lines.push(`  ${id}["L${level}: ${short}"]`)
    }
    if (list.length > 5) {
      lines.push(`  level${level}_more["... +${list.length - 5} more"]`)
    }
  }

  // Add edges between levels (simplified)
  for (let i = 1; i < levels.length; i++) {
    const [prevLevel, prevTheorems] = levels[i - 1]
    const [curLevel, curTheorems] = levels[i]
    if ((prevTheorems as string[]).length > 0 && (curTheorems as string[]).length > 0) {
      const from = (prevTheorems as string[])[0].replace(/[^a-zA-Z0-9]/g, "_")
      const to = (curTheorems as string[])[0].replace(/[^a-zA-Z0-9]/g, "_")
      lines.push(`  ${from} --> ${to}`)
    }
  }

  return lines.join("\n")
}
