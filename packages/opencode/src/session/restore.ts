import type { ModelMessage } from "ai"
import z from "zod"
import { Storage } from "../storage/storage"

export namespace SessionRestore {
  export const Item = z.object({
    anchor: z.string(),
    system: z.array(z.string()),
    messages: z.array(z.custom<ModelMessage>()),
    source: z.object({
      trace: z.string(),
      step: z.number().int().nonnegative(),
      session: z.string().optional(),
      run: z.string().optional(),
    }),
  })

  export type Item = z.infer<typeof Item>

  export async function get(sessionID: string) {
    return Item.parse(await Storage.read(["session_restore", sessionID]))
  }

  export async function set(sessionID: string, item: Item) {
    await Storage.write(["session_restore", sessionID], item)
  }

  export async function clear(sessionID: string) {
    await Storage.remove(["session_restore", sessionID])
  }
}