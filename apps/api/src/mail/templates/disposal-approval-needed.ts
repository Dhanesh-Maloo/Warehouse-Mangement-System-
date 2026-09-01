export function disposalApprovalNeededEmail(input: {
  assetLabel: string;
  disposalType: string;
  ivalueTicketNumber?: string | null;
}): { subject: string; html: string; text: string } {
  const subject = `Disposal request awaiting approval — ${input.assetLabel}`;
  const ticketLine = input.ivalueTicketNumber ? `iValue ticket: ${input.ivalueTicketNumber}\n` : '';
  const text = `A new disposal request needs your approval.\n\nAsset: ${input.assetLabel}\nDisposal type: ${input.disposalType}\n${ticketLine}\nPlease review it in the Disposal module.`;
  const html = `
    <p>A new disposal request needs your approval.</p>
    <ul>
      <li><strong>Asset:</strong> ${input.assetLabel}</li>
      <li><strong>Disposal type:</strong> ${input.disposalType}</li>
      ${input.ivalueTicketNumber ? `<li><strong>iValue ticket:</strong> ${input.ivalueTicketNumber}</li>` : ''}
    </ul>
    <p>Please review it in the Disposal module.</p>
  `;
  return { subject, html, text };
}
