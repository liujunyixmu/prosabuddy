import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { MessageV2 } from "../../src/session/message-v2"
import type { Provider } from "../../src/provider/provider"

const sessionID = "session"
const model: Provider.Model = {
  id: "test-model",
  providerID: "test",
  api: {
    id: "test-model",
    url: "https://example.com",
    npm: "@ai-sdk/openai",
  },
  name: "Test Model",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    output: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    interleaved: false,
  },
  cost: {
    input: 0,
    output: 0,
    cache: {
      read: 0,
      write: 0,
    },
  },
  limit: {
    context: 0,
    input: 0,
    output: 0,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

function userInfo(id: string): MessageV2.User {
  return {
    id,
    sessionID,
    role: "user",
    time: { created: 0 },
    agent: "user",
    model: { providerID: "test", modelID: "test" },
    tools: {},
    mode: "",
  } as unknown as MessageV2.User
}

function assistantInfo(
  id: string,
  parentID: string,
  error?: MessageV2.Assistant["error"],
  meta?: { providerID: string; modelID: string },
): MessageV2.Assistant {
  const infoModel = meta ?? { providerID: model.providerID, modelID: model.api.id }
  return {
    id,
    sessionID,
    role: "assistant",
    time: { created: 0 },
    error,
    parentID,
    modelID: infoModel.modelID,
    providerID: infoModel.providerID,
    mode: "",
    agent: "agent",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  } as unknown as MessageV2.Assistant
}

function basePart(messageID: string, id: string) {
  return {
    id,
    sessionID,
    messageID,
  }
}

describe("session.message-v2.toModelMessage", () => {
  test("filters out messages with no parts", () => {
    const input: MessageV2.WithParts[] = [
      {
        info: userInfo("m-empty"),
        parts: [],
      },
      {
        info: userInfo("m-user"),
        parts: [
          {
            ...basePart("m-user", "p1"),
            type: "text",
            text: "hello",
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(MessageV2.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
    ])
  })

  test("filters out messages with only ignored parts", () => {
    const messageID = "m-user"

    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(messageID),
        parts: [
          {
            ...basePart(messageID, "p1"),
            type: "text",
            text: "ignored",
            ignored: true,
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(MessageV2.toModelMessages(input, model)).toStrictEqual([])
  })

  test("includes synthetic text parts", () => {
    const messageID = "m-user"

    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(messageID),
        parts: [
          {
            ...basePart(messageID, "p1"),
            type: "text",
            text: "hello",
            synthetic: true,
          },
        ] as MessageV2.Part[],
      },
      {
        info: assistantInfo("m-assistant", messageID),
        parts: [
          {
            ...basePart("m-assistant", "a1"),
            type: "text",
            text: "assistant",
            synthetic: true,
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(MessageV2.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "assistant" }],
      },
    ])
  })

  test("converts user text/file parts and injects compaction/subtask prompts", () => {
    const messageID = "m-user"

    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(messageID),
        parts: [
          {
            ...basePart(messageID, "p1"),
            type: "text",
            text: "hello",
          },
          {
            ...basePart(messageID, "p2"),
            type: "text",
            text: "ignored",
            ignored: true,
          },
          {
            ...basePart(messageID, "p3"),
            type: "file",
            mime: "image/png",
            filename: "img.png",
            url: "https://example.com/img.png",
          },
          {
            ...basePart(messageID, "p4"),
            type: "file",
            mime: "text/plain",
            filename: "note.txt",
            url: "https://example.com/note.txt",
          },
          {
            ...basePart(messageID, "p5"),
            type: "file",
            mime: "application/x-directory",
            filename: "dir",
            url: "https://example.com/dir",
          },
          {
            ...basePart(messageID, "p6"),
            type: "compaction",
            auto: true,
          },
          {
            ...basePart(messageID, "p7"),
            type: "subtask",
            prompt: "prompt",
            description: "desc",
            agent: "agent",
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(MessageV2.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "hello" },
          {
            type: "file",
            mediaType: "image/png",
            filename: "img.png",
            data: "https://example.com/img.png",
          },
          { type: "text", text: "What did we do so far?" },
          { type: "text", text: "The following tool was executed by the user" },
        ],
      },
    ])
  })

  test("converts assistant tool completion into tool-call + tool-result messages with attachments", () => {
    const userID = "m-user"
    const assistantID = "m-assistant"

    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "u1"),
            type: "text",
            text: "run tool",
          },
        ] as MessageV2.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [
          {
            ...basePart(assistantID, "a1"),
            type: "text",
            text: "done",
            metadata: { openai: { assistant: "meta" } },
          },
          {
            ...basePart(assistantID, "a2"),
            type: "tool",
            callID: "call-1",
            tool: "bash",
            state: {
              status: "completed",
              input: { cmd: "ls" },
              output: "ok",
              title: "Bash",
              metadata: {},
              time: { start: 0, end: 1 },
              attachments: [
                {
                  ...basePart(assistantID, "file-1"),
                  type: "file",
                  mime: "image/png",
                  filename: "attachment.png",
                  url: "data:image/png;base64,Zm9v",
                },
              ],
            },
            metadata: { openai: { tool: "meta" } },
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(MessageV2.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "run tool" }],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "done", providerOptions: { openai: { assistant: "meta" } } },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "bash",
            input: { cmd: "ls" },
            providerExecuted: undefined,
            providerOptions: { openai: { tool: "meta" } },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "bash",
            output: {
              type: "content",
              value: [
                { type: "text", text: "ok" },
                { type: "media", mediaType: "image/png", data: "Zm9v" },
              ],
            },
            providerOptions: { openai: { tool: "meta" } },
          },
        ],
      },
    ])
  })

  test("shortens large heavy tool outputs deterministically when cache projection is enabled", () => {
    const userID = "m-user"
    const assistantID = "m-assistant"
    const oldOutput = "old-start\n" + "x".repeat(2_000) + "\nold-end"
    const recentOutput = "recent output stays complete"

    const toolPart = (id: string, callID: string, output: string): MessageV2.ToolPart => ({
      ...basePart(assistantID, id),
      type: "tool",
      callID,
      tool: "read",
      state: {
        status: "completed",
        input: { filePath: "proof.v" },
        output,
        title: "Read",
        metadata: {},
        time: { start: 0, end: 1 },
      },
    })

    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "u1"),
            type: "text",
            text: "inspect proof",
          },
        ] as MessageV2.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [toolPart("a1", "call-old", oldOutput), toolPart("a2", "call-recent", recentOutput)],
      },
    ]

    const output = MessageV2.toModelMessages(input, model, {
      cache: { enabled: true, preserveRecentToolResults: 1, maxToolOutputChars: 60 },
    })

    const toolMessage = output[2]
    expect(toolMessage.role).toBe("tool")
    if (toolMessage.role !== "tool" || typeof toolMessage.content === "string") return

    const oldToolResult = toolMessage.content[0]
    const recentToolResult = toolMessage.content[1]
    expect(oldToolResult.type).toBe("tool-result")
    expect(recentToolResult.type).toBe("tool-result")
    if (oldToolResult.type !== "tool-result" || recentToolResult.type !== "tool-result") return

    expect(oldToolResult.output).toMatchObject({ type: "text" })
    expect(recentToolResult.output).toMatchObject({ type: "text", value: recentOutput })
    if (oldToolResult.output.type !== "text") return
    expect(oldToolResult.output.value).toContain("Large read tool result shortened deterministically")
    expect(oldToolResult.output.value).toContain("old-start")
    expect(oldToolResult.output.value).toContain("old-end")
    expect(oldToolResult.output.value.length).toBeLessThan(oldOutput.length)
  })

  test("keeps the projected prefix byte-stable when later tool results are appended", () => {
    const userID = "m-user"
    const assistantID = "m-assistant"
    const toolPart = (id: string, callID: string, output: string): MessageV2.ToolPart => ({
      ...basePart(assistantID, id),
      type: "tool",
      callID,
      tool: "coqtop",
      state: {
        status: "completed",
        input: { command: `Check ${callID}.` },
        output,
        title: "coqtop",
        metadata: {},
        time: { start: 0, end: 1 },
      },
    })
    const first: MessageV2.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [{ ...basePart(userID, "u1"), type: "text", text: "prove it" }] as MessageV2.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [toolPart("a1", "call-1", `goal-start\n${"x".repeat(2_000)}\ngoal-end`)],
      },
    ]
    const options = { cache: { enabled: true, maxProofToolOutputChars: 100 } }
    const before = MessageV2.toModelMessages(first, model, options)
    const after = MessageV2.toModelMessages(
      [
        ...first,
        {
          info: assistantInfo("m-assistant-2", userID),
          parts: [toolPart("a2", "call-2", `new-start\n${"y".repeat(2_000)}\nnew-end`)],
        },
      ],
      model,
      options,
    )

    expect(after.slice(0, before.length)).toStrictEqual(before)
  })

  test("deterministically shortens large assistant text and reasoning while preserving their boundaries", () => {
    const userID = "m-user"
    const assistantID = "m-assistant"
    const longText = `text-head\n${"t".repeat(2_000)}\ntext-tail`
    const longReasoning = `reason-head\n${"r".repeat(3_000)}\nreason-tail`
    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [{ ...basePart(userID, "u1"), type: "text", text: "prove it" }] as MessageV2.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [
          { ...basePart(assistantID, "a1"), type: "reasoning", text: longReasoning, time: { start: 0, end: 1 } },
          { ...basePart(assistantID, "a2"), type: "text", text: longText },
        ] as MessageV2.Part[],
      },
    ]
    const output = MessageV2.toModelMessages(input, model, {
      cache: { enabled: true, maxAssistantTextChars: 100, maxReasoningChars: 120 },
    })
    const assistant = output[1]
    expect(assistant.role).toBe("assistant")
    if (assistant.role !== "assistant" || typeof assistant.content === "string") return
    const reasoning = assistant.content.find((part) => part.type === "reasoning")
    const text = assistant.content.find((part) => part.type === "text")
    expect(reasoning?.type).toBe("reasoning")
    expect(text?.type).toBe("text")
    if (reasoning?.type !== "reasoning" || text?.type !== "text") return
    expect(reasoning.text).toContain("reason-head")
    expect(reasoning.text).toContain("reason-tail")
    expect(reasoning.text).toContain("shortened deterministically")
    expect(text.text).toContain("text-head")
    expect(text.text).toContain("text-tail")
    expect(text.text).toContain("shortened deterministically")
  })

  test("uses edit-specific cache projection limit for large edit outputs", () => {
    const userID = "m-user"
    const assistantID = "m-assistant"
    const oldOutput = "edit-start\n" + "x".repeat(2_000) + "\nedit-end"
    const recentOutput = "recent read output stays complete"

    const toolPart = (id: string, callID: string, toolName: string, output: string): MessageV2.ToolPart => ({
      ...basePart(assistantID, id),
      type: "tool",
      callID,
      tool: toolName,
      state: {
        status: "completed",
        input: toolName === "edit" ? { filePath: "proof.v" } : { pattern: "Lemma" },
        output,
        title: toolName,
        metadata: {},
        time: { start: 0, end: 1 },
      },
    })

    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "u1"),
            type: "text",
            text: "edit proof",
          },
        ] as MessageV2.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [toolPart("a1", "call-edit", "edit", oldOutput), toolPart("a2", "call-read", "read", recentOutput)],
      },
    ]

    const output = MessageV2.toModelMessages(input, model, {
      cache: { enabled: true, preserveRecentToolResults: 1, maxToolOutputChars: 1_000, maxEditToolOutputChars: 80 },
    })

    const toolMessage = output[2]
    expect(toolMessage.role).toBe("tool")
    if (toolMessage.role !== "tool" || typeof toolMessage.content === "string") return

    const editToolResult = toolMessage.content[0]
    const recentToolResult = toolMessage.content[1]
    expect(editToolResult.type).toBe("tool-result")
    expect(recentToolResult.type).toBe("tool-result")
    if (editToolResult.type !== "tool-result" || recentToolResult.type !== "tool-result") return

    expect(editToolResult.output).toMatchObject({ type: "text" })
    expect(recentToolResult.output).toMatchObject({ type: "text", value: recentOutput })
    if (editToolResult.output.type !== "text") return
    expect(editToolResult.output.value).toContain("Large edit tool result shortened deterministically")
    expect(editToolResult.output.value.length).toBeLessThan(1_000)
  })

  test("shortens large edit tool inputs when cache projection is enabled", () => {
    const userID = "m-user"
    const assistantID = "m-assistant"
    const oldString = "old-start\n" + "x".repeat(2_000) + "\nold-end"
    const newString = "new-start\n" + "y".repeat(2_000) + "\nnew-end"

    const toolPart = (id: string, callID: string, input: Record<string, unknown>): MessageV2.ToolPart => ({
      ...basePart(assistantID, id),
      type: "tool",
      callID,
      tool: "edit",
      state: {
        status: "completed",
        input,
        output: "ok",
        title: "edit",
        metadata: {},
        time: { start: 0, end: 1 },
      },
    })

    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "u1"),
            type: "text",
            text: "edit proof",
          },
        ] as MessageV2.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [
          toolPart("a1", "call-old", { filePath: "proof.v", oldString, newString }),
          toolPart("a2", "call-recent", { filePath: "proof.v", oldString: "recent old", newString: "recent new" }),
        ],
      },
    ]

    const output = MessageV2.toModelMessages(input, model, {
      cache: { enabled: true, preserveRecentToolResults: 1, maxEditToolInputChars: 120 },
    })

    const assistantMessage = output[1]
    expect(assistantMessage.role).toBe("assistant")
    if (assistantMessage.role !== "assistant" || typeof assistantMessage.content === "string") return

    const oldToolCall = assistantMessage.content[0]
    const recentToolCall = assistantMessage.content[1]
    expect(oldToolCall.type).toBe("tool-call")
    expect(recentToolCall.type).toBe("tool-call")
    if (oldToolCall.type !== "tool-call" || recentToolCall.type !== "tool-call") return

    const oldInput = oldToolCall.input as Record<string, string>
    const recentInput = recentToolCall.input as Record<string, string>
    expect(oldInput.oldString).toContain("Large edit tool input oldString shortened deterministically")
    expect(oldInput.newString).toContain("Large edit tool input newString shortened deterministically")
    expect(oldInput.oldString.length).toBeLessThan(oldString.length)
    expect(oldInput.newString.length).toBeLessThan(newString.length)
    expect(recentInput.oldString).toBe("recent old")
    expect(recentInput.newString).toBe("recent new")
  })

  test("uses stable edit projection for large multiedit inputs and outputs", () => {
    const userID = "m-user"
    const assistantID = "m-assistant"
    const oldOutput = "multi-start\n" + "x".repeat(2_000) + "\nmulti-end"
    const oldString = "old-start\n" + "o".repeat(2_000) + "\nold-end"
    const newString = "new-start\n" + "n".repeat(2_000) + "\nnew-end"

    const toolPart = (id: string, callID: string, output: string): MessageV2.ToolPart => ({
      ...basePart(assistantID, id),
      type: "tool",
      callID,
      tool: "multiedit",
      state: {
        status: "completed",
        input: {
          filePath: "proof.v",
          edits: [{ oldString, newString, replaceAll: false }],
        },
        output,
        title: "multiedit",
        metadata: {},
        time: { start: 0, end: 1 },
      },
    })

    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "u1"),
            type: "text",
            text: "edit proof",
          },
        ] as MessageV2.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [toolPart("a1", "call-old", oldOutput), toolPart("a2", "call-recent", "recent output")],
      },
    ]

    const output = MessageV2.toModelMessages(input, model, {
      cache: { enabled: true, preserveRecentToolResults: 1, maxEditToolOutputChars: 100, maxEditToolInputChars: 120 },
    })

    const assistantMessage = output[1]
    expect(assistantMessage.role).toBe("assistant")
    if (assistantMessage.role !== "assistant" || typeof assistantMessage.content === "string") return
    const oldToolCall = assistantMessage.content[0]
    expect(oldToolCall.type).toBe("tool-call")
    if (oldToolCall.type !== "tool-call") return

    const oldInput = oldToolCall.input as { edits: Array<Record<string, string>>; cacheProjection?: string }
    expect(oldInput.cacheProjection).toContain("Large multiedit tool input shortened deterministically")
    expect(oldInput.edits[0]?.oldString).toContain("Large multiedit tool input oldString shortened deterministically")
    expect(oldInput.edits[0]?.newString).toContain("Large multiedit tool input newString shortened deterministically")

    const toolMessage = output[2]
    expect(toolMessage.role).toBe("tool")
    if (toolMessage.role !== "tool" || typeof toolMessage.content === "string") return
    const oldToolResult = toolMessage.content[0]
    expect(oldToolResult.type).toBe("tool-result")
    if (oldToolResult.type !== "tool-result") return
    expect(oldToolResult.output).toMatchObject({ type: "text" })
    if (oldToolResult.output.type !== "text") return
    expect(oldToolResult.output.value).toContain("Large multiedit tool result shortened deterministically")
    expect(oldToolResult.output.value.length).toBeLessThan(1_000)
  })

  test("omits provider metadata when assistant model differs", () => {
    const userID = "m-user"
    const assistantID = "m-assistant"

    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "u1"),
            type: "text",
            text: "run tool",
          },
        ] as MessageV2.Part[],
      },
      {
        info: assistantInfo(assistantID, userID, undefined, { providerID: "other", modelID: "other" }),
        parts: [
          {
            ...basePart(assistantID, "a1"),
            type: "text",
            text: "done",
            metadata: { openai: { assistant: "meta" } },
          },
          {
            ...basePart(assistantID, "a2"),
            type: "tool",
            callID: "call-1",
            tool: "bash",
            state: {
              status: "completed",
              input: { cmd: "ls" },
              output: "ok",
              title: "Bash",
              metadata: {},
              time: { start: 0, end: 1 },
            },
            metadata: { openai: { tool: "meta" } },
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(MessageV2.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "run tool" }],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "done" },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "bash",
            input: { cmd: "ls" },
            providerExecuted: undefined,
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "bash",
            output: { type: "text", value: "ok" },
          },
        ],
      },
    ])
  })

  test("replaces compacted tool output with placeholder", () => {
    const userID = "m-user"
    const assistantID = "m-assistant"

    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "u1"),
            type: "text",
            text: "run tool",
          },
        ] as MessageV2.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [
          {
            ...basePart(assistantID, "a1"),
            type: "tool",
            callID: "call-1",
            tool: "bash",
            state: {
              status: "completed",
              input: { cmd: "ls" },
              output: "this should be cleared",
              title: "Bash",
              metadata: {},
              time: { start: 0, end: 1, compacted: 1 },
            },
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(MessageV2.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "run tool" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "bash",
            input: { cmd: "ls" },
            providerExecuted: undefined,
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "bash",
            output: { type: "text", value: "[Old tool result content cleared]" },
          },
        ],
      },
    ])
  })

  test("converts assistant tool error into error-text tool result", () => {
    const userID = "m-user"
    const assistantID = "m-assistant"

    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "u1"),
            type: "text",
            text: "run tool",
          },
        ] as MessageV2.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [
          {
            ...basePart(assistantID, "a1"),
            type: "tool",
            callID: "call-1",
            tool: "bash",
            state: {
              status: "error",
              input: { cmd: "ls" },
              error: "nope",
              time: { start: 0, end: 1 },
              metadata: {},
            },
            metadata: { openai: { tool: "meta" } },
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(MessageV2.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "run tool" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "bash",
            input: { cmd: "ls" },
            providerExecuted: undefined,
            providerOptions: { openai: { tool: "meta" } },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "bash",
            output: { type: "error-text", value: "nope" },
            providerOptions: { openai: { tool: "meta" } },
          },
        ],
      },
    ])
  })

  test("filters assistant messages with non-abort errors", () => {
    const assistantID = "m-assistant"

    const input: MessageV2.WithParts[] = [
      {
        info: assistantInfo(
          assistantID,
          "m-parent",
          new MessageV2.APIError({ message: "boom", isRetryable: true }).toObject() as MessageV2.APIError,
        ),
        parts: [
          {
            ...basePart(assistantID, "a1"),
            type: "text",
            text: "should not render",
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(MessageV2.toModelMessages(input, model)).toStrictEqual([])
  })

  test("includes aborted assistant messages only when they have non-step-start/reasoning content", () => {
    const assistantID1 = "m-assistant-1"
    const assistantID2 = "m-assistant-2"

    const aborted = new MessageV2.AbortedError({ message: "aborted" }).toObject() as MessageV2.Assistant["error"]

    const input: MessageV2.WithParts[] = [
      {
        info: assistantInfo(assistantID1, "m-parent", aborted),
        parts: [
          {
            ...basePart(assistantID1, "a1"),
            type: "reasoning",
            text: "thinking",
            time: { start: 0 },
          },
          {
            ...basePart(assistantID1, "a2"),
            type: "text",
            text: "partial answer",
          },
        ] as MessageV2.Part[],
      },
      {
        info: assistantInfo(assistantID2, "m-parent", aborted),
        parts: [
          {
            ...basePart(assistantID2, "b1"),
            type: "step-start",
          },
          {
            ...basePart(assistantID2, "b2"),
            type: "reasoning",
            text: "thinking",
            time: { start: 0 },
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(MessageV2.toModelMessages(input, model)).toStrictEqual([
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "thinking", providerOptions: undefined },
          { type: "text", text: "partial answer" },
        ],
      },
    ])
  })

  test("splits assistant messages on step-start boundaries", () => {
    const assistantID = "m-assistant"

    const input: MessageV2.WithParts[] = [
      {
        info: assistantInfo(assistantID, "m-parent"),
        parts: [
          {
            ...basePart(assistantID, "p1"),
            type: "text",
            text: "first",
          },
          {
            ...basePart(assistantID, "p2"),
            type: "step-start",
          },
          {
            ...basePart(assistantID, "p3"),
            type: "text",
            text: "second",
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(MessageV2.toModelMessages(input, model)).toStrictEqual([
      {
        role: "assistant",
        content: [{ type: "text", text: "first" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "second" }],
      },
    ])
  })

  test("drops messages that only contain step-start parts", () => {
    const assistantID = "m-assistant"

    const input: MessageV2.WithParts[] = [
      {
        info: assistantInfo(assistantID, "m-parent"),
        parts: [
          {
            ...basePart(assistantID, "p1"),
            type: "step-start",
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(MessageV2.toModelMessages(input, model)).toStrictEqual([])
  })

  test("converts pending/running tool calls to error results to prevent dangling tool_use", () => {
    const userID = "m-user"
    const assistantID = "m-assistant"

    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "u1"),
            type: "text",
            text: "run tool",
          },
        ] as MessageV2.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [
          {
            ...basePart(assistantID, "a1"),
            type: "tool",
            callID: "call-pending",
            tool: "bash",
            state: {
              status: "pending",
              input: { cmd: "ls" },
              raw: "",
            },
          },
          {
            ...basePart(assistantID, "a2"),
            type: "tool",
            callID: "call-running",
            tool: "read",
            state: {
              status: "running",
              input: { path: "/tmp" },
              time: { start: 0 },
            },
          },
        ] as MessageV2.Part[],
      },
    ]

    const result = MessageV2.toModelMessages(input, model)

    expect(result).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "run tool" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-pending",
            toolName: "bash",
            input: { cmd: "ls" },
            providerExecuted: undefined,
          },
          {
            type: "tool-call",
            toolCallId: "call-running",
            toolName: "read",
            input: { path: "/tmp" },
            providerExecuted: undefined,
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-pending",
            toolName: "bash",
            output: { type: "error-text", value: "[Tool execution was interrupted]" },
          },
          {
            type: "tool-result",
            toolCallId: "call-running",
            toolName: "read",
            output: { type: "error-text", value: "[Tool execution was interrupted]" },
          },
        ],
      },
    ])
  })
})

describe("session.message-v2.fromError", () => {
  test("serializes context_length_exceeded as ContextOverflowError", () => {
    const input = {
      type: "error",
      error: {
        code: "context_length_exceeded",
      },
    }
    const result = MessageV2.fromError(input, { providerID: "test" })

    expect(result).toStrictEqual({
      name: "ContextOverflowError",
      data: {
        message: "Input exceeds context window of this model",
        responseBody: JSON.stringify(input),
      },
    })
  })

  test("serializes response error codes", () => {
    const cases = [
      {
        code: "insufficient_quota",
        message: "Quota exceeded. Check your plan and billing details.",
      },
      {
        code: "usage_not_included",
        message: "To use Codex with your ChatGPT plan, upgrade to Plus: https://chatgpt.com/explore/plus.",
      },
      {
        code: "invalid_prompt",
        message: "Invalid prompt from test",
      },
    ]

    cases.forEach((item) => {
      const input = {
        type: "error",
        error: {
          code: item.code,
          message: item.code === "invalid_prompt" ? item.message : undefined,
        },
      }
      const result = MessageV2.fromError(input, { providerID: "test" })

      expect(result).toStrictEqual({
        name: "APIError",
        data: {
          message: item.message,
          isRetryable: false,
          responseBody: JSON.stringify(input),
        },
      })
    })
  })

  test("maps github-copilot 403 to reauth guidance", () => {
    const error = new APICallError({
      message: "forbidden",
      url: "https://api.githubcopilot.com/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 403,
      responseHeaders: { "content-type": "application/json" },
      responseBody: '{"error":"forbidden"}',
      isRetryable: false,
    })

    const result = MessageV2.fromError(error, { providerID: "github-copilot" })

    expect(result).toStrictEqual({
      name: "APIError",
      data: {
        message:
          "Please reauthenticate with the copilot provider to ensure your credentials work properly with OpenCode.",
        statusCode: 403,
        isRetryable: false,
        responseHeaders: { "content-type": "application/json" },
        responseBody: '{"error":"forbidden"}',
        metadata: {
          url: "https://api.githubcopilot.com/v1/chat/completions",
        },
      },
    })
  })

  test("detects context overflow from APICallError provider messages", () => {
    const cases = [
      "prompt is too long: 213462 tokens > 200000 maximum",
      "Your input exceeds the context window of this model",
      "The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)",
      "Please reduce the length of the messages or completion",
      "400 status code (no body)",
      "413 status code (no body)",
    ]

    cases.forEach((message) => {
      const error = new APICallError({
        message,
        url: "https://example.com",
        requestBodyValues: {},
        statusCode: 400,
        responseHeaders: { "content-type": "application/json" },
        isRetryable: false,
      })
      const result = MessageV2.fromError(error, { providerID: "test" })
      expect(MessageV2.ContextOverflowError.isInstance(result)).toBe(true)
    })
  })

  test("does not classify 429 no body as context overflow", () => {
    const result = MessageV2.fromError(
      new APICallError({
        message: "429 status code (no body)",
        url: "https://example.com",
        requestBodyValues: {},
        statusCode: 429,
        responseHeaders: { "content-type": "application/json" },
        isRetryable: false,
      }),
      { providerID: "test" },
    )
    expect(MessageV2.ContextOverflowError.isInstance(result)).toBe(false)
    expect(MessageV2.APIError.isInstance(result)).toBe(true)
  })

  test("serializes unknown inputs", () => {
    const result = MessageV2.fromError(123, { providerID: "test" })

    expect(result).toStrictEqual({
      name: "UnknownError",
      data: {
        message: "123",
      },
    })
  })
})
