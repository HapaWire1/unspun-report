# Unspun.report — Priority Punch List
**Updated:** 2026-07-26 (after Claude P1–P3 batch)

Quick reference. Work top to bottom.

---

### ✅ Completed (P1–P3 batch)

- [x] Zero-auth free audit path (unlimited anonymous)
- [x] Residual magic-link / “wall after first audit” removed
- [x] Sample files + “Try with sample data”
- [x] “What files do I need?” guidance panel
- [x] Better parser feedback + confidence badge
- [x] Post-audit PDF download (client-side jsPDF)
- [x] “What now?” next steps block

---

### P0 — Must finish / verify before any traffic

- [ ] Live test of Stripe → success → sign-in → auto-reclaim credits loop (one real purchase required)
- [ ] Full click-through of free path on mobile
- [ ] Confirm PDF looks clean and professional on real results

---

### P1 — High impact (next for Claude)

- [ ] Mobile usability pass (tables + drop zone)
- [ ] Visible glossary / tooltips on key numbers
- [ ] Basic funnel event tracking

---

### P2 — Important but can follow

- [ ] Guided + editable customer value input + scenario planning
- [ ] Transparent math shown more clearly in results
- [ ] FAQ / expandable help section
- [ ] Soft post-audit email option (partially done)
- [ ] Referral system (semi-manual is fine for now)

---

### Human / Process side

- [ ] You click through everything at localhost:5176
- [ ] One real paid purchase to validate the reclaim flow
- [ ] Decide if hero / microcopy needs another pass
- [ ] Run first 5–8 real user tests once the above is green

---

**Current status:**  
Core bounce-killing work is largely done.  
Remaining risk is mainly the untested paid reclaim path + mobile polish.

Once P0 is fully green and you have completed at least 5–8 real user tests with no major new friction, we are clear to put traffic back on it.
