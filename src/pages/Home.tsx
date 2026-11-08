import { ShieldCheck } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { ReviewDashboard } from "@/components/review/ReviewDashboard";
import { useAuth } from "@/hooks/useAuth";

export default function Home() {
  const { user } = useAuth();
  const canReview = user?.role === "admin";
  return (
    <AuthLayout>
      {user && !canReview ? (
        <div className="error-state min-h-[80vh]">
          <ShieldCheck className="h-8 w-8" />
          <h1>Acceso exclusivo del propietario</h1>
          <p>Solo la cuenta propietaria puede revisar y autorizar los lotes de Moreka Shop.</p>
        </div>
      ) : <ReviewDashboard />}
    </AuthLayout>
  );
}
