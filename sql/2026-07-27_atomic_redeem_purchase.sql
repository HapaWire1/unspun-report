-- ============================================================================
-- Atomic, idempotent Stripe purchase redemption
-- Fixes: H1 (paid-but-uncredited + permanent lock), M2 (unchecked insert),
--        and the concurrent double-credit race.
-- ----------------------------------------------------------------------------
-- STATUS: NOT YET APPLIED. Prepared 2026-07-27, approved in principle by Tyler.
-- Do NOT run against the live database until Tyler gives the go.
--
-- RUN ORDER (each step is backward-compatible with the CURRENTLY deployed
-- verify-payment.js, so steps 1-3 are safe to run before the code deploys):
--   1. Run the PRE-CHECK. It must return ZERO rows before continuing.
--   2. Add the unique constraint.
--   3. Create the redeem_purchase() function + grant.
--   4. THEN deploy the new verify-payment.js (never before this file is applied).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- STEP 1 — PRE-CHECK (read-only). Must return 0 rows. If it returns anything,
-- there are duplicate purchase rows for a single Stripe session; resolve those
-- by hand before adding the unique constraint (do NOT blind-delete — inspect).
-- ---------------------------------------------------------------------------
select stripe_session_id, count(*)
from public.purchases
group by stripe_session_id
having count(*) > 1;


-- ---------------------------------------------------------------------------
-- STEP 2 — Unique constraint: a Stripe session can only ever be redeemed once.
-- This is the backstop that makes idempotency race-safe.
-- ---------------------------------------------------------------------------
alter table public.purchases
  add constraint purchases_stripe_session_id_key unique (stripe_session_id);


-- ---------------------------------------------------------------------------
-- STEP 3 — Atomic redeem function.
-- Inserts the purchase row and grants the credits in ONE transaction:
--   * ON CONFLICT DO NOTHING + row_count => idempotent and race-safe.
--   * If the credit UPDATE fails, the whole tx (including the inserted purchase
--     row) rolls back, so the session can be retried cleanly — no paid-but-
--     uncredited state and no permanent "already_processed" lock.
--   * The `-1` guard preserves the unlimited sentinel (confirmed by Tyler).
-- ---------------------------------------------------------------------------
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
  insert into public.purchases (user_id, stripe_session_id, credits_added)
  values (p_user_id, p_session_id, p_credits)
  on conflict (stripe_session_id) do nothing;

  get diagnostics v_rows = row_count;      -- 0 => this session was already redeemed
  if v_rows = 0 then
    return jsonb_build_object('status', 'already_processed');
  end if;

  update public.profiles
     set audit_credits = case
           when audit_credits = -1 then -1            -- keep "unlimited" accounts unlimited
           else audit_credits + p_credits
         end
   where id = p_user_id;

  return jsonb_build_object('status', 'credited', 'credits_added', p_credits);
end;
$$;

-- Only the server (service_role) ever calls this; keep it off the anon/auth roles.
revoke all on function public.redeem_purchase(uuid, text, int) from public, anon, authenticated;
grant execute on function public.redeem_purchase(uuid, text, int) to service_role;


-- ---------------------------------------------------------------------------
-- OPTIONAL — post-deploy sanity check (safe to run; rolls itself back).
-- Replace <a-real-user-uuid> to try it against a throwaway session id.
-- ---------------------------------------------------------------------------
-- begin;
--   select public.redeem_purchase('<a-real-user-uuid>'::uuid, 'test_sess_ROLLBACK_ME', 3); -- credited
--   select public.redeem_purchase('<a-real-user-uuid>'::uuid, 'test_sess_ROLLBACK_ME', 3); -- already_processed
-- rollback;
