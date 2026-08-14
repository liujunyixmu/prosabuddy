import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Identifier } from "../../src/id/id"
import { PermissionNext } from "../../src/permission/next"
import { Instance } from "../../src/project/instance"
import { MessageV2 } from "../../src/session/message-v2"
import { Session } from "../../src/session"
import { SessionProof } from "../../src/session/session-proof"
import { SessionProofWorkflow } from "../../src/session/proof-workflow"
import { ProofEditTransaction } from "../../src/session/proof-edit-transaction"
import * as SessionPromptModule from "../../src/session/prompt"
import { Trace } from "../../src/session/trace"
import type { Tool } from "../../src/tool/tool"
import { TaskTool } from "../../src/tool/task"
import { tmpdir } from "../fixture/fixture"

const promptSchema = SessionPromptModule.SessionPrompt.prompt.schema

function baseContext(overrides: Partial<Tool.Context> = {}): Tool.Context {
  return {
    sessionID: "",
    messageID: "",
    callID: "test-call",
    agent: "prover",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => {},
    ask: async () => {},
    ...overrides,
  }
}

function createPromptMock(handler: (input: any) => Promise<any>) {
  return Object.assign(async (input: any) => handler(input), {
    force: async (input: any) => handler(input),
    schema: promptSchema,
  }) as typeof SessionPromptModule.SessionPrompt.prompt
}

async function createAssistantMessage(sessionID: string, root: string, agent = "prover") {
  const userMessage = await Session.updateMessage({
    id: Identifier.ascending("message"),
    role: "user",
    sessionID,
    agent,
    model: {
      providerID: "openai",
      modelID: "gpt-5.4",
    },
    time: {
      created: Date.now(),
    },
  })

  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: userMessage.id,
    sessionID,
    type: "text",
    text: "prove this gap",
  })

  const assistantMessage: MessageV2.Assistant = {
    id: Identifier.ascending("message"),
    role: "assistant",
    sessionID,
    mode: "default",
    agent,
    path: {
      cwd: root,
      root,
    },
    cost: 0,
    tokens: {
      output: 0,
      input: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: "gpt-5.4",
    providerID: "openai",
    parentID: userMessage.id,
    time: {
      created: Date.now(),
    },
    finish: "end_turn",
  }

  await Session.updateMessage(assistantMessage)

  return assistantMessage
}

async function addCompletedToolPart(input: {
  sessionID: string
  messageID: string
  tool: string
  callID: string
  toolInput: Record<string, unknown>
}) {
  await Session.updatePart({
    id: Identifier.ascending("part"),
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "tool",
    tool: input.tool,
    callID: input.callID,
    state: {
      status: "completed",
      input: input.toolInput,
      output: "ok",
      title: input.tool,
      metadata: {},
      time: {
        start: Date.now(),
        end: Date.now(),
      },
    },
  } as MessageV2.ToolPart)
}

function proofResult(payload: Record<string, unknown>) {
  return `<proof_result>${JSON.stringify({
    goal_id: "goal-1",
    parent_goal_id: "goal-0",
    stack_mode: "dfs_lifo",
    informal_proof: "The local proof attempt has a concrete structured outcome.",
    used_helpers: [],
    validation_plan: ["coqc lemma.v"],
    recursion_depth: 1,
    max_recursion_depth: 4,
    ...payload,
  })}</proof_result>`
}

function regionBegin(admitID: string, target = "Hxxx") {
  return `(* proof_region begin owner: lemma admit_id: ${admitID} theorem: demo kind: pointwise_semantic_bridge target: ${target} plan_node: node_${target} depends_on: theorem_context source: paper_step_001 input: theorem_context output: ${target} layer: coq_shape expected: local_fact normal_form: "True" evidence: mathcomp:I informal proof: prove the local fact from I. *)`
}

function regionSource(admitID = "gap-1", target = "Hxxx") {
  return [
    "Lemma demo : True.",
    "Proof.",
    regionBegin(admitID, target),
    `assert (${target} : True).`,
    "{",
    `  (* admit_id: ${admitID} *)`,
    "  admit.",
    "}",
    `(* proof_region end admit_id: ${admitID} *)`,
    `exact ${target}.`,
    "Admitted.",
    "",
  ].join("\n")
}

function regionLemmaAssignment() {
  const beginMarker = regionBegin("gap-1", "Hxxx")
  return {
    file: "lemma.v",
    theorem: "demo",
    admit_id: "gap-1",
    goal: "True",
    proof_position: { line: 4, character: 2 },
    replace: "Replace pending work for gap-1 inside the proof_region markers only.",
    skeleton: [
      beginMarker,
      "assert (Hxxx : True).",
      "{ admit. }",
      "(* proof_region end admit_id: gap-1 *)",
      "exact Hxxx.",
    ].join("\n"),
    done: "The region validates and contains no pending admit for gap-1.",
    obligation: {
      kind: "pointwise_semantic_bridge" as const,
      target_name: "Hxxx",
      target_statement: "assert (Hxxx : True).",
      expected_proof_kind: "region_local_proof_with_optional_sibling_helpers",
      dependencies: ["theorem_context"],
      input: ["theorem_context"],
      prosa_candidate_lemmas: [],
      mathcomp_candidate_lemmas: ["I"],
      shape_evidence: ["mathcomp:I"],
      locality_check: {
        all_dependencies_available: true,
        may_need_region_helper: false,
        changes_theorem_spine: false,
        expected_lemma_shape: "assert (Hxxx : True).",
        risk_level: "low" as const,
      },
    },
    editable_region: {
      mode: "region" as const,
      start_line: 3,
      end_line: 9,
      text: "assert (Hxxx : True).\n{ admit. }",
      begin_marker: beginMarker,
      end_marker: "(* proof_region end admit_id: gap-1 *)",
      can_add_sibling_helpers: true,
      immutable_prefix_hash: "prefix",
      immutable_suffix_hash: "suffix",
    },
    escalation_contract: {
      allowed_escalations: ["needs_subgoal_remodel" as const, "not_local" as const],
      remodel_owner: "prover" as const,
    },
  }
}

describe("tool.task recursive proof agents", () => {
  let resolvePromptPartsSpy: ReturnType<typeof spyOn> | undefined
  let promptSpy: ReturnType<typeof spyOn> | undefined

  beforeEach(() => {
    resolvePromptPartsSpy = undefined
    promptSpy = undefined
  })

  afterEach(() => {
    resolvePromptPartsSpy?.mockRestore()
    promptSpy?.mockRestore()
  })

  test("prover, lemma, and fixer expose the expected layered proof workflow", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const prover = await Agent.get("prover")
        const lemma = await Agent.get("lemma")
        const fixer = await Agent.get("fixer")

        expect(prover).toBeDefined()
        expect(prover?.prompt).toContain("Phase 1: generate and freeze the theorem-level proof skeleton first.")
        expect(prover?.prompt).toContain("Call `proof_plan` before the first skeleton edit")
        expect(prover?.prompt).toContain("The proof workflow scheduler delegates one DAG-ready lemma-owned gap at a time")

        expect(lemma).toBeDefined()
        expect(lemma?.prompt).toContain("Layer 2 long-running local subtheorem prover")
        expect(lemma?.prompt).toContain("Long-Running Interactive Proof Loop")
        expect(lemma?.prompt).toContain("If the informal proof already supports a direct proof, write the line-by-line comments first and then prove directly from them")
        expect(PermissionNext.evaluate("lsp", "*", lemma!.permission).action).toBe("allow")
        expect(PermissionNext.evaluate("petanque", "*", lemma!.permission).action).toBe("allow")
        expect(PermissionNext.evaluate("task", "*", lemma!.permission).action).toBe("allow")
        expect(PermissionNext.evaluate("task", "lemma", lemma!.permission).action).toBe("deny")

        const lemmaTaskTool = await TaskTool.init({ agent: lemma! })
        expect(lemmaTaskTool.description).not.toContain("- lemma:")
        expect(lemmaTaskTool.description).toContain("- explorer:")

        expect(fixer).toBeDefined()
        expect(fixer?.prompt).toContain("Do not remove, reorder, merge, or rewrite the surrounding `pose` / `have` skeleton.")
        expect(PermissionNext.evaluate("task", "*", fixer!.permission).action).toBe("deny")
      },
    })
  })

  test("lemma task execution injects runtime guardrails and records proof_result metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const assistant = await createAssistantMessage(session.id, tmp.path)
        const theoremFile = `${tmp.path}/lemma.v`
        let resolvedPrompt = ""
        let promptInput: any
        let metadataCalls: Array<{ title?: string; metadata?: Record<string, unknown> }> = []

        await Bun.write(theoremFile, regionSource())
        await addCompletedToolPart({
          sessionID: session.id,
          messageID: assistant.id,
          tool: "proof_plan",
          callID: "proof-plan-1",
          toolInput: {
            source: "Step 1. Reduce the theorem to one local gap.",
            theorem: "demo",
          },
        })
        await addCompletedToolPart({
          sessionID: session.id,
          messageID: assistant.id,
          tool: "edit",
          callID: "edit-1",
          toolInput: {
            filePath: theoremFile,
            oldString: "Proof.",
            newString: "Proof.",
          },
        })

        resolvePromptPartsSpy = spyOn(SessionPromptModule.SessionPrompt, "resolvePromptParts").mockImplementation(
          async (prompt) => {
            resolvedPrompt = prompt
            return [{ type: "text", text: prompt }] as any
          },
        )

        promptSpy = spyOn(SessionPromptModule.SessionPrompt, "prompt").mockImplementation(
          createPromptMock(async (input: any) => {
            promptInput = input
            return {
              parts: [
                {
                  type: "text",
                  text:
                    '<proof_result>{"status":"split","goal_id":"goal-1","parent_goal_id":"goal-0","stack_mode":"dfs_lifo","informal_proof":"Reduce the local gap to one smaller child obligation and solve it before returning.","split_required":true,"split_reason":"A smaller local child obligation isolates the only missing bound.","children":[{"child_id_hint":"child-1","title":"Isolate the bound","statement":"Show the local interference bound for the current branch.","why_smaller_than_parent":"It solves one bound used by the parent without changing the outer skeleton.","expected_role_in_parent":"Discharges the only pending local bound.","suggested_order":1,"paper_reference":"paper-step-1"}],"proof_text":"","used_helpers":["explorer"],"validation_plan":["coq_session"],"escalate_reason":"","recursion_depth":1,"max_recursion_depth":4}</proof_result>',
                },
              ],
            } as any
          }),
        )

        const tool = await TaskTool.init()
        const result = await tool.execute(
          {
            description: "Local gap",
            prompt: "Solve the local gap.",
            subagent_type: "lemma",
            lemma_assignment: {
              file: "lemma.v",
              theorem: "demo",
              admit_id: "gap-1",
              goal: "True",
              proof_position: { line: 2, character: 4 },
              replace: "Replace only admit gap-1.",
              skeleton: "Proof.\n  admit.\nQed.",
              done: "coqc lemma.v succeeds.",
            },
          },
          baseContext({
            sessionID: session.id,
            messageID: assistant.id,
            metadata: (input) => metadataCalls.push(input),
          }),
        )

        expect(resolvedPrompt).toContain("<lemma-runtime-guardrail>")
        expect(resolvedPrompt).toContain("caller_agent: prover")
        expect(resolvedPrompt).toContain("stack_mode: dfs_lifo")
        expect(resolvedPrompt).toContain("ownership: edit only the assigned proof_region")
        expect(resolvedPrompt).toContain("prefix: solve and validate the first unresolved local block")
        expect(resolvedPrompt).toContain("freedom: direct proof, same-region helpers")
        expect(promptInput.agent).toBe("lemma")
        expect(promptInput.tools.task).toBeUndefined()

        expect(metadataCalls.at(0)?.metadata?.lemma_runtime).toMatchObject({
          caller_agent: "prover",
          recursion_depth: 1,
          max_recursion_depth: 4,
          max_children: 1,
          stack_mode: "dfs_lifo",
        })

        expect(result.metadata.lemma_runtime).toMatchObject({
          caller_agent: "prover",
          recursion_depth: 1,
          max_recursion_depth: 4,
          max_children: 1,
          stack_mode: "dfs_lifo",
        })
        expect(result.metadata.proof_result_validation).toEqual({
          valid: true,
          errors: [],
        })
        expect(result.metadata.proof_result_summary).toMatchObject({
          status: "split",
          split_required: true,
          child_count: 1,
          child_order: ["1:child-1"],
          recursion_depth: 1,
          max_recursion_depth: 4,
          stack_mode: "dfs_lifo",
        })
      },
    })
  })

  test("prover cannot delegate lemma before freezing a split in the theorem file", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Bun.write(`${tmp.path}/lemma.v`, "Lemma demo : True.\nProof.\n  exact I.\nQed.\n")

        const session = await Session.create({})
        const assistant = await createAssistantMessage(session.id, tmp.path)
        const tool = await TaskTool.init()

        await expect(
          tool.execute(
            {
              description: "Local gap",
              prompt: "Solve the local gap.",
              subagent_type: "lemma",
              lemma_assignment: {
                file: "lemma.v",
                theorem: "demo",
                admit_id: "gap-1",
                goal: "True",
                replace: "Replace only admit gap-1.",
                skeleton: "Proof skeleton.",
                done: "coqc lemma.v succeeds.",
              },
            },
            baseContext({
              sessionID: session.id,
              messageID: assistant.id,
            }),
          ),
        ).rejects.toThrow("fresh lemma delegation requires a proof_region owner: lemma")
      },
    })
  })

  test("prover cannot manually delegate a later proof_region before earlier regions are solved", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Bun.write(
          `${tmp.path}/lemma.v`,
          [
            "Lemma demo : True.",
            "Proof.",
            "(* proof_region begin owner: lemma admit_id: gap_1 theorem: demo kind: pointwise_semantic_bridge target: Hone *)",
            "have Hone : True.",
            "{ (* admit_id: gap_1 *)",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            "(* proof_region begin owner: lemma admit_id: gap_2 theorem: demo kind: pointwise_semantic_bridge target: Htwo *)",
            "have Htwo : True.",
            "{ (* admit_id: gap_2 *)",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_2 *)",
            "exact Hone.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const session = await Session.create({})
        const assistant = await createAssistantMessage(session.id, tmp.path)
        const tool = await TaskTool.init()

        await expect(
          tool.execute(
            {
              description: "Later gap",
              prompt: "Solve the later gap.",
              subagent_type: "lemma",
              lemma_assignment: {
                file: "lemma.v",
                theorem: "demo",
                admit_id: "gap_2",
                goal: "True",
                replace: "Replace only gap_2.",
                skeleton: "proof_region gap_2",
                done: "coqc lemma.v succeeds.",
              },
            },
            baseContext({
              sessionID: session.id,
              messageID: assistant.id,
            }),
          ),
        ).rejects.toThrow("next eligible proof_region is gap_1")

        SessionProofWorkflow.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("prover can delegate lemma after proof_plan and a persisted theorem-level edit", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const theoremFile = `${tmp.path}/lemma.v`
        await Bun.write(theoremFile, regionSource())

        const session = await Session.create({})
        const assistant = await createAssistantMessage(session.id, tmp.path)
        let promptInput: any

        await addCompletedToolPart({
          sessionID: session.id,
          messageID: assistant.id,
          tool: "proof_plan",
          callID: "proof-plan-2",
          toolInput: {
            source: "Step 1. Split off the local trivial goal.",
            theorem: "demo",
          },
        })
        await addCompletedToolPart({
          sessionID: session.id,
          messageID: assistant.id,
          tool: "edit",
          callID: "edit-2",
          toolInput: {
            filePath: theoremFile,
            oldString: "Proof.",
            newString: "Proof.",
          },
        })

        resolvePromptPartsSpy = spyOn(SessionPromptModule.SessionPrompt, "resolvePromptParts").mockImplementation(
          async (prompt) => [{ type: "text", text: prompt }] as any,
        )

        promptSpy = spyOn(SessionPromptModule.SessionPrompt, "prompt").mockImplementation(
          createPromptMock(async (input: any) => {
            promptInput = input
            const before = ProofEditTransaction.source(input.sessionID, theoremFile)
            expect(before).toBe(regionSource())
            const staged = before!.replace("  admit.", "  exact I.")
            ProofEditTransaction.stage({
              sessionID: input.sessionID,
              file: theoremFile,
              before: before!,
              after: staged,
            })
            return {
              parts: [
                {
                  type: "text",
                  text:
                    '<proof_result>{"status":"solved","goal_id":"goal-1","parent_goal_id":"goal-0","stack_mode":"dfs_lifo","informal_proof":"The gap is trivial.","split_required":false,"split_reason":"","children":[],"proof_text":"exact I.","used_helpers":[],"validation_plan":["coqc lemma.v"],"escalate_reason":""}</proof_result>',
                },
              ],
            } as any
          }),
        )

        const tool = await TaskTool.init()
        const result = await tool.execute(
          {
            description: "Local gap",
            prompt: "Solve the local gap.",
            subagent_type: "lemma",
            lemma_assignment: {
              file: "lemma.v",
              theorem: "demo",
              admit_id: "gap-1",
              goal: "True",
              proof_position: { line: 2, character: 4 },
              replace: "Replace only admit gap-1.",
              skeleton: "Proof.\n  admit.\nQed.",
              done: "coqc lemma.v succeeds.",
            },
          },
          baseContext({
            sessionID: session.id,
            messageID: assistant.id,
          }),
        )

        expect(promptInput.agent).toBe("lemma")
        const childBinding = SessionProof.get(result.metadata.sessionId as string)
        expect(childBinding?.file).toBe(theoremFile)
        expect(childBinding?.line).toBe(2)
        expect(childBinding?.character).toBe(0)
        expect(result.metadata.proof_result_validation).toEqual({ valid: true, errors: [] })
        expect(result.metadata.proof_edit_transaction).toMatchObject({
          status: "handed_off",
          handed_off: true,
          handoff_session_id: session.id,
          revision: 1,
        })
        expect(await Bun.file(theoremFile).text()).toBe(regionSource())
        expect(ProofEditTransaction.source(session.id, theoremFile)).toContain("  exact I.")

        ProofEditTransaction.abort(session.id)
        const childID = result.metadata.sessionId as string
        SessionProofWorkflow.clear(childID)
        SessionProof.clear(childID)
        await Session.remove(childID)
        SessionProofWorkflow.clear(session.id)
        SessionProof.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("lemma binding replaces an inherited stale canonical source with the current assigned source", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const theoremFile = `${tmp.path}/lemma.v`
        const oldSource = "Lemma demo : True.\nProof. exact I. Qed.\n"
        const currentSource = regionSource()
        await Bun.write(theoremFile, oldSource)

        const session = await Session.create({})
        const assistant = await createAssistantMessage(session.id, tmp.path)
        SessionProof.set(session.id, theoremFile, { line: 1, character: 0 }, "manual")
        await Bun.write(theoremFile, currentSource)

        await addCompletedToolPart({
          sessionID: session.id,
          messageID: assistant.id,
          tool: "proof_plan",
          callID: "proof-plan-rebound-source",
          toolInput: {
            source: "Step 1. Isolate the current local region.",
            theorem: "demo",
          },
        })
        await addCompletedToolPart({
          sessionID: session.id,
          messageID: assistant.id,
          tool: "edit",
          callID: "edit-rebound-source",
          toolInput: {
            filePath: theoremFile,
            oldString: "Proof.",
            newString: "Proof.",
          },
        })

        resolvePromptPartsSpy = spyOn(SessionPromptModule.SessionPrompt, "resolvePromptParts").mockImplementation(
          async (prompt) => [{ type: "text", text: prompt }] as any,
        )
        promptSpy = spyOn(SessionPromptModule.SessionPrompt, "prompt").mockImplementation(
          createPromptMock(async () => ({
            parts: [
              {
                type: "text",
                text: proofResult({
                  status: "escalate",
                  split_required: false,
                  split_reason: "",
                  children: [],
                  proof_text: "",
                  escalate_reason: "Return control after checking the binding.",
                  escalation_type: "not_local",
                }),
              },
            ],
          }) as any),
        )

        const tool = await TaskTool.init()
        const result = await tool.execute(
          {
            description: "Rebind current region",
            prompt: "Inspect the current assigned region.",
            subagent_type: "lemma",
            lemma_assignment: regionLemmaAssignment(),
          },
          baseContext({ sessionID: session.id, messageID: assistant.id }),
        )

        const childID = result.metadata.sessionId as string
        const childBinding = SessionProof.get(childID)
        expect(childBinding?.canonicalSource).toBe(currentSource)
        expect(() =>
          SessionProofWorkflow.assertBoundProofBodyMutationAllowed({
            sessionID: childID,
            file: theoremFile,
            before: currentSource,
            after: currentSource.replace("  admit.", "  exact I."),
          }),
        ).not.toThrow()

        SessionProofWorkflow.clear(childID)
        SessionProof.clear(childID)
        await Session.remove(childID)
        SessionProofWorkflow.clear(session.id)
        SessionProof.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("lemma proof_result schema records region metadata and rejects malformed remodel results", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const theoremFile = `${tmp.path}/lemma.v`
        await Bun.write(theoremFile, regionSource())

        const session = await Session.create({})
        const assistant = await createAssistantMessage(session.id, tmp.path)
        const traceSpy = spyOn(Trace, "event").mockImplementation(async () => {})
        const prompts = [
          proofResult({
            status: "escalate",
            split_required: false,
            split_reason: "",
            children: [],
            proof_text: "",
            escalate_reason: "The exported target needs a preceding same-region bridge.",
            escalation_type: "needs_subgoal_remodel",
            remodel_request: {
              current_target: "assert (Hxxx : True).",
              why_current_target_is_wrong: "The target omits a bridge fact needed by the local proof.",
              proposed_preceding_helper: "assert (Hyyy : True).",
              proposed_region_shape: "Introduce Hyyy before Hxxx inside the same proof_region.",
              should_lift_to_theorem_level: false,
            },
            changed_region_summary: "No edits outside the assigned proof_region.",
          }),
          proofResult({
            status: "escalate",
            split_required: false,
            split_reason: "",
            children: [],
            proof_text: "",
            escalate_reason: "The target is misshaped.",
            escalation_type: "needs_subgoal_remodel",
          }),
          proofResult({
            status: "solved",
            split_required: false,
            split_reason: "",
            children: [],
            proof_text: "exact I.",
            escalate_reason: "",
            remodel_request: {
              current_target: "assert (Hxxx : True).",
              why_current_target_is_wrong: "Solved results must not ask for remodel.",
              should_lift_to_theorem_level: false,
            },
          }),
        ]

        await addCompletedToolPart({
          sessionID: session.id,
          messageID: assistant.id,
          tool: "proof_plan",
          callID: "proof-plan-region",
          toolInput: {
            source: "Step 1. Isolate the local bridge region.",
            theorem: "demo",
          },
        })
        await addCompletedToolPart({
          sessionID: session.id,
          messageID: assistant.id,
          tool: "edit",
          callID: "edit-region",
          toolInput: {
            filePath: theoremFile,
            oldString: "Proof.",
            newString: "Proof.",
          },
        })

        resolvePromptPartsSpy = spyOn(SessionPromptModule.SessionPrompt, "resolvePromptParts").mockImplementation(
          async (prompt) => [{ type: "text", text: prompt }] as any,
        )
        promptSpy = spyOn(SessionPromptModule.SessionPrompt, "prompt").mockImplementation(
          createPromptMock(async () => ({
            parts: [{ type: "text", text: prompts.shift() }],
          }) as any),
        )

        const tool = await TaskTool.init()
        const assignment = regionLemmaAssignment()
        const valid = await tool.execute(
          {
            description: "Region remodel",
            prompt: "Solve or remodel the region.",
            subagent_type: "lemma",
            lemma_assignment: assignment,
          },
          baseContext({ sessionID: session.id, messageID: assistant.id, callID: "task-region-valid" }),
        )

        expect(valid.metadata.proof_result_validation).toEqual({ valid: true, errors: [] })
        expect(valid.metadata.proof_result_summary).toMatchObject({
          status: "escalate",
          escalation_type: "needs_subgoal_remodel",
          changed_region_summary: "No edits outside the assigned proof_region.",
        })
        expect(valid.metadata.proof_result_trace).toMatchObject({
          task_id: valid.metadata.sessionId,
          obligation_kind: "pointwise_semantic_bridge",
          editable_region_mode: "region",
          escalation_type: "needs_subgoal_remodel",
        })
        expect(traceSpy.mock.calls[0]?.[0]).toBe(session.id)
        expect(traceSpy.mock.calls[0]?.[1]).toBe("lemma-proof-result")
        expect(traceSpy.mock.calls[0]?.[2]).toMatchObject({
          obligation_kind: "pointwise_semantic_bridge",
          editable_region_mode: "region",
          escalation_type: "needs_subgoal_remodel",
        })

        const missingRemodel = await tool.execute(
          {
            description: "Region remodel invalid",
            prompt: "Escalate without remodel.",
            subagent_type: "lemma",
            lemma_assignment: assignment,
          },
          baseContext({ sessionID: session.id, messageID: assistant.id, callID: "task-region-invalid" }),
        )
        expect(missingRemodel.metadata.proof_result_validation).toEqual({
          valid: false,
          errors: ["remodel_request: needs_subgoal_remodel proof_result requires remodel_request"],
        })

        const solvedWithRemodel = await tool.execute(
          {
            description: "Region solved invalid",
            prompt: "Solve but include remodel.",
            subagent_type: "lemma",
            lemma_assignment: assignment,
          },
          baseContext({ sessionID: session.id, messageID: assistant.id, callID: "task-region-solved-invalid" }),
        )
        expect(solvedWithRemodel.metadata.proof_result_validation).toEqual({
          valid: false,
          errors: ["remodel_request: solved proof_result must not include remodel_request"],
        })

        traceSpy.mockRestore()
      },
    })
  })

  test("fixer task execution disables recursive task calls", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const assistant = await createAssistantMessage(session.id, tmp.path)
        let promptInput: any

        resolvePromptPartsSpy = spyOn(SessionPromptModule.SessionPrompt, "resolvePromptParts").mockImplementation(
          async (prompt) => [{ type: "text", text: prompt }] as any,
        )

        promptSpy = spyOn(SessionPromptModule.SessionPrompt, "prompt").mockImplementation(
          createPromptMock(async (input: any) => {
            promptInput = input
            return {
              parts: [{ type: "text", text: "<fix>apply the narrow local repair</fix>" }],
            } as any
          }),
        )

        const tool = await TaskTool.init()
        const result = await tool.execute(
          {
            description: "Repair local script",
            prompt: "Repair only the local script.",
            subagent_type: "fixer",
          },
          baseContext({
            sessionID: session.id,
            messageID: assistant.id,
          }),
        )

        expect(promptInput.agent).toBe("fixer")
        expect(promptInput.tools.task).toBe(false)
        expect(result.metadata.fixer).toEqual({
          action: "fix",
          detail: "apply the narrow local repair",
        })
      },
    })
  })

  test("injects recovered proof transaction metadata before resolving a fresh child prompt", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const oldChild = await Session.create({ parentID: parent.id })
        const assistant = await createAssistantMessage(parent.id, tmp.path)
        const theoremFile = `${tmp.path}/recover.v`
        const source = "Lemma demo : True.\nProof.\n  admit.\nAdmitted.\n"
        const staged = source.replace("  admit.", "  pose proof I as staged_fact.\n  admit.")
        await Bun.write(theoremFile, source)
        SessionProof.set(parent.id, theoremFile, { line: 1, character: 0 }, "manual")

        await ProofEditTransaction.begin({
          sessionID: oldChild.id,
          parentSessionID: parent.id,
          agent: "fixer",
          file: theoremFile,
          source,
          scope: { kind: "theorem_body", theorem: "demo" },
        })
        ProofEditTransaction.stage({
          sessionID: oldChild.id,
          file: theoremFile,
          before: source,
          after: staged,
        })
        expect((await ProofEditTransaction.finalize(oldChild.id))?.status).toBe("recoverable")

        let resolvedPrompt = ""
        resolvePromptPartsSpy = spyOn(SessionPromptModule.SessionPrompt, "resolvePromptParts").mockImplementation(
          async (prompt) => {
            resolvedPrompt = prompt
            return [{ type: "text", text: prompt }] as any
          },
        )
        promptSpy = spyOn(SessionPromptModule.SessionPrompt, "prompt").mockImplementation(
          createPromptMock(async () => ({
            parts: [{ type: "text", text: "<fix>continue the staged repair</fix>" }],
          }) as any),
        )

        const tool = await TaskTool.init()
        const result = await tool.execute(
          {
            description: "Resume staged repair",
            prompt: "Continue the current local repair.",
            subagent_type: "fixer",
          },
          baseContext({ sessionID: parent.id, messageID: assistant.id }),
        )

        expect(result.metadata.proof_edit_transaction_start).toMatchObject({
          recovered: true,
          revision: 1,
          staged: true,
        })
        expect(resolvedPrompt).toContain("<proof-edit-transaction-recovery>")
        expect(resolvedPrompt).toContain("revision: 1")
        expect(resolvedPrompt).toContain("The staged source exposed by read/edit/checkpoint tools is authoritative")

        const childID = result.metadata.sessionId as string
        SessionProofWorkflow.clear(childID)
        SessionProof.clear(childID)
        await Session.remove(childID)
        SessionProof.clear(parent.id)
        await Session.remove(oldChild.id)
        await Session.remove(parent.id)
      },
    })
  })

  test("task-created proof worker sessions cannot dispatch nested proof workers", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const assistant = await createAssistantMessage(session.id, tmp.path)

        resolvePromptPartsSpy = spyOn(SessionPromptModule.SessionPrompt, "resolvePromptParts").mockImplementation(
          async (prompt) => [{ type: "text", text: prompt }] as any,
        )
        promptSpy = spyOn(SessionPromptModule.SessionPrompt, "prompt").mockImplementation(
          createPromptMock(async () => ({
            parts: [{ type: "text", text: "<fix>Completed the assigned proof task.</fix>" }],
          }) as any),
        )

        const tool = await TaskTool.init()
        const result = await tool.execute(
          {
            description: "Complete local proof",
            prompt: "Complete the assigned proof only.",
            subagent_type: "fixer",
          },
          baseContext({ sessionID: session.id, messageID: assistant.id, callID: "task-coq-prover-leaf" }),
        )

        const childID = result.metadata.sessionId as string
        const explorer = await SessionProofWorkflow.assertProofTaskDispatchAllowed({
          sessionID: childID,
          subagentType: "explorer",
          proofProducing: false,
        })
        expect(explorer.decision).toBe("allowed_non_proof_task")

        for (const subagentType of ["coq-prover", "fixer", "prover", "lemma"]) {
          await expect(
            SessionProofWorkflow.assertProofTaskDispatchAllowed({
              sessionID: childID,
              subagentType,
              proofProducing: true,
            }),
          ).rejects.toThrow("cannot launch unscoped nested proof task")
        }

        SessionProofWorkflow.clear(childID)
        SessionProof.clear(childID)
        await Session.remove(childID)
        await Session.remove(session.id)
      },
    })
  })

  test("context audits are trusted only when recorded by the live child coq session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const theoremFile = `${tmp.path}/lemma.v`
        await Bun.write(theoremFile, regionSource())

        const session = await Session.create({})
        const assistant = await createAssistantMessage(session.id, tmp.path, "architect")
        SessionProof.set(session.id, theoremFile, { line: 1, character: 0 }, "manual")

        resolvePromptPartsSpy = spyOn(SessionPromptModule.SessionPrompt, "resolvePromptParts").mockImplementation(
          async (prompt) => [{ type: "text", text: prompt }] as any,
        )
        promptSpy = spyOn(SessionPromptModule.SessionPrompt, "prompt").mockImplementation(
          createPromptMock(async () => ({
            parts: [
              {
                type: "text",
                text: proofResult({
                  status: "escalate",
                  split_required: false,
                  split_reason: "",
                  children: [],
                  proof_text: "",
                  escalate_reason: "A hidden argument appears to need an explicit bridge.",
                  escalation_type: "needs_context_strengthening",
                  attempt_report: {
                    informal_proof_summary: "Expose the hidden argument and bridge the two forms.",
                    validated_fragments: [],
                    failed_tactics_or_edits: ["reflexivity failed"],
                    stable_blocker_goal: "True",
                    context_mismatch_basis: "hidden_arguments",
                    context_audit: {
                      audit_id: "forged_audit",
                      outcome: "convertible",
                      inspected_symbols: [],
                      left_expression: "True",
                      right_expression: "True",
                      left_summary: "True",
                      right_summary: "True",
                      goal_fingerprint: "forged_goal",
                      hypotheses_fingerprint: "forged_hypotheses",
                      verified: true,
                    },
                    proposed_children: [],
                    recommended_action: "strengthen_context",
                  },
                }),
              },
            ],
          }) as any),
        )

        const tool = await TaskTool.init()
        const result = await tool.execute(
          {
            description: "Audit hidden context",
            prompt: "Try the local bridge and report evidence.",
            subagent_type: "lemma",
            lemma_assignment: regionLemmaAssignment(),
          },
          baseContext({
            sessionID: session.id,
            messageID: assistant.id,
            agent: "architect",
          }),
        )

        expect(result.metadata.context_audit_review).toMatchObject({
          applicable: true,
          audit_id: "forged_audit",
          verified: false,
          outcome: "convertible",
          action: "resume_once_for_targeted_local_evidence",
        })
        expect(result.metadata.proof_result_summary?.attempt_report?.context_audit?.verified).toBe(false)

        const childID = result.metadata.sessionId as string
        SessionProofWorkflow.clear(childID)
        SessionProof.clear(childID)
        await Session.remove(childID)
        SessionProofWorkflow.clear(session.id)
        SessionProof.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("task tool blocks an untagged proof helper but allows the exact active repair assignment", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const theoremFile = `${tmp.path}/repair.v`
        const source = [
          "Lemma demo : True.",
          "Proof.",
          "(* proof_region begin owner: lemma admit_id: gap-1 theorem: demo kind: pointwise_semantic_bridge target: Hxxx *)",
          "assert (Hxxx : True).",
          "{ admit. }",
          "(* proof_region end admit_id: gap-1 *)",
          "exact Hxxx.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(theoremFile, source)

        const session = await Session.create({})
        const assistant = await createAssistantMessage(session.id, tmp.path)
        SessionProof.set(session.id, theoremFile, { line: 1, character: 0 }, "manual")
        const scheduled = await SessionProofWorkflow.planNextSubtask(session.id, [])
        const repair = scheduled?.proof_repair_assignment
        expect(repair).toBeDefined()

        let resolvedRepairPrompt = ""
        resolvePromptPartsSpy = spyOn(SessionPromptModule.SessionPrompt, "resolvePromptParts").mockImplementation(
          async (prompt) => {
            resolvedRepairPrompt = prompt
            return [{ type: "text", text: prompt }] as any
          },
        )
        promptSpy = spyOn(SessionPromptModule.SessionPrompt, "prompt").mockImplementation(
          createPromptMock(async () => ({
            parts: [{ type: "text", text: "<fix>apply the assigned theorem repair</fix>" }],
          }) as any),
        )

        const tool = await TaskTool.init()
        await expect(
          tool.execute(
            {
              description: "Bypass active repair",
              prompt: "Try an untagged proof repair.",
              subagent_type: "fixer",
            },
            baseContext({ sessionID: session.id, messageID: assistant.id, callID: "task-untagged-repair" }),
          ),
        ).rejects.toThrow("proof_task_dispatch_blocked")
        expect(promptSpy).toHaveBeenCalledTimes(0)

        const allowed = await tool.execute(
          {
            description: "Continue active repair",
            prompt: "Apply only the assigned theorem repair.",
            subagent_type: "fixer",
            proof_repair_assignment: repair,
          },
          baseContext({ sessionID: session.id, messageID: assistant.id, callID: "task-matching-repair" }),
        )
        expect(allowed.metadata.proof_task_dispatch.decision).toBe("allowed_matching_repair")
        expect(promptSpy).toHaveBeenCalledTimes(1)
        expect(resolvedRepairPrompt).toContain("<proof-repair-handoff>")
        expect(resolvedRepairPrompt).toContain('"staged_region"')
        expect(resolvedRepairPrompt).toContain('"certified_dependencies"')
        expect(resolvedRepairPrompt).toContain('"forbidden_routes"')
        expect(resolvedRepairPrompt).toContain('"generic_route_recipe"')
        expect(resolvedRepairPrompt).toContain("Use as a shape-level planning prior")
        expect(allowed.metadata.proof_edit_transaction).toMatchObject({
          status: "handed_off",
          handed_off: true,
          handoff_session_id: session.id,
        })
        expect(ProofEditTransaction.active(session.id)).toMatchObject({
          handed_off: true,
          scope: "theorem_body",
        })

        const childID = allowed.metadata.sessionId as string
        ProofEditTransaction.abort(session.id)
        SessionProofWorkflow.clear(childID)
        SessionProof.clear(childID)
        await Session.remove(childID)
        SessionProofWorkflow.clear(session.id)
        SessionProof.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })
})
