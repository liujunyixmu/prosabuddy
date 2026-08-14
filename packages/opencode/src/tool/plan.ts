import z from "zod"
import { Tool } from "./tool"

export const PlanExitTool = Tool.define("plan", {
  description: "Use this tool to present the implementation plan and exit planning mode.",
  parameters: z.object({
    plan: z.string().describe("The implementation plan to present to the user."),
  }),
  async execute(params) {
    return {
      title: "plan ready",
      metadata: {},
      output: params.plan,
    }
  },
})
