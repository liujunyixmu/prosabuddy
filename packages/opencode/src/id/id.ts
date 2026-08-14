import z from "zod"
import { randomBytes } from "crypto"

export namespace Identifier {
  const prefixes = {
    session: "ses",
    message: "msg",
    permission: "per",
    question: "que",
    user: "usr",
    part: "prt",
    pty: "pty",
    tool: "tool",
    workspace: "wrk",
  } as const

  export function schema(prefix: keyof typeof prefixes) {
    return z.string().startsWith(prefixes[prefix])
  }

  const LENGTH = 26
  const TIME_BYTES = 8
  const VERSION_ASCENDING = "v"
  const VERSION_DESCENDING = "-"

  // State for monotonic ID generation
  let lastTimestamp = 0
  let counter = 0

  export function ascending(prefix: keyof typeof prefixes, given?: string) {
    return generateID(prefix, false, given)
  }

  export function descending(prefix: keyof typeof prefixes, given?: string) {
    return generateID(prefix, true, given)
  }

  function generateID(prefix: keyof typeof prefixes, descending: boolean, given?: string): string {
    if (!given) {
      return create(prefix, descending)
    }

    if (!given.startsWith(prefixes[prefix])) {
      throw new Error(`ID ${given} does not start with ${prefixes[prefix]}`)
    }
    return given
  }

  function randomBase62(length: number): string {
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    let result = ""
    const bytes = randomBytes(length)
    for (let i = 0; i < length; i++) {
      result += chars[bytes[i] % 62]
    }
    return result
  }

  export function create(prefix: keyof typeof prefixes, descending: boolean, timestamp?: number): string {
    const currentTimestamp = timestamp ?? Date.now()

    if (currentTimestamp !== lastTimestamp) {
      lastTimestamp = currentTimestamp
      counter = 0
    }
    counter++

    let now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(counter)

    now = descending ? ~now : now

    const timeBytes = Buffer.alloc(TIME_BYTES)
    for (let i = 0; i < TIME_BYTES; i++) {
      timeBytes[i] = Number((now >> BigInt(56 - 8 * i)) & BigInt(0xff))
    }

    // Legacy IDs stored only 48 bits of timestamp+counter, which rolled over every
    // 2^36 milliseconds. Keep the overall payload length stable, but version the
    // new 64-bit encoding so timestamp() can distinguish it from stored legacy IDs.
    // The marker also preserves cross-version lexical ordering: new ascending IDs
    // sort after legacy IDs, while new descending IDs sort before them.
    const version = descending ? VERSION_DESCENDING : VERSION_ASCENDING
    const encoded = timeBytes.toString("hex")
    return prefixes[prefix] + "_" + version + encoded + randomBase62(LENGTH - version.length - encoded.length)
  }

  /** Extract timestamp from an ascending ID. Does not work with descending IDs. */
  export function timestamp(id: string): number {
    const prefix = id.split("_")[0]
    const offset = prefix.length + 1
    const versioned = id[offset] === VERSION_ASCENDING
    const start = offset + (versioned ? 1 : 0)
    const hex = id.slice(start, start + (versioned ? TIME_BYTES * 2 : 12))
    const encoded = BigInt("0x" + hex)
    return Number(encoded / BigInt(0x1000))
  }
}
