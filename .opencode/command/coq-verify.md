---
description: Compile and verify a Coq .v file, report results
subtask: true
---

Use the coqc tool to compile the given Coq file. Report whether it passed or failed, and list any errors.

If a file path was given as an argument, use that. Otherwise, look for .v files in the current directory.

!`ls *.v 2>/dev/null | head -5`
