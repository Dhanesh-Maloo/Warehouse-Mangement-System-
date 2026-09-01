export function resaleListingCreatedEmail(input: {
  assetLabel: string;
  listedPricePaise?: bigint | null;
}): { subject: string; html: string; text: string } {
  const subject = `New resale listing created — ${input.assetLabel}`;
  const priceLine =
    input.listedPricePaise != null
      ? `Listed price: ₹${(Number(input.listedPricePaise) / 100).toLocaleString('en-IN')}\n`
      : '';
  const text = `A new resale listing was created.\n\nAsset: ${input.assetLabel}\n${priceLine}\nView it in the Resale module.`;
  const html = `
    <p>A new resale listing was created.</p>
    <ul>
      <li><strong>Asset:</strong> ${input.assetLabel}</li>
      ${
        input.listedPricePaise != null
          ? `<li><strong>Listed price:</strong> ₹${(Number(input.listedPricePaise) / 100).toLocaleString('en-IN')}</li>`
          : ''
      }
    </ul>
    <p>View it in the Resale module.</p>
  `;
  return { subject, html, text };
}
