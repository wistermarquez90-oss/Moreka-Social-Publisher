import { Check, CircleDashed, Minus, PencilLine } from "lucide-react";
import { STATUS_LABELS } from "@/types/review";

export function StatusBadge({ status, dark = false }: { status: string; dark?: boolean }) {
  const approved = status === "approved";
  const changes = status === "changes_requested";
  const removed = status === "removed";
  const Icon = approved ? Check : changes ? PencilLine : removed ? Minus : CircleDashed;
  return (
    <span className={`status-badge ${approved ? "status-approved" : changes ? "status-changes" : removed ? "status-removed" : "status-pending"} ${dark ? "status-dark" : ""}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
