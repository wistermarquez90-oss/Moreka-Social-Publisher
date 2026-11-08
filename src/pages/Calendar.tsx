import { ShieldCheck } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { CalendarDashboard } from "@/components/publishing/CalendarDashboard";
import { useAuth } from "@/hooks/useAuth";

export default function Calendar() {
  const { user } = useAuth();
  return <AuthLayout>{user && user.role !== "admin" ? <div className="error-state"><ShieldCheck /><h1>Acceso exclusivo del propietario</h1></div> : <CalendarDashboard />}</AuthLayout>;
}
