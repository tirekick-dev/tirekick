import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ToolShape } from "./validate.js";

export interface ConnectResult {
  tools?: ToolShape[];
  /** Set when the server exists but won't hand us tools without credentials. */
  authGated?: boolean;
  /** Set when the process/endpoint failed before tools/list. */
  bootError?: string;
}

const CLIENT_INFO = { name: "tirekick", version: "0.0.1" };
const TIMEOUT_MS = 20_000;

/** Minimal fetch shape the MCP transport accepts (SDK's FetchLike). */
export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface FromUrlOptions {
  headers?: Record<string, string>;
  /**
   * Custom fetch for the transport's HTTP calls. Callers that reach servers
   * from user input (the hosted checker) MUST pass an SSRF-guarded fetch so
   * redirects and DNS resolution can't be steered into a private network.
   * The CLI, which runs on the user's own machine against a URL they typed,
   * can omit it.
   */
  fetch?: FetchLike;
}

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS)),
  ]);
}

async function listAll(client: Client): Promise<ToolShape[]> {
  const tools: ToolShape[] = [];
  let cursor: string | undefined;
  do {
    const page = await withTimeout(client.listTools({ cursor }), "tools/list");
    tools.push(...(page.tools as ToolShape[]));
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

export async function fromUrl(url: string, opts: FromUrlOptions = {}): Promise<ConnectResult> {
  const client = new Client(CLIENT_INFO);
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: opts.headers ? { headers: opts.headers } : undefined,
    fetch: opts.fetch,
  });
  try {
    await withTimeout(client.connect(transport), "initialize");
    const tools = await listAll(client);
    return { tools };
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (/401|unauthorized|oauth|authenticat/i.test(msg)) return { authGated: true };
    return { bootError: msg };
  } finally {
    await client.close().catch(() => {});
  }
}

export async function fromNpm(pkg: string, env: Record<string, string>): Promise<ConnectResult> {
  const client = new Client(CLIENT_INFO);
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", pkg],
    env: { ...(process.env as Record<string, string>), ...env },
    stderr: "pipe",
  });
  let stderrTail = "";
  transport.stderr?.on("data", (d: Buffer) => {
    stderrTail = (stderrTail + d.toString()).slice(-2000);
  });
  try {
    await withTimeout(client.connect(transport), "initialize");
    const tools = await listAll(client);
    return { tools };
  } catch (e) {
    const msg = `${String((e as Error).message ?? e)}${stderrTail ? `\n--- server stderr ---\n${stderrTail}` : ""}`;
    if (/api[_ ]?key|token|credential|auth/i.test(msg)) return { authGated: true, bootError: msg };
    return { bootError: msg };
  } finally {
    await client.close().catch(() => {});
  }
}

/** Accepts a tools/list result dump, a bare tools array, or {tools: [...]}. */
export async function fromFile(path: string): Promise<ConnectResult> {
  const raw = JSON.parse(await readFile(path, "utf8"));
  const tools = Array.isArray(raw) ? raw : (raw.tools ?? raw.result?.tools);
  if (!Array.isArray(tools)) return { bootError: `${path} contains no tools array (expected [...], {tools}, or a tools/list response)` };
  return { tools };
}
