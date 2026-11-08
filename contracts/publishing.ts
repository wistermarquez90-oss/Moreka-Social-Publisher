export const PUBLISHING_NETWORKS = ["instagram", "facebook", "tiktok", "linkedin", "youtube"] as const;
export const ACTIVE_PUBLISHING_NETWORKS = ["instagram", "facebook", "tiktok", "youtube"] as const;
export type PublishingNetwork = typeof PUBLISHING_NETWORKS[number];
export type ActivePublishingNetwork = typeof ACTIVE_PUBLISHING_NETWORKS[number];
export type PublicationFormat = "image" | "story" | "reel";

export type ScheduledNetworkPayload = {
  network: PublishingNetwork;
  title: string;
  caption: string;
  hashtags: string;
  mediaKey: string | null;
  sourceUrl: string | null;
};

export type ScheduledPayload = {
  networks: ScheduledNetworkPayload[];
  tiktok?: {
    privacyLevel: "SELF_ONLY" | "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR";
  };
  youtube?: {
    privacyStatus: "private" | "unlisted" | "public";
  };
};

export function requiresPublicVideo(format: PublicationFormat): boolean {
  return format === "reel";
}

export function networksAvailableForMedia(networks: PublishingNetwork[], hasVideo: boolean): PublishingNetwork[] {
  if (hasVideo) return networks;
  return networks.filter((network) => network !== "tiktok" && network !== "youtube");
}
