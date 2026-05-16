export function generateSaleInvoiceNumber(): string {
  const ts = Date.now();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `INV-${ts}-${rand}`;
}
