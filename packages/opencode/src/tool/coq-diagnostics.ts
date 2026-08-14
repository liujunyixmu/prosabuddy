export type CoqDiagnosticSeverity = "error" | "warning"

export interface CoqDiagnostic {
  severity: CoqDiagnosticSeverity
  file?: string
  line?: number
  message: string
}

export interface CoqCompilerDiagnostics {
  diagnostics: CoqDiagnostic[]
  errors: CoqDiagnostic[]
  warnings: CoqDiagnostic[]
  firstError?: CoqDiagnostic
  output: string
}

const LOCATION = /^File "([^"]+)", line (\d+)(?:, characters? \d+-\d+)?:\s*$/

function parseChannel(output: string) {
  const lines = output.replaceAll("\r\n", "\n").split("\n")
  const diagnostics: CoqDiagnostic[] = []

  for (let index = 0; index < lines.length;) {
    const location = lines[index].match(LOCATION)
    if (location) {
      let end = index + 1
      while (end < lines.length && !LOCATION.test(lines[end])) end += 1
      const block = lines.slice(index, end)
      const errorIndex = block.findIndex((line) => /^\s*Error:/.test(line))
      const warningIndex = block.findIndex((line) => /^\s*Warning:/.test(line))
      const severity = errorIndex >= 0 ? "error" : warningIndex >= 0 ? "warning" : undefined
      if (severity) {
        diagnostics.push({
          severity,
          file: location[1],
          line: Number.parseInt(location[2], 10),
          message: block.filter((line) => line.trim()).join("\n"),
        })
      }
      index = end
      continue
    }

    if (/^\s*Error:/.test(lines[index])) {
      let end = index + 1
      while (end < lines.length && !LOCATION.test(lines[end]) && !/^\s*(?:Error|Warning):/.test(lines[end])) end += 1
      diagnostics.push({
        severity: "error",
        message: lines.slice(index, end).filter((line) => line.trim()).join("\n"),
      })
      index = end
      continue
    }

    index += 1
  }

  return diagnostics
}

export function parseCoqCompilerOutput(stdout: string, stderr: string): CoqCompilerDiagnostics {
  const diagnostics = [...parseChannel(stderr), ...parseChannel(stdout)]
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error")
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning")
  const output = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n")
  return {
    diagnostics,
    errors,
    warnings,
    firstError: errors[0],
    output,
  }
}