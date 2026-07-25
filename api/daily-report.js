// Runs daily via Vercel Cron (see vercel.json). Pulls last-24h and lifetime
// numbers from both product databases and emails a plain-English summary.
//
// Required env vars (Unspun project already has the first two):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY        — Unspun's own DB (already configured)
//   DOPPELPOD_SUPABASE_URL                          — https://qrahacjalhupgtwsmbwd.supabase.co
//   DOPPELPOD_SUPABASE_SERVICE_KEY                  — DoppelPod's service_role key
//   RESEND_API_KEY                                  — sending-access key for unspun.report
//   REPORT_TO_EMAIL                                 — where to send it (defaults to tyler@hapawire.com)
//   CRON_SECRET                                     — Vercel sets the Authorization header to match this automatically

export default async function handler(req, res) {
  // Fail closed: if the secret isn't configured, refuse to run rather than leaving
  // the endpoint publicly triggerable (it emails business metrics + reads two DBs).
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(503).json({ error: 'CRON_SECRET not configured' });
  }
  // Authenticate via the Authorization header only. Vercel Cron sends
  // `Authorization: Bearer <CRON_SECRET>` automatically. The previous `?secret=`
  // query-param path was removed — secrets in URLs leak into server, proxy, and
  // browser-history logs. To trigger manually, pass the header instead:
  //   curl -H "Authorization: Bearer $CRON_SECRET" https://unspun.report/api/daily-report
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const [unspun, doppelpod] = await Promise.all([
      getUnspunStats().catch(err => ({ error: err.message })),
      getDoppelPodStats().catch(err => ({ error: err.message })),
    ]);

    const html = renderEmail({ unspun, doppelpod });
    await sendEmail(html);

    return res.status(200).json({ sent: true, unspun, doppelpod });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function sbQuery(baseUrl, serviceKey, path) {
  const res = await fetch(`${baseUrl}/rest/v1/${path}`, {
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      Prefer: 'count=exact',
    },
  });
  if (!res.ok) throw new Error(`Supabase query failed (${res.status}): ${path}`);
  const contentRange = res.headers.get('content-range'); // e.g. "0-9/42"
  const count = contentRange ? parseInt(contentRange.split('/')[1], 10) : null;
  const data = await res.json();
  return { data, count };
}

async function getUnspunStats() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Unspun Supabase env vars missing');

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [totalProfiles, newProfiles, totalPurchases, newPurchases] = await Promise.all([
    sbQuery(url, key, `profiles?select=id&limit=1`),
    sbQuery(url, key, `profiles?select=id&created_at=gte.${since}&limit=1`),
    sbQuery(url, key, `purchases?select=credits_added,purchased_at&limit=1`),
    sbQuery(url, key, `purchases?select=credits_added,purchased_at&purchased_at=gte.${since}`),
  ]);

  // Revenue isn't stored directly on purchases (only credits_added), so infer the
  // dollar amount from the known pack sizes rather than guessing.
  const PACK_PRICE = { 3: 79, 6: 139, 9: 179 };
  const newRevenue = newPurchases.data.reduce((sum, p) => sum + (PACK_PRICE[p.credits_added] || 0), 0);

  return {
    totalSignups: totalProfiles.count,
    newSignups: newProfiles.count,
    totalPurchases: totalPurchases.count,
    newPurchases: newPurchases.data.length,
    newRevenue,
  };
}

async function getDoppelPodStats() {
  const url = process.env.DOPPELPOD_SUPABASE_URL;
  const key = process.env.DOPPELPOD_SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('DoppelPod Supabase env vars not configured yet');

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [totalProfiles, newProfiles, paidProfiles, newPaidProfiles] = await Promise.all([
    sbQuery(url, key, `profiles?select=id&limit=1`),
    sbQuery(url, key, `profiles?select=id&created_at=gte.${since}&limit=1`),
    sbQuery(url, key, `profiles?select=id&paid_tier=not.is.null&paid_tier=neq.free&limit=1`),
    sbQuery(url, key, `profiles?select=id&paid_tier=not.is.null&paid_tier=neq.free&updated_at=gte.${since}&limit=1`),
  ]);

  return {
    totalSignups: totalProfiles.count,
    newSignups: newProfiles.count,
    totalPaid: paidProfiles.count,
    newPaidUpgrades: newPaidProfiles.count,
  };
}

function fmtPlatform(name, stats) {
  if (stats.error) {
    return `<h3>${name}</h3><p style="color:#C93A3A;">Could not load: ${stats.error}</p>`;
  }
  if (name === 'Unspun') {
    return `
      <h3>${name}</h3>
      <table cellpadding="4" style="font-size:14px;">
        <tr><td>New signups (24h)</td><td><b>${stats.newSignups}</b></td><td style="color:#888;">${stats.totalSignups} total</td></tr>
        <tr><td>New purchases (24h)</td><td><b>${stats.newPurchases}</b></td><td style="color:#888;">${stats.totalPurchases} total</td></tr>
        <tr><td>Revenue (24h)</td><td><b>$${stats.newRevenue.toFixed(2)}</b></td><td></td></tr>
      </table>`;
  }
  return `
    <h3>${name}</h3>
    <table cellpadding="4" style="font-size:14px;">
      <tr><td>New signups (24h)</td><td><b>${stats.newSignups}</b></td><td style="color:#888;">${stats.totalSignups} total</td></tr>
      <tr><td>New paid upgrades (24h)</td><td><b>${stats.newPaidUpgrades}</b></td><td style="color:#888;">${stats.totalPaid} total paying</td></tr>
    </table>`;
}

function renderEmail({ unspun, doppelpod }) {
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:520px;margin:0 auto;">
      <h2>Daily performance — ${dateStr}</h2>
      ${fmtPlatform('Unspun', unspun)}
      ${fmtPlatform('DoppelPod', doppelpod)}
      <p style="color:#888;font-size:12px;margin-top:24px;">Automated report from unspun.report/api/daily-report — last 24 hours, sent daily at 8am Bangkok time.</p>
    </div>`;
}

async function sendEmail(html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY not configured');
  const to = process.env.REPORT_TO_EMAIL || 'tyler@hapawire.com';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Daily Report <reports@unspun.report>',
      to: [to],
      subject: `Daily Report — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend send failed (${res.status}): ${await res.text()}`);
}
