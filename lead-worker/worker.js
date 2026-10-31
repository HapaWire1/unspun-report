const F = ['kind','name','business','email','phone','website','spend_band','has_agency','slot1','slot2','notes','audit_json','utm_source','utm_medium','utm_campaign','utm_content','utm_term','referrer','landing'];
const KINDS = ['report_unlock','dfy_audit','booking'];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', ...CORS } });
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/api/lead' && req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/api/lead' && req.method === 'POST') return lead(req, env);
    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
    const res = await env.ASSETS.fetch(req);
    const h = new Headers(res.headers); h.set('x-robots-tag', 'noindex'); // preview only
    return new Response(res.body, { status: res.status, headers: h });
  }
};

async function lead(req, env) {
  let b; try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  if (b.company_fax) return json({ ok: true }); // honeypot
  const r = {}; for (const k of F) r[k] = b[k] == null ? null : String(b[k]).slice(0, k === 'audit_json' ? 4000 : 500).trim();
  if (!KINDS.includes(r.kind)) return json({ error: 'bad kind' }, 400);
  if (!r.name || !r.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email) || !r.phone || r.phone.replace(/\D/g, '').length < 10)
    return json({ error: 'Please add your name, a valid email and a phone number.' }, 400);
  const country = req.cf?.country || null, ua = (req.headers.get('user-agent') || '').slice(0, 300);
  const cols = [...F, 'ip_country', 'user_agent'];
  const created_at = new Date().toISOString();
  const id = created_at.replace(/\D/g, '').slice(0, 14) + '-' + crypto.randomUUID().slice(0, 6);
  const rec = { id, created_at, ...r, ip_country: country, user_agent: ua, status: 'new', notified: false };
  const key = `lead:${created_at}:${id}`;
  await env.LEADS.put(key, JSON.stringify(rec), { metadata: { kind: r.kind, email: r.email, business: r.business, spend_band: r.spend_band } });
  let notified = false;
  try {
    const label = { report_unlock: 'Ran the audit + unlocked report', dfy_audit: 'Wants a DONE-FOR-YOU audit', booking: 'REQUESTED A CALL' }[r.kind];
    const rows = cols.filter(k => r[k] || k === 'ip_country').map(k => `<tr><td style="padding:3px 10px 3px 0;color:#666">${k}</td><td>${esc(k === 'ip_country' ? country : r[k])}</td></tr>`).join('');
    const tel = r.phone.replace(/[^\d+]/g, '');
    const html = `<h2 style="margin:0">🔥 Unspun lead #${id}: ${esc(label)}</h2>
<p><b>${esc(r.name)}</b> · ${esc(r.business || '')} · spend ${esc(r.spend_band || '?')} · agency: ${esc(r.has_agency || '?')}</p>
<p>Visitor was sent straight to your booking calendar. Watch for a Google Calendar booking. ${r.kind === "dfy_audit" ? "<b>To do: record the Loom snapshot (promised within 1 business day).</b> " : ""}${r.kind === "booking" ? "<b>To do: they asked for these times, confirm one by email.</b> " : ""}Contact: <a href="mailto:${esc(r.email)}">${esc(r.email)}</a> · ${esc(r.phone)}</p>
<table style="font:13px sans-serif">${rows}</table>`;
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.NOTIFY_FROM, to: [env.NOTIFY_TO], reply_to: r.email, subject: `Unspun lead: ${label} - ${r.business || r.name} (${r.spend_band || '?'})`, html })
    });
    notified = resp.ok;
    if (notified) await env.LEADS.put(key, JSON.stringify({ ...rec, notified: true }), { metadata: { kind: r.kind, email: r.email, business: r.business, spend_band: r.spend_band } });
  } catch (e) { }
  return json({ ok: true, id, notified });
}
