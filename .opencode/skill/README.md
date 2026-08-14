# README on Skills

The paper describes a large set of automatically generated skill points, each corresponding to a fine-grained proving scenario or trigger condition. For example, these skill points cover situations such as:

- normalizing expressions involving indicator sums, filtered big operators, counts, and min-based bounds;
- expanding compressed `by ...` proof scripts to locate the first concrete error;
- reshaping goals when a mathematically valid rewrite fails due to syntactic mismatch;
- applying general proof-structuring, error-handling, and step-by-step Rocq proof management strategies.

However, this submission contains fewer skill files. This is because, for ease of use and maintenance, we performed a second-stage processing step with the help of large language models.

During this step, we merged general-purpose skills and skills with common patterns into broader skill files. In particular, skill points with overlapping trigger conditions, similar proof strategies, or shared proof-management logic were grouped together. This reduced redundancy, avoided overly fragmented skill files, and made the final skill set easier to read, retrieve, and apply in practice.

Therefore, the skill points described in the paper correspond to the fine-grained outputs from the automatic generation stage, while the submitted skill files are the consolidated version after LLM-assisted organization and review. The two numbers refer to different levels of granularity and are therefore not contradictory.