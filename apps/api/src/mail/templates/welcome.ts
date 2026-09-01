export function welcomeEmail(fullName: string): { subject: string; html: string; text: string } {
  const subject = 'Your Warehouse account has been created';
  const text = `Hi ${fullName},\n\nAn account has been created for you on the Warehouse platform. You can log in with the email address this was sent to and the password provided to you separately.\n\nIf you weren't expecting this, please contact your administrator.`;
  const html = `
    <p>Hi ${fullName},</p>
    <p>An account has been created for you on the Warehouse platform. You can log in with the email address this was sent to and the password provided to you separately.</p>
    <p>If you weren't expecting this, please contact your administrator.</p>
  `;
  return { subject, html, text };
}
