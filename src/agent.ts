/**
 * AmbassadorAgent — conversational agent for querying ambassador CRM data.
 * Receives Slack messages, uses Claude to interpret questions,
 * queries collab.shoppingeventvip.be, and returns formatted answers.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  Tool,
  MessageParam,
  ContentBlockParam,
  ToolUseBlock,
  ToolResultBlockParam,
  TextBlock,
} from "@anthropic-ai/sdk/resources/messages.js";
import * as collab from "./tools/collab-directus.js";

interface RoutedMessage {
  channel_id: string;
  user_id: string;
  text: string;
  ts: string;
  thread_ts?: string;
}

interface AgentResponse {
  channel_id: string;
  thread_ts?: string;
  text: string;
}

const TOOLS: Tool[] = [
  {
    name: "search_ambassadors",
    description: "Search ambassadors by name, email, or Instagram/TikTok handle. Use this when the user asks about a specific person.",
    input_schema: {
      type: "object" as const,
      properties: { query: { type: "string", description: "Name, email, or handle to search for" }, limit: { type: "number" } },
      required: ["query"],
    },
  },
  {
    name: "get_ambassador_stats",
    description: "Get counts of ambassadors by pipeline status (lead, contacted, negotiating, active, inactive). Use for overview/dashboard questions.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_campaigns",
    description: "List all ambassador campaigns (past and current). Shows campaign name, type, status, and deadline.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_ambassadors_for_campaign",
    description: "Get all ambassadors who were part of a specific campaign. Search by campaign name (e.g. 'River Woods', 'Xandres', 'Bellerose', 'Le Salon VIP').",
    input_schema: {
      type: "object" as const,
      properties: { campaign_name: { type: "string", description: "Campaign name to search for" } },
      required: ["campaign_name"],
    },
  },
  {
    name: "get_campaigns_for_ambassador",
    description: "Get all campaigns a specific ambassador has participated in. Requires the ambassador's Directus ID (use search_ambassadors first to get it).",
    input_schema: {
      type: "object" as const,
      properties: { ambassador_id: { type: "string" } },
      required: ["ambassador_id"],
    },
  },
  {
    name: "get_repeat_collaborators",
    description: "Find ambassadors who have collaborated on multiple campaigns. Shows how many campaigns each has been part of.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_top_ambassadors",
    description: "Get ambassadors with the largest audience/follower count. Optionally filter by platform (instagram or tiktok).",
    input_schema: {
      type: "object" as const,
      properties: {
        limit: { type: "number", description: "How many to return (default 20)" },
        platform: { type: "string", enum: ["instagram", "tiktok"], description: "Filter by platform" },
      },
    },
  },
  {
    name: "get_ambassadors_by_status",
    description: "List ambassadors filtered by pipeline status: lead, contacted, negotiating, active, or inactive.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: { type: "string", enum: ["lead", "contacted", "negotiating", "active", "inactive"] },
        limit: { type: "number" },
      },
      required: ["status"],
    },
  },
];

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "search_ambassadors": {
      const results = await collab.searchAmbassadors(input.query as string, (input.limit as number) || 20);
      return JSON.stringify(results, null, 2);
    }
    case "get_ambassador_stats": {
      const stats = await collab.getAmbassadorStats();
      return JSON.stringify(stats, null, 2);
    }
    case "get_campaigns": {
      const campaigns = await collab.getCampaigns();
      return JSON.stringify(campaigns, null, 2);
    }
    case "get_ambassadors_for_campaign": {
      const result = await collab.getAmbassadorsForCampaign(input.campaign_name as string);
      return JSON.stringify(result, null, 2);
    }
    case "get_campaigns_for_ambassador": {
      const result = await collab.getCampaignsForAmbassador(input.ambassador_id as string);
      return JSON.stringify(result, null, 2);
    }
    case "get_repeat_collaborators": {
      const result = await collab.getRepeatCollaborators();
      return JSON.stringify(result, null, 2);
    }
    case "get_top_ambassadors": {
      const result = await collab.getTopAmbassadors((input.limit as number) || 20, input.platform as string | undefined);
      return JSON.stringify(result, null, 2);
    }
    case "get_ambassadors_by_status": {
      const result = await collab.getAmbassadorsByStatus(input.status as string, (input.limit as number) || 50);
      return JSON.stringify(result, null, 2);
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

const SYSTEM_PROMPT = `You are the Ambassador CRM agent for Shopping Event VIP. You answer questions about ambassadors (influencers/creators), campaigns, and collaboration history.

Data lives in collab.shoppingeventvip.be (Directus). Use the tools to query it.

Ambassador pipeline statuses: lead → contacted → negotiating → active → inactive
Campaigns include: Le Salon VIP (Nov 2025), Xandres (Feb 2026), River Woods (Mar 2026), Bellerose (Mar 2025), Salt & Pepper (Mar 2025), SEV Outreach (Spring 2025).

When formatting responses for Slack:
- Use *bold* for names and numbers
- Use bullet points (•) for lists
- Keep responses concise but complete
- Show Instagram handles as @handle
- Format audience sizes with k/M suffixes (e.g. 52.3k, 1.2M)
- When listing ambassadors, include: name, handle, audience size, status`;

export class AmbassadorAgent {
  private claude: Anthropic;

  constructor() {
    this.claude = new Anthropic();
  }

  async handleMessage(message: RoutedMessage): Promise<AgentResponse> {
    try {
      const messages: MessageParam[] = [
        { role: "user", content: message.text },
      ];

      // Agentic loop — let Claude call tools until it has an answer
      let response = await this.claude.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      });

      while (response.stop_reason === "tool_use") {
        const toolBlocks = response.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
        const assistantContent = response.content as ContentBlockParam[];

        messages.push({ role: "assistant", content: assistantContent });

        const toolResults: ToolResultBlockParam[] = [];
        for (const block of toolBlocks) {
          console.log(`[tool] ${block.name}(${JSON.stringify(block.input).slice(0, 100)})`);
          const result = await executeTool(block.name, block.input as Record<string, unknown>);
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
        }

        messages.push({ role: "user", content: toolResults });

        response = await this.claude.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages,
        });
      }

      const textBlocks = response.content.filter((b): b is TextBlock => b.type === "text");
      const answer = textBlocks.map(b => b.text).join("\n") || "I couldn't find an answer. Try rephrasing your question.";

      return {
        channel_id: message.channel_id,
        thread_ts: message.thread_ts ?? message.ts,
        text: answer,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("Error handling message:", errMsg);
      return {
        channel_id: message.channel_id,
        thread_ts: message.thread_ts ?? message.ts,
        text: `Error: ${errMsg.slice(0, 200)}`,
      };
    }
  }
}
