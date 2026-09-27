import type { OrderDto } from '@prochia/shared';
import { formatTime, formatToman, toFaDigits } from '@prochia/shared';

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Prints an 80 mm kitchen/counter slip through the system print dialog (thermal printers
 * installed on Windows appear there). One section per station, so the slip can be torn apart.
 */
export function printOrder(order: OrderDto, gymName: string) {
  const sections = order.tickets
    .filter((t) => t.status !== 'cancelled')
    .map((t) => {
      const lines = order.lines
        .filter((l) => l.stationId === t.stationId && !l.removed)
        .map(
          (l) =>
            `<tr><td class="q">${toFaDigits(l.quantity)}×</td><td>${esc(l.name)}${l.options.length ? `<div class="o">${esc(l.options.map((o) => o.name).join('، '))}</div>` : ''}${l.note ? `<div class="o">★ ${esc(l.note)}</div>` : ''}</td></tr>`,
        )
        .join('');
      return `<section><h2>${esc(t.stationName)}${t.floorLabel ? ` · ${esc(t.floorLabel)}` : ''}</h2><table>${lines}</table></section>`;
    })
    .join('<hr/>');

  const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>سفارش ${toFaDigits(order.number)}</title>
<style>
@page { size: 80mm auto; margin: 3mm; }
body { font-family: 'Estedad Variable', Tahoma, sans-serif; width: 74mm; margin: 0; color: #000; font-size: 13px; }
h1 { font-size: 40px; margin: 0; text-align: center; line-height: 1.1; }
h2 { font-size: 15px; margin: 8px 0 4px; border-bottom: 2px solid #000; }
.meta { text-align: center; font-size: 12px; }
table { width: 100%; border-collapse: collapse; }
td { padding: 3px 0; vertical-align: top; font-size: 15px; font-weight: 700; }
td.q { width: 28px; }
.o { font-size: 11px; font-weight: 400; }
.note { border: 1.5px solid #000; padding: 4px; margin-top: 6px; }
hr { border: 0; border-top: 1px dashed #000; margin: 8px 0; }
</style></head><body>
<div class="meta">پروچیا ${esc(gymName)}</div>
<h1>${toFaDigits(order.number)}</h1>
<div class="meta">${order.spot ? esc(order.spot.label) : 'تحویل حضوری'} · ${formatTime(new Date(order.createdAt))}${order.scheduledFor ? ` · پیش‌سفارش ${formatTime(new Date(order.scheduledFor))}` : ''}</div>
<div class="meta">${esc(order.member?.name ?? '')}</div>
${sections}
${order.note ? `<div class="note">${esc(order.note)}</div>` : ''}
<hr/><div class="meta">${order.paymentState === 'paid' ? 'پرداخت شده' : order.paymentState === 'postpaid' ? 'اعتباری' : `قابل پرداخت: ${formatToman(order.total - order.paidAmount)}`}</div>
</body></html>`;

  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => frame.remove(), 1000);
  };
}
