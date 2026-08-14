---
description: Analyze a paper or case study and generate its proof DAG
subtask: true
---

Use the @paper-analyst agent to analyze the given paper or case study directory and produce a proof DAG.

If a directory was given as an argument, look for PDF and .v files there.
If a paper title/reference was given, search for it in dataset_casestudy/.

!`ls dataset_casestudy/ 2>/dev/null`
