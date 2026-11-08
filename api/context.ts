import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { User } from "@db/schema";
import { authenticateRequest } from "./kimi/auth";
import { authenticateExternal } from "./services/auth";
import { env } from "./lib/env";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: User;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: opts.req, resHeaders: opts.resHeaders };
  try {
    ctx.user = await authenticateExternal(opts.req.headers);
    if (!ctx.user) {
      ctx.user = env.authDriver === "password"
        ? undefined
        : await authenticateRequest(opts.req.headers);
    }
  } catch {
    // Authentication is optional here
  }
  return ctx;
}
