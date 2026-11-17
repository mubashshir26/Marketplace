const PDFDocument = require('pdfkit');

// The built-in PDF fonts only cover Latin characters, so anything else (Hindi names, emoji)
// becomes "?" instead of garbage. The rupee sign is not in them either, hence "Rs.".
const clean = (s) => String(s ?? '').replace(/[^\x20-\x7E\u00A0-\u00FF\n]/g, '?');
const rs = (n) => `Rs. ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

const LEFT = 50;
const RIGHT = 545;
const COLS = { name: [LEFT, 270], qty: [325, 40], price: [370, 80], amount: [455, 90] }; // [x, width]

// Builds the invoice for one order (one shop's part of a checkout) and resolves to a PDF Buffer.
function buildInvoice({ order, shopName }) {
  return new Promise((resolve, reject) => {
    const number = `INV-${order.orderNumber}`;
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Invoice ${number}`, Author: 'Marketplace' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const a = order.shippingAddress || {};
    const rule = (y) => doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(0.5).strokeColor('#bbbbbb').stroke();

    // Header
    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(24).text('INVOICE', LEFT, 50);
    doc.font('Helvetica').fontSize(10).fillColor('#444444');
    doc.text(`Invoice no: ${number}`, 300, 52, { width: 245, align: 'right' });
    doc.text(`Order no: ${order.orderNumber}`, 300, 66, { width: 245, align: 'right' });
    doc.text(`Date: ${date(order.createdAt)}`, 300, 80, { width: 245, align: 'right' });

    // Seller / buyer
    let y = 120;
    doc.fillColor('#888888').fontSize(9).text('SOLD BY', LEFT, y).text('BILL TO / SHIP TO', 300, y);
    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(11).text(clean(shopName || 'Shop'), LEFT, y + 14, { width: 220 });
    doc.font('Helvetica').fontSize(9).fillColor('#444444').text('via Marketplace', LEFT, doc.y + 2, { width: 220 });
    const sellerEnd = doc.y;
    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(11).text(clean(a.name), 300, y + 14, { width: 245 });
    doc.font('Helvetica').fontSize(9).fillColor('#444444').text(
      clean([a.line1, a.line2, `${a.city || ''}, ${a.state || ''} ${a.pincode || ''}`, a.phone ? `Phone: ${a.phone}` : ''].filter(Boolean).join('\n')),
      300, doc.y + 2, { width: 245 }
    );

    // Items table
    y = Math.max(doc.y, sellerEnd, 190) + 20;
    const header = (top) => {
      rule(top - 6);
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#444444');
      doc.text('ITEM', COLS.name[0], top, { width: COLS.name[1] });
      doc.text('QTY', COLS.qty[0], top, { width: COLS.qty[1], align: 'right' });
      doc.text('PRICE', COLS.price[0], top, { width: COLS.price[1], align: 'right' });
      doc.text('AMOUNT', COLS.amount[0], top, { width: COLS.amount[1], align: 'right' });
      rule(top + 14);
      return top + 22;
    };
    y = header(y);

    doc.font('Helvetica').fontSize(10).fillColor('#111111');
    for (const item of order.items) {
      const name = clean(item.name);
      const h = Math.max(doc.heightOfString(name, { width: COLS.name[1] }), 12);
      if (y + h > 740) {
        doc.addPage();
        y = header(60);
        doc.font('Helvetica').fontSize(10).fillColor('#111111');
      }
      doc.text(name, COLS.name[0], y, { width: COLS.name[1] });
      doc.text(String(item.qty), COLS.qty[0], y, { width: COLS.qty[1], align: 'right' });
      doc.text(rs(item.price), COLS.price[0], y, { width: COLS.price[1], align: 'right' });
      doc.text(rs(item.price * item.qty), COLS.amount[0], y, { width: COLS.amount[1], align: 'right' });
      y += h + 8;
    }
    rule(y);
    y += 12;

    // Totals (kept together on one page)
    if (y > 650) { doc.addPage(); y = 60; }
    const line = (label, value, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10).fillColor('#111111');
      doc.text(label, 320, y, { width: 130 });
      doc.text(value, COLS.amount[0], y, { width: COLS.amount[1], align: 'right' });
      y += bold ? 20 : 16;
    };
    line('Subtotal', rs(order.subtotal));
    if (order.discount > 0) line(`Discount${order.coupon?.code ? ` (${clean(order.coupon.code)})` : ''}`, `- ${rs(order.discount)}`);
    rule(y - 2);
    y += 6;
    line('Total', rs(order.total), true);

    // Payment
    y += 10;
    const p = order.payment || {};
    const how = p.method === 'cod' ? 'Cash on delivery' : 'Paid online';
    const state = p.status === 'paid' ? `paid${p.paidAt ? ` on ${date(p.paidAt)}` : ''}` : String(p.status || 'pending').replace('_', ' ');
    doc.font('Helvetica').fontSize(10).fillColor('#444444').text(`Payment: ${how} (${state})`, LEFT, y);

    doc.fontSize(8).fillColor('#888888').text(
      'This is a computer-generated invoice and does not need a signature.',
      LEFT, 780, { width: RIGHT - LEFT, align: 'center', lineBreak: false }
    );
    doc.end();
  });
}

module.exports = { buildInvoice };