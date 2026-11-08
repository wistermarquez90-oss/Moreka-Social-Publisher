import { Facebook, Instagram, Linkedin, Music2, Youtube, type LucideIcon } from "lucide-react";

export const NETWORKS = ["instagram", "facebook", "tiktok", "youtube"] as const;
export type Network = "instagram" | "facebook" | "tiktok" | "linkedin" | "youtube";

export const NETWORK_META: Record<Network, { label: string; short: string; icon: LucideIcon }> = {
  instagram: { label: "Instagram", short: "IG", icon: Instagram },
  facebook: { label: "Facebook", short: "FB", icon: Facebook },
  tiktok: { label: "TikTok", short: "TT", icon: Music2 },
  linkedin: { label: "LinkedIn", short: "LI", icon: Linkedin },
  youtube: { label: "YouTube", short: "YT", icon: Youtube },
};

export const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  pending: "Pendiente",
  in_review: "En revisión",
  changes_requested: "Por corregir",
  approved: "Autorizado",
  removed: "Retirado",
};
