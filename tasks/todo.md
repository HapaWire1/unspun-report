# Unspun Bounce-Reduction — Batch 1 (P1–P3)

Source: `UNSPUN_TECHNICAL_HANDOFF_FOR_CLAUDE.md` (PR #3). Scope confirmed by Tyler: do the
top 3 priorities in one batch, review, then continue with mobile/glossary/tracking.

Gating decision: **unlimited zero-auth free audits** (handoff Section 1 — "do not force
account creation"). Remove the broken sign-up wall entirely.

Guardrail: all changes local + verified in preview. **No commit/deploy until Tyler reviews.**
Preserve the "files never leave your browser" promise (all parsing + PDF gen stays client-side).

---

## P1 — Zero-auth free audit path + magic-link cleanup

- [ ] Remove broken `#anon-gate` WIP wall in `handleFiles` (throws — element doesn't exist)
- [ ] Remove `unspun_anon_used` localStorage gating → anon audits are unlimited & free
- [ ] Soften `#anon-save-banner`: opt-in (email hidden until user clicks "Save / email"),
      fix stale "get 2 more free audits" copy
- [ ] Remove dead legacy `#auth-gate` block (hidden, confusing "no sign-in needed" button)
- [ ] Payment dead-end: `success.html` stash `session_id` when signed-out; reclaim after
      sign-in on index (idempotent — verify-payment already dedupes). FLAG for live Stripe test.

## P2 — Sample files + "what files do I need" + parser feedback

- [ ] Add "What files do I need?" expandable panel by the drop zone (export-setting tips)
- [ ] Create downloadable samples: `samples/unspun-sample-google-ads-report.csv` +
      `samples/unspun-sample-agency-invoice.pdf`
- [ ] Add "Try with sample data" button → parses embedded sample CSV via the real parser,
      sets sample fee, renders as a credit-free sample (reuses demo semantics)
- [ ] Parser feedback: extraction summary ("Found: spend $X · clicks Y · …") + confidence
      indicator; more specific partial/failure messages

## P3 — Post-audit PDF + clear next actions

- [ ] Add jsPDF (client-side) + "Download PDF report" primary CTA (branded, full breakdown,
      verdict, glossary, notes-for-your-agency space)
- [ ] Keep Print as secondary
- [ ] Add `#next-steps` block: "Talk to us about this" + gentle pricing nudge (anon only)

---

## Review

**Status: P1–P3 complete, verified in preview. Not committed/deployed — awaiting Tyler.**

Files changed: `index.html` (+349/-22), `success.html`, new `samples/` (CSV + PDF).

Verified in the browser (localhost:5176):
- No console errors on load.
- "Try with sample data" → real CSV parser → correct values, "High confidence" badge.
- Real upload of both sample files → invoice PDF parsed (fee $1,450) + CSV report parsed.
- Save prompt is opt-in (email hidden until "Save & email me this" clicked).
- P/L calc flips profit/loss correctly ($300 → +$192.13; $80 → -$27.86).
- Download PDF: jsPDF loads, generates a valid PDF with **zero errors / no throw** on a
  clean call (earlier console noise was from my test instrumentation, not the feature).

**Needs a live test (couldn't exercise in preview):**
- Stripe pay → success.html → sign-in → auto-reclaim of credits. Logic is idempotent and
  safe, but the real Stripe round-trip needs one live purchase to confirm end-to-end.

---

## Batch 2 — P4–P6 (mobile, glossary tooltips, tracking)

**Status: complete, verified in preview. Not committed/deployed — awaiting Tyler's click-through.**

### P4 — Mobile
- [x] Audit tool + report: reduced padding, stacked upload buttons, wrapping report-actions,
      full-width P/L input, single-column next-steps, table padding.
- [x] Fixed page-wide horizontal scroll on phones (was 121px). Root cause: CSS-grid `1fr`
      tracks blowing out to content min-width. Fixed `.case-grid` + `.hero` with
      `minmax(0,1fr)` (≤900px only) and stacked the hero trust line (≤600px). **Now 0px
      overflow at 375px; desktop layout unchanged (verified case-grid 2-col + hero 2-col at 1280px).**

### P5 — Glossary tooltips
- [x] 5 inline "i" tooltips on key report numbers (Total Cost, CTR, Cost/conversion,
      Conversion Rate, Blended Cost). CSS-only hover + keyboard/tap focus, aria-labels,
      edge-capped width. Glossary table retained.

### P6 — Tracking events (Vercel Web Analytics custom events, fully guarded no-op if unloaded)
- [x] audit_started, parse_succeeded/parse_failed (w/ reason + confidence), audit_completed,
      customer_value_entered, sample_data_used, save_prompt_opened, magic_link_requested,
      pdf_downloaded, pricing_cta_clicked, pack_purchase_started/_completed, purchase_reclaimed.
- [x] Verified all events fire with correct payloads via a stubbed `window.va`; 0 errors.

### Extra fix (surfaced by tracking) — pre-existing bug
- [x] `handleFiles` never reset `data` between runs → a failed/2nd upload showed the PREVIOUS
      run's numbers as if fresh. Now resets per run: bad file correctly fires `parse_failed`,
      hides the report, shows the error. (Note: drop invoice+report together — one call.)

---

## Batch 3 — Handoff priority #4: customer value clarity + scenario editing (§3)

**Status: complete, verified in preview. Not committed — awaiting Tyler.**

- [x] Clearer prompt "What is a new customer worth to you?" + guidance copy (avg revenue per
      new customer / first-90-day value; use a conservative estimate).
- [x] **Live scenario editing** — verdict recalculates as you type (oninput), no button hunt;
      "Update" button kept as a fallback affordance.
- [x] **Transparent math** block: "$1,450 agency + $2,217 ad spend = $3,667 total ÷ 34
      conversions = $107.87 true cost per customer; a customer worth $300 → +$192.13 profit."
- [x] Verdict auto-shows on report render (default $300) instead of waiting for a click.
- [x] Plainer verdict copy ("You keep $X on every new customer" / "costs $X more than worth").
- [x] Penny-reconciliation fix: true cost + profit now sums exactly to customer value.
- [x] Analytics: customer_value_entered fires once on commit (change), not per keystroke.

### Still open for Tyler
- **Stripe reclaim path — READY for a live test purchase** (implemented in batch 1).
- **Commit** is being held per Tyler's instruction until after the live Stripe test.
</content>
