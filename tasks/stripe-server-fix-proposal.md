# Stripe crediting — server hardening proposal (DRAFT — not applied)

> **Status (updated 2026-07-27):** APPLIED to the live `unspun` DB (project
> `alxqtmqsjckragnsbwqw`) and the code swapped into `api/verify-payment.js` locally.
> **Not deployed to Vercel and not committed** — awaiting Tyler.
>
> What actually happened vs. the plan below:
> - STEP 1 (dup pre-check): moot — a UNIQUE constraint already existed, so duplicates are
>   impossible (0 by definition).
> - STEP 2 (add unique constraint): **already present** as `purchases_stripe_session_id_key`
>   — skipped (re-adding would error).
> - STEP 3 (`redeem_purchase` function + grants): **applied** via migration
>   `create_redeem_purchase_function`. Verified live with zero side effects: idempotency call
>   on an existing session → `already_processed` (no writes); a `DO`-block credited-path test
>   returned `{"status":"credited","credits_added":3}` then rolled back (credits/purchases
>   unchanged).
> - STEP 4 (swap `api/verify-payment.js`): **done locally** (not deployed).
>
> H2 not started. `-1` unlimited sentinel confirmed and preserved in the function.

Fixes **H1** (paid-but-uncredited, then permanently locked), **M2** (insert result ignored),
and the underlying race by making "record purchase + grant credits" a single atomic,
idempotent operation backed by a unique constraint.

**Nothing here has been applied.** Review the SQL, then tell me to proceed. Rollout order at
the bottom matters — the DB objects must exist before the new `verify-payment.js` deploys.

---

## Problem recap

Current `verify-payment.js` does three separate, non-atomic REST calls:

1. `SELECT` from `purchases` for this `stripe_session_id` (idempotency check)
2. `INSERT` a `purchases` row  ← result never checked (M2)
3. `increment_credits` RPC     ← runs unconditionally after the insert

Failure modes:
- If step 3 fails after step 2 inserted → **paid, no credits, and step 1 blocks every retry
  forever** (H1).
- Two concurrent runs both pass step 1 before either inserts → **double credit** (race).

---

## Proposed fix

### 1. Unique constraint on `purchases.stripe_session_id`

First check for pre-existing duplicates (the ALTER fails if any exist):

```sql
-- Pre-check: must return 0 rows before adding the constraint.
select stripe_session_id, count(*)
from public.purchases
group by stripe_session_id
having count(*) > 1;
```

Then:

```sql
alter table public.purchases
  add constraint purchases_stripe_session_id_key unique (stripe_session_id);
```

### 2. One atomic, idempotent redeem function

Replaces the SELECT + INSERT + increment with a single transaction:

```sql
create or replace function public.redeem_purchase(
  p_user_id    uuid,
  p_session_id text,
  p_credits    int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  -- Atomic idempotency: only the first redemption of a session inserts a row.
  insert into public.purchases (user_id, stripe_session_id, credits_added)
  values (p_user_id, p_session_id, p_credits)
  on conflict (stripe_session_id) do nothing;

  get diagnostics v_rows = row_count;      -- 0 => this session was already redeemed
  if v_rows = 0 then
    return jsonb_build_object('status', 'already_processed');
  end if;

  -- Same transaction: grant the credits. If this UPDATE fails, the whole tx (including
  -- the purchase row just inserted) rolls back — so the session can be retried cleanly.
  -- No paid-but-uncredited state, and no permanent lock.
  update public.profiles
     set audit_credits = case
           when audit_credits = -1 then -1            -- keep "unlimited" accounts unlimited
           else audit_credits + p_credits
         end
   where id = p_user_id;

  return jsonb_build_object('status', 'credited', 'credits_added', p_credits);
end;
$$;
```

> **Confirmed by Tyler (2026-07-27):**
> - ✅ `-1` is still the unlimited sentinel — the `case when audit_credits = -1` guard preserves
>   it so a pack purchase can never overwrite unlimited with a finite number.
> - This intentionally does **not** touch the referral-reward logic — that stays best-effort
>   in the app layer (a referral hiccup must not roll back a real purchase).

### 3. `verify-payment.js` — replace steps 3–5 with one call

Everything before (JWT verify, Stripe paid check, amount→credits) and after (referral reward,
final response) stays the same. Only the middle changes:

```js
  // 3+4+5. Atomically record the purchase and grant credits (idempotent + race-safe).
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
  if (redeem.status === 'already_processed') {
    return res.status(200).json({ already_processed: true, message: 'Credits already applied' });
  }
  // redeem.status === 'credited' → fall through to the (unchanged) referral-reward block,
  // then: return res.status(200).json({ credits_added: creditsToAdd });
```

This removes the standalone SELECT (old step 3), INSERT (old step 4, closing M2), and
`increment_credits` call (old step 5) for the *buyer's own* credits. `increment_credits` is
still used for the referral reward and stays as-is.

---

## Why this closes the findings

- **H1** — insert + credit are now one transaction. Credit failure rolls back the purchase
  row, so retry works and there's no permanent "already_processed but uncredited" lock.
- **M2** — no more separate unchecked insert; the RPC's `ON CONFLICT` is the idempotency.
- **Race / M1 (server side)** — the unique constraint + `ON CONFLICT DO NOTHING` serialize
  concurrent redemptions; exactly one credits, the rest return `already_processed`.

## Rollout order (important) — ✅ confirmed correct by Tyler (2026-07-27)

1. Run the duplicate **pre-check**; dedupe if it returns anything.
2. Add the **unique constraint**.
3. Create the **`redeem_purchase`** function.
4. Deploy the new **`verify-payment.js`**.

Steps 1–3 are backward-compatible with the current code, so they can go first safely. The new
`verify-payment.js` (step 4) must not deploy before the function exists.

## Not in this change (tracked separately)

- **H2** — amount→credits still keys off `amount_total`. Fine today (referral discount is
  manual, not a Stripe coupon). Follow-up: switch the lookup to the **price ID / line item**
  so a future Stripe-applied discount can't break crediting.
