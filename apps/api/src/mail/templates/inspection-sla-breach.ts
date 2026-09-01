export function inspectionSlaBreachEmail(input: { assetLabel: string; slaTargetAt: Date }): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `SLA breached — inspection for ${input.assetLabel}`;
  const targetStr = input.slaTargetAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const text = `An in-progress inspection has breached its SLA.\n\nAsset: ${input.assetLabel}\nSLA target: ${targetStr} IST\n\nPlease review it in the Inspections module.`;
  const html = `
    <p>An in-progress inspection has breached its SLA.</p>
    <ul>
      <li><strong>Asset:</strong> ${input.assetLabel}</li>
      <li><strong>SLA target:</strong> ${targetStr} IST</li>
    </ul>
    <p>Please review it in the Inspections module.</p>
  `;
  return { subject, html, text };
}
