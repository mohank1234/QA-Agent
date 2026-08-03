import { isGoogleAuthConfigured } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return <LoginForm googleEnabled={isGoogleAuthConfigured()} />;
}
