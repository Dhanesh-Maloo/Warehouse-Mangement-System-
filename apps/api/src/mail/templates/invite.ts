export function inviteEmail(
  fullName: string,
  clientName: string,
  registerUrl: string,
): { subject: string; html: string; text: string } {
  const subject = `You've been invited to the Warehouse portal — ${clientName}`;
  const text = `Hi ${fullName},\n\nYou've been invited to access the Warehouse portal on behalf of ${clientName}. Set your password to activate your account:\n${registerUrl}\n\nThis link expires in 7 days. If you weren't expecting this, you can ignore this email.`;
  const html = `
    <p>Hi ${fullName},</p>
    <p>You've been invited to access the Warehouse portal on behalf of <strong>${clientName}</strong>.</p>
    <p><a href="${registerUrl}">Set your password to activate your account</a></p>
    <p style="color:#666;font-size:13px;">This link expires in 7 days. If you weren't expecting this, you can ignore this email.</p>
  `;
  return { subject, html, text };
}
