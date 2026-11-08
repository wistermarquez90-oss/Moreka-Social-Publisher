import { authRouter } from "./auth-router";
import { reviewRouter } from "./review-router";
import { creationRouter } from "./creation-router";
import { editorialRouter } from "./editorial-router";
import { publishingRouter } from "./publishing-router";
import { socialRouter } from "./social-router";
import { organizationRouter } from "./organization-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  review: reviewRouter,
  creation: creationRouter,
  editorial: editorialRouter,
  publishing: publishingRouter,
  social: socialRouter,
  organization: organizationRouter,
});

export type AppRouter = typeof appRouter;
