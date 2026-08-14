---
description: Full automated pipeline — read paper, build proof DAG, generate proof guidance, and prove all theorems in the current case study directory.
agent: casestudy-prover
---

You are in a case study directory. Execute the full proof pipeline automatically.

## Step 0: Discover the case study

!`ls *.pdf *.v 2>/dev/null`
!`ls prosa/_CoqProject 2>/dev/null`
!`basename "$PWD"`

Read the directory contents to identify:
- The **PDF paper** (the research paper to analyze)
- The **reference .v file** (READ-ONLY, named like `YYYY-CONF-TheoremN.v` or `YYYY_CONF_*.v`)
- The **working proof file** (`theoremN.v` or `lemmaN.v`) — **ONLY edit this file**
- The **prosa library** (in `./prosa/`)

**IMPORTANT RULES**:
- Only edit `theoremN.v` or `lemmaN.v`. All other files are READ-ONLY.
- The environment (prosa library, `_CoqProject`, Coq setup) is guaranteed correct — never modify it.
- If compilation fails, the error is always in the working proof file, not the environment.
- If the working file doesn't exist, create it by copying the reference file.

Then execute the full pipeline as described in your agent instructions.
