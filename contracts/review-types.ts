import type { batches, products, drafts, editorialPosts, editorialDrafts, mediaAssets, monthlyGiveaways, scheduledPosts, publicationAttempts } from "../db/schema";

export type BatchView = typeof batches.$inferSelect;
export type ProductView = typeof products.$inferSelect;
export type DraftView = typeof drafts.$inferSelect;
export type EditorialPostView = typeof editorialPosts.$inferSelect;
export type EditorialDraftView = typeof editorialDrafts.$inferSelect;
export type MonthlyGiveawayView = typeof monthlyGiveaways.$inferSelect;
export type MediaView = typeof mediaAssets.$inferSelect & { url: string | null };
export type BatchListItem = BatchView & { total: number; approved: number; changes: number; pending: number };
export type CalendarItemView = typeof scheduledPosts.$inferSelect & {
  thumbnail: string | null;
  attempts: (typeof publicationAttempts.$inferSelect)[];
};
