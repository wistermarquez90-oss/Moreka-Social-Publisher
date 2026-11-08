import { ShieldCheck } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { CompanySettings } from "@/components/settings/CompanySettings";
import { useAuth } from "@/hooks/useAuth";

export default function Settings() {
  const { user } = useAuth();
  return <AuthLayout>{user && user.role !== "admin" ? <div className="error-state"><ShieldCheck /><h1>Acceso exclusivo del propietario</h1></div> : <CompanySettings />}</AuthLayout>;
}
