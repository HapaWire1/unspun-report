export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { session_id, access_token } = req.body;
  if (!session_id || !access_token) {
    return res.status(400).json({ error: 'Missing session_id or access_token' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;

  // 1. Verify user JWT
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${access_token}`, apikey: SUPABASE_ANON_KEY }
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid token' });
  const user = await userRes.json();

  // 2. Verify Stripe session is paid
  const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session_id}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET}` }
  });
  if (!stripeRes.ok) return res.status(400).json({ error: 'Invalid Stripe session' });
  const session = await stripeRes.json();
  if (session.payment_status !== 'paid') {
    return res.status(400).json({ error: 'Payment not completed' });
  }

  // Three packs, each granting a different number of credits: 3/$79, 6/$139, 9/$179.
  // Key off amount_SUBTOTAL (the pre-discount list price), NOT amount_total. A promotion
  // code applied at Stripe checkout — e.g. the REF5 referral code (-$5) advertised on the
  // site — lowers amount_total (7900 -> 7400) but leaves amount_subtotal at the list price.
  // Keying off amount_total silently broke crediting for every referred buyer: they were
  // charged the discounted amount and granted zero credits. amount_subtotal is immune to
  // any coupon (fixed or percentage), so referral discounts and crediting now coexist.
  // This still needs updating if the list prices themselves ever change in Stripe.
  const CREDITS_BY_SUBTOTAL_CENTS = { 7900: 3, 13900: 6, 17900: 9 };
  const creditsToAdd = CREDITS_BY_SUBTOTAL_CENTS[session.amount_subtotal];
  if (!creditsToAdd) {
    return res.status(400).json({
      error: `Unrecognized payment amount: subtotal=${session.amount_subtotal} total=${session.amount_total}`
    });
  }

  // 3. Atomically record the purchase AND grant the credits in one transaction.
  // redeem_purchase inserts the purchases row (unique on stripe_session_id) and
  // increments the buyer's credits together, so a session can never be credited
  // twice (idempotent + race-safe), and a failed credit rolls back the purchase
  // row instead of leaving a paid-but-uncredited account permanently locked.
  const redeemRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/redeem_purchase`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      apikey: SUPABASE_SERVICE_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_user_id: user.id, p_session_id: session_id, p_credits: creditsToAdd })
  });
  if (!redeemRes.ok) {
    const err = await redeemRes.text();
    return res.status(500).json({ error: 'Failed to redeem purchase', detail: err });
  }
  const redeem = await redeemRes.json();
  if (redeem?.status === 'already_processed') {
    return res.status(200).json({ already_processed: true, message: 'Credits already applied' });
  }

  // 4. Referral reward — +1 credit to whoever referred this buyer, once, on their first purchase.
  // Best-effort: never let a referral hiccup block the buyer's own confirmed purchase.
  try {
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=referred_by,referral_reward_given`,
      { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, apikey: SUPABASE_SERVICE_KEY } }
    );
    const [buyerProfile] = await profileRes.json();

    if (buyerProfile?.referred_by && !buyerProfile.referral_reward_given) {
      // Atomic claim: only proceeds if this row still says false, so a second purchase
      // (or a race between two requests) can never grant the reward twice.
      const claimRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&referral_reward_given=eq.false`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            apikey: SUPABASE_SERVICE_KEY,
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
          },
          body: JSON.stringify({ referral_reward_given: true })
        }
      );
      const claimed = await claimRes.json();

      if (claimed.length > 0) {
        const referrerRes = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?referral_code=eq.${encodeURIComponent(buyerProfile.referred_by)}&select=id`,
          { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, apikey: SUPABASE_SERVICE_KEY } }
        );
        const [referrer] = await referrerRes.json();
        if (referrer) {
          await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_credits`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
              apikey: SUPABASE_SERVICE_KEY,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ user_id: referrer.id, amount: 1 })
          });
        }
      }
    }
  } catch (_) {
    // Referral reward is best-effort — the buyer's purchase above already succeeded.
  }

  return res.status(200).json({ credits_added: creditsToAdd });
}
