import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Trace } from "../../src/session/trace"
import { tmpdir } from "../fixture/fixture"

describe("session.trace request", () => {
  test("records request payload and publishes cache summary", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const events: Array<unknown> = []
        const unsubscribe = Bus.subscribe(Trace.Event.Request, (event) => events.push(event.properties))
        try {
          await Trace.run("request-test", { events: false, flat: true })
          await Trace.request("ses_trace", {
            requestID: "msg_trace",
            model: { id: "gpt-test", providerID: "openai" },
            agent: "prover",
            system: ["stable system prefix"],
            messages: [{ role: "user", content: "prove the lemma" }],
            tools: ["read", "coqc"],
            temperature: 0,
            topP: 1,
            topK: 40,
            maxOutputTokens: 1024,
            providerOptions: { openai: { promptCacheKey: "ses_trace", store: false } },
            cache: {
              promptCacheKey: "ses_trace",
              providerOptionKeys: ["promptCacheKey", "store"],
            },
          })
          await Trace.step("ses_trace", {
            reason: "tool-calls",
            cost: 0.01,
            tokens: {
              total: 150,
              input: 40,
              output: 10,
              reasoning: 5,
              cache: { read: 100, write: 0 },
            },
          })
          expect(Trace.pendingRequestCount("ses_trace")).toBe(0)
          await Trace.request("ses_trace", {
            requestID: "msg_trace_2",
            model: { id: "gpt-test", providerID: "openai" },
            agent: "prover",
            system: ["stable system prefix"],
            messages: [{ role: "user", content: "continue proof" }],
            tools: ["read", "coqc"],
            providerOptions: { openai: { promptCacheKey: "ses_trace", store: false } },
            cache: {
              promptCacheKey: "ses_trace",
              providerOptionKeys: ["promptCacheKey", "store"],
            },
          })
          expect(Trace.pendingRequestCount("ses_trace")).toBe(1)
          await Trace.step("ses_trace", {
            reason: "stop",
            cost: 0.02,
            tokens: {
              total: 90,
              input: 80,
              output: 10,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          })
          expect(Trace.pendingRequestCount("ses_trace")).toBe(0)
          await Trace.end("ses_trace")
          await Trace.runEnd()
        } finally {
          unsubscribe()
        }

        expect(events).toHaveLength(2)
        expect(events[0]).toMatchObject({
          sessionID: "ses_trace",
          step: 1,
          requestID: "msg_trace",
          cache: {
            promptCacheKey: "ses_trace",
            providerOptionKeys: ["promptCacheKey", "store"],
          },
        })

        const traceDir = Trace.runDir()
        expect(traceDir).toBeTruthy()
        const requestFile = path.join(traceDir!, "requests.jsonl")
        const requests = (await fs.readFile(requestFile, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
        expect(requests).toHaveLength(2)
        const request = requests[0]
        expect(request).toMatchObject({
          type: "request",
          request_id: "msg_trace",
          session_id: "ses_trace",
          provider: "openai",
          model: "gpt-test",
          prompt_cache_key: "ses_trace",
          provider_option_keys: ["promptCacheKey", "store"],
          finish: {
            reason: "tool-calls",
            cost: 0.01,
          },
          usage: {
            prompt_tokens: 140,
            prompt_cache_hit_tokens: 100,
            cached_tokens: 100,
            prompt_cache_miss_tokens: 40,
            cache_write_tokens: 0,
            cache_read_ratio: 100 / 140,
          },
          provider_options: { openai: { promptCacheKey: "ses_trace", store: false } },
        })
        expect(request.hashes.system_prompt_hash).toBeString()
        expect(request.hashes.tools_schema_hash_kind).toBe("tool_names")
        expect(request.hashes.token_hash_kind).toBe("whitespace")
        expect(request.flags.was_compacted).toBe(false)
        expect(request.system).toEqual(["stable system prefix"])
        expect(request.messages).toEqual([{ role: "user", content: "prove the lemma" }])
        expect(requests[1].request_id).toBe("msg_trace_2")
        expect(requests[1].usage.prompt_cache_hit_tokens).toBe(0)
        await expect(fs.stat(path.join(traceDir!, "ses_trace"))).rejects.toThrow()
      },
    })
  })
})
