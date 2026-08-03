import { Resend } from "resend";
import { logger } from "../logger";
import { config as appConfig } from "../config";

export function isEmailConfigured(): boolean {
  return appConfig.email !== null;
}

// Returns true if it actually sent an email, false if it fell back to
// logging the link (RESEND_API_KEY/EMAIL_FROM not configured, or Resend
// itself failed) — mirrors the rest of this app's optional-integration
// pattern (DB validation, Jira): absent/broken config degrades gracefully
// rather than failing the request. A Resend outage or bad API key
// shouldn't turn "forgot password" into a 500 for the user.
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<boolean> {
  const emailConfig = appConfig.email;
  if (!emailConfig) {
    logger.info({ to, resetUrl }, "RESEND_API_KEY not set — logging reset link instead of emailing");
    return false;
  }

  try {
    const resend = new Resend(emailConfig.apiKey);
    await resend.emails.send({
      from: emailConfig.from,
      to,
      subject: "Reset your QA Agent password",
      html: `<p>Someone requested a password reset for this email address.</p>
<p><a href="${resetUrl}">Click here to reset your password</a>. This link expires in 1 hour.</p>
<p>If you didn't request this, you can safely ignore this email.</p>`,
    });
    return true;
  } catch (err) {
    logger.error({ err, to }, "sendPasswordResetEmail failed — falling back to console link");
    logger.info({ to, resetUrl }, "reset link (Resend send failed)");
    return false;
  }
}
