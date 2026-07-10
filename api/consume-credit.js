export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { access_token } = req.body;
  if (!access_token) {
    return res.status(400).json({ error: 'Missing access_token' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // 1. Verify user JWT
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${access_token}`, apikey: SUPABASE_ANON_KEY }
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid token' });
  const user = await userRes.json();

  // 2. Atomically check-and-spend one credit server-side (see consume_credit() SQL function)
  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/consume_credit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      apikey: SUPABASE_SERVICE_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_user_id: user.id })
  });

  if (!rpcRes.ok) {
    const err = await rpcRes.text();
    return res.status(500).json({ error: 'Failed to check credits', detail: err });
  }

  const allowed = await rpcRes.json();

  if (!allowed) {
    return res.status(402).json({ allowed: false, error: 'No audits remaining' });
  }

  // 3. Return the fresh balance so the client can update its display without trusting its own prior state
  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=audit_credits`,
    { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, apikey: SUPABASE_SERVICE_KEY } }
  );
  const profile = await profileRes.json();

  return res.status(200).json({ allowed: true, remaining: profile[0]?.audit_credits ?? null });
}
