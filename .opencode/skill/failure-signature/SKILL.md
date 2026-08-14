---
name: coq-failure-signatures
description: Use when Coq or ssreflect rewrite errors are hard to interpret and you need error-message-to-action mappings for shape mismatches.
argument-hint: '[error message] [current goal form]'
user-invocable: true
---

# Failure Signatures

This reference maps common Coq and ssreflect rewrite errors to the missing normalization step.

## Read the Error as a Shape Mismatch
Treat most failed rewrites as evidence that the current goal shape is different from the one in your head.

## Common Messages

| Error message | What it means | What to do next |
|---|---|---|
| `Unable to unify "X * n" with "iter n (addn X) 0"` | A constant big operator has already reduced to `iter`, but not yet to multiplication. | Finish the `iter` normalization, or rewrite the other side back to big operator form first. |
| `The LHS of mul1n ... does not match any subterm` | There is no literal `1 * _` in the goal. | Do not apply `mul1n` yet. First reduce the branch or constant sum until `1 * _` actually appears. |
| `The LHS of mulnC ... does not match any subterm` | There is no multiplication node yet, or it is not the subterm you intended. | Inspect the goal and confirm whether you are still in `bigop` or `iter` form. |
| `The LHS of big_ord_recr ... does not match any subterm` | The goal is no longer a standard ordinal big operator head. | Restore a `\sum_(i < n)` shape before peeling the first term. |
| `No applicable tactic` after several rewrites | The proof has drifted across multiple equivalent forms without a stable intermediate target. | Freeze the current goal, choose one normal form, and add a bridge lemma toward it. |

## Diagnostic Example

If the goal started as:

```coq
\sum_(cpu < num_cpus) X = X * num_cpus
```

then after:

```coq
rewrite big_const_ord.
```

the proof state may become:

```coq
iter num_cpus (addn X) 0 = X * num_cpus
```

At that point:
- `mulnC` is too early if multiplication is not yet on the left.
- `big_ord_recr` is too late because the left side is no longer a big operator.
- the correct move is a bridge step from `iter` to multiplication, or a different earlier normalization plan.

## Practical Rule
Before each rewrite, write down:

```text
Current head form:
Lemma left-hand side:
Does the left-hand side literally occur in the goal?
```

If the answer is no, add a bridge lemma instead of trying another algebraic rewrite.