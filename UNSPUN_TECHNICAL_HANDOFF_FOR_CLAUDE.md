# Unspun.report — Technical Handoff for Claude
**Date:** 2026-07-26  
**Context:** Post-Product Hunt bounce rate spike (84%). Critical path (signup → demo/audit) had a glitch that was fixed, but residual friction remains. This is a full second-look before any further promotion.

Goal of these changes: Make the first-time user path as close to bulletproof as possible. Every remaining friction point that causes bounce must be eliminated or dramatically reduced.

---

## 1. Critical Path & Auth / Magic Link Residual Issues

**Current state notes:**
- Free audit claims "No sign-in required" and "files never leave your browser".
- There are still references to "Send Magic Link" and "See a sample audit — no sign-in needed" in the UI.
- Paid packs are Stripe one-time links. How those packs are redeemed / associated with a user is unclear from the outside.

**Required changes:**
- Make the free audit path 100% zero-auth. No magic link prompt should appear during or immediately after a free audit unless the user explicitly chooses to save/share.
- If magic link is used for paid audit redemption or saving results, it must be:
  - Extremely clear why it is needed
  - Fast (email delivery < 30s)
  - Have excellent error states (wrong email, expired link, already used, etc.)
  - Allow the user to continue without it if they just want to see the result once
- After a successful free audit, do **not** force account creation. Offer "Save this audit" or "Email me a PDF" as optional secondary actions.
- Audit the full flow from Stripe success → redeeming the pack → running the next audit. Document every step and remove any dead ends.

**Acceptance criteria:**
- A completely new user can complete a free audit with zero authentication friction.
- Paid pack redemption is reliable and does not recreate the previous bounce spike.

---

## 2. File Upload & Parsing Experience

**Problems:**
- Users often do not have the exact files ready.
- No strong guidance on what a valid "agency invoice" or "Google/Meta monthly report" looks like.
- Parser error states are invisible or weak from the outside.
- No downloadable sample pair that users can use to test the tool safely.

**Required changes:**
- Add a clear, always-visible "What files do I need?" section or expandable panel near the drop zone.
- Provide **downloadable sample files** (anonymized or fictional but realistic agency invoice + Google Ads / Meta Ads report) so users can test the full flow without their own data.
- Improve parser feedback dramatically:
  - Show exactly what was found (or not found) in real time.
  - Specific, human-readable error messages (e.g. "Could not find total spend on this Google Ads report. Make sure you exported the Campaign report for the full month.")
  - Suggest the most common export settings for Google Ads and Meta Ads.
- Support both PDF and CSV cleanly. Prefer CSV when possible for reliability.
- Handle multi-page PDFs and common agency invoice formats better.
- Add a "Try with sample data" button that pre-loads the sample files into the tool.

**Technical notes for implementation:**
- Keep the "files never leave the browser" promise sacred. All parsing stays client-side.
- Consider adding a small "parser confidence" indicator so the user knows how clean the extraction was.

---

## 3. Customer Value Input (Critical for Verdict Quality)

The entire power of the product sits in the final verdict: True cost per customer vs. what that customer is worth.

**Required changes:**
- Make the "What is a new customer worth to you?" input extremely clear and low-friction.
- Provide guidance: "This is usually your average revenue per new customer (or first 90-day value). If you're not sure, use a conservative estimate."
- Allow easy editing of this number after the audit so the user can scenario-plan ("What if a patient is actually worth $180?").
- Show the math transparently: Agency fee + Ad spend = Total → ÷ Conversions = True cost → vs. Customer value = Profit/Loss per acquisition.

---

## 4. Post-Audit Experience (Currently Too Thin)

After the free audit finishes, many users currently have nowhere clear to go. This is a major bounce driver.

**Required changes:**
- Strong primary CTA after results: **Download PDF report** (clean, shareable, agency-ready).
- Secondary actions:
  - Email me this report
  - Save for comparison next month (this may require light magic link / account)
  - "Share redacted version" (optional)
  - "Talk to us about interpreting this" (leads into Hapawire service)
- The PDF must look professional and include:
  - The full breakdown
  - The plain-English verdict
  - A short glossary of terms used
  - Space for the user to write notes or questions for their agency
- After free audit, gently surface the pack pricing without being aggressive.

---

## 5. Glossary & Plain-English Layer

The product's biggest differentiator is translating agency-speak into owner-speak.

**Required changes:**
- Make the glossary visible and useful inside the audit results (not buried).
- Key terms that must be explained in plain language: CPC, CTR, Conversion, Cost per Conversion, Agency Management Fee, True Cost per Customer, ROAS implications, etc.
- Consider tooltips or an expandable "What does this mean?" on every key number.

---

## 6. Mobile Experience

Many business owners will hit this on their phone.

**Required changes:**
- Drag-and-drop zone must work well on mobile (or fall back cleanly to file picker).
- Tables must be readable (consider stacked cards on small screens).
- The full audit results must be usable without horizontal scrolling.

---

## 7. Tracking & Observability (for us)

Add (or improve) events so we can diagnose future bounce issues quickly:
- Free audit started
- Files dropped / chosen
- Parsing succeeded / failed (with reason codes)
- Customer value entered
- Audit completed
- PDF downloaded
- Pricing CTA clicked
- Magic link requested / redeemed
- Pack purchased

We need to see exactly where people drop in the funnel.

---

## Priority Order for Claude

1. Zero-auth free audit path + residual magic link cleanup
2. Sample files + better "what files do I need" guidance + parser error states
3. Post-audit PDF download + clear next actions
4. Customer value input clarity + scenario editing
5. Mobile polish + glossary visibility
6. Tracking events

---

**Notes for Claude:**
- Preserve the "files never leave your browser" guarantee at all costs. This is a core trust feature.
- The MindBody Med example is high-value social proof — do not break it.
- Keep the overall visual design language consistent. We are refining, not redesigning.
- When in doubt, bias toward reducing steps and clarifying language.

End of technical handoff.
