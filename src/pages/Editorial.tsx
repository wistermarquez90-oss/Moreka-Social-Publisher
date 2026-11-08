import { ShieldCheck } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { EditorialDashboard } from "@/components/review/EditorialDashboard";
import { useAuth } from "@/hooks/useAuth";

export default function Editorial() {
  const { user } = useAuth();
  return (
    <AuthLayout>
      {user && user.role !== "admin" ? (
        <div className="error-state min-h-[80vh]"><ShieldCheck className="h-8 w-8" /><h1>Acceso exclusivo del propietario</h1><p>Solo la cuenta propietaria puede configurar y autorizar el plan editorial.</p></div>
      ) : <EditorialDashboard />}
    </AuthLayout>
  );
}
