/**
 * MCP server wiring.
 *
 * We use the low-level `Server` API (from @modelcontextprotocol/sdk/server)
 * rather than the high-level `McpServer` because the high-level helper
 * requires Zod schemas, and we want to keep the dependency surface to exactly
 * one package (`@modelcontextprotocol/sdk`).
 *
 * Tools are registered as static JSON Schema descriptors. The dispatch is a
 * simple switch over tool name; each tool just forwards its input to the
 * matching POST /api/mcp/v1/<tool> endpoint via the JournalClient.
 *
 * The single resource `journal://overview` is a thin wrapper over
 * `account_overview` — the same data, exposed as a resource so clients that
 * support resources can subscribe / pre-load it at session start.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
  type ListResourcesResult,
  type ListToolsResult,
  type ReadResourceResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { JournalApiError, type JournalClient } from "./client.js";

const OVERVIEW_RESOURCE_URI = "journal://overview";

/**
 * Static descriptors for every tool the server exposes.
 *
 * The `description` strings are deliberately verbose — they're how the LLM
 * learns when and how to use each tool. Keep them aligned with the README and
 * the parallel work on the HTTP API.
 *
 * The `inputSchema` objects are plain JSON Schema (per MCP spec). `additionalProperties`
 * is left unset (defaults to true) because the API is the source of truth for
 * validation and we'd rather forward unknown fields than reject them at the
 * bridge layer.
 */
const TOOLS: Tool[] = [
  {
    name: "list_spreads",
    description:
      "List the user's spread trades. Spreads are the journal's atomic unit — multi-leg, multi-venue positions held for hours to weeks. Use this to find specific trades or pull a working set for analysis. All filter fields are optional; with no filters you get the most recent 200 spreads. Decimal fields are strings (preserves precision). Pagination via limit (capped at 200) and offset; check has_more in the response.",
    inputSchema: {
      type: "object",
      properties: {
        opened_after: {
          type: "string",
          format: "date-time",
          description: "ISO-8601 timestamp; include spreads opened at or after this instant.",
        },
        opened_before: {
          type: "string",
          format: "date-time",
          description: "ISO-8601 timestamp; include spreads opened at or before this instant.",
        },
        status: {
          type: "string",
          enum: ["open", "closed", "partial"],
          description: "Filter by current spread status.",
        },
        symbol: {
          type: "string",
          description: "Filter by symbol (e.g. \"BTC-USD\"). Case-insensitive.",
        },
        venue: {
          type: "string",
          description: "Filter by venue (e.g. \"binance\").",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tag filter — multiple tags are combined with AND.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          description: "Page size. Default 200, max 200.",
        },
        offset: {
          type: "integer",
          minimum: 0,
          description: "Pagination offset. Default 0.",
        },
      },
    },
  },
  {
    name: "get_spread",
    description:
      "Get full detail for one spread: every leg, every fill, the note, tags, and related funding. Use this after list_spreads to drill into a specific trade. The id is opaque — pass back whatever list_spreads returned.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Opaque spread identifier from list_spreads.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "recent_activity",
    description:
      "A snapshot of the user's last N days of activity: how many spreads opened, how many closed, and the actual rows. Default 7 days, max 365. Use this to orient yourself before deeper analysis.",
    inputSchema: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          minimum: 1,
          maximum: 365,
          description: "Window size in days. Default 7.",
        },
      },
    },
  },
  {
    name: "account_overview",
    description:
      "Top-line snapshot of the user's entire journal: when they started, total activity counts, P&L totals (lifetime / YTD / last 30 days), connected exchanges, top tags, open position counts. Read this first in any session — it tells you the shape of the data before you query specifics. Does NOT include any credentials, API keys, or sensitive auth data.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "tag_glossary",
    description:
      "Every tag the user has applied, with usage count and (optionally) a user-written definition. Tag definitions tell you what the user means by their own tags — e.g. \"fading PA\" might be \"fading parabolic moves on 1m\" to one user but \"fading public attention\" to another. When a tag has no definition, infer carefully from the name + how it appears in spreads.",
    inputSchema: {
      type: "object",
      properties: {
        only_with_definitions: {
          type: "boolean",
          description: "When true, omit tags that have no user-written definition. Default false.",
        },
      },
    },
  },
];

/**
 * Build and return a configured MCP Server ready to be connected to a
 * transport. The server holds a reference to the supplied JournalClient and
 * delegates every tool call to its HTTP endpoints.
 */
export function buildServer(client: JournalClient): Server {
  const server = new Server(
    {
      name: "trading-journal-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  // ---- tools/list -------------------------------------------------------
  server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => {
    return { tools: TOOLS };
  });

  // ---- tools/call -------------------------------------------------------
  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: rawArgs } = request.params;
    const input = (rawArgs ?? {}) as Record<string, unknown>;

    // Guard: the SDK has already validated `name` is a string, but we double
    // check it's one we registered so unknown tools return a clean error.
    if (!TOOLS.some((t) => t.name === name)) {
      return toolError(`Unknown tool: ${name}`);
    }

    try {
      const result = await client.callTool(name, input);
      return toolSuccess(result);
    } catch (err) {
      if (err instanceof JournalApiError) {
        return toolError(err.message);
      }
      // Unexpected error — surface a generic message but include the type
      // for debugging. We deliberately don't expose stack traces to the LLM.
      const message = err instanceof Error ? err.message : String(err);
      return toolError(`Unexpected error: ${message}`);
    }
  });

  // ---- resources/list ---------------------------------------------------
  server.setRequestHandler(ListResourcesRequestSchema, async (): Promise<ListResourcesResult> => {
    return {
      resources: [
        {
          uri: OVERVIEW_RESOURCE_URI,
          name: "Account overview",
          description:
            "Top-level snapshot of the user's trading journal. Read once at session start.",
          mimeType: "application/json",
        },
      ],
    };
  });

  // ---- resources/read ---------------------------------------------------
  server.setRequestHandler(ReadResourceRequestSchema, async (request): Promise<ReadResourceResult> => {
    const { uri } = request.params;
    if (uri !== OVERVIEW_RESOURCE_URI) {
      throw new JournalApiError("UNKNOWN_RESOURCE", `Unknown resource URI: ${uri}`);
    }

    // The overview resource is just `account_overview` exposed as a resource.
    const data = await client.callTool("account_overview", {});
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  });

  return server;
}

// --- helpers ---------------------------------------------------------------

/**
 * Wrap a successful tool result for the MCP transport.
 *
 * The MCP spec requires `content` to be an array of content parts; we return a
 * single `text` part with the JSON-stringified body. LLM clients render this
 * as JSON and feed it into context as-is.
 */
function toolSuccess(data: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * Wrap an error result. Per the MCP spec, `isError: true` flags tool-level
 * errors that the LLM should surface to the user (as opposed to protocol
 * errors, which would throw out of the handler).
 */
function toolError(message: string): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: message,
      },
    ],
  };
}
