#!/usr/bin/env node
/**
 * Unspun.report daily health check.
 *
 * Zero dependencies — Node 18+ (uses global fetch). Run:
 *   node scripts/health-check.mjs
 *   node scripts/health-check.mjs --json      # machine-readable output
 *
 * Exit code 0 = all green, 1 = one or more checks failed. Designed to be run by
 * a daily scheduled routine (or CI) and to be readable when a human runs it by hand.
 *
 * It hits ONLY public, non-mutating surfaces — no auth, no Stripe charge, no DB write.
 * verify-payment / consume-credit are probed with an empty body, which must return a
 * clean 400 (the endpoint is deployed and validating input) and must NOT 5xx (a crash).
 */

const BASE = process.env.UNSPUN_BASE_URL || 'https://unspun.report';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://alxqtmqsjckragnsbwqw.supabase.co';
// Public anon key (safe to embed — it's already shipped in the client source). Only used
// to satisfy the apikey requirement on the health probe; grants no privileged access.
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFseHF0bXFzamNrcmFnbnNid3F3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxMDU3MDMsImV4cCI6MjA5MTY4MTcwM30._SklOQMaFThiIWlhfhFa9MmDqqrxDSiEohJtEjFsR_w';
const TIMEOUT_MS = 15000;
const JSON_OUT = process.argv.includes('--json');

// Content pages that must serve 200. Keep in sync with the repo's *.html landing pages.
const PAGES = [
  '/',
  '/blog.html',
  '/facebook-ads-roi-for-chiropractic-clinics.html',
  '/facebook-ads-roi-for-veterinary-clinics.html',
  '/google-ads-cost-per-lead-for-gyms-and-studios.html',
  '/google-ads-roi-for-electrical-contractors.html',
  '/is-google-ads-working-for-my-dental-practice.html',
  '/is-google-ads-working-for-my-hvac-company.html',
  '/is-google-ads-working-for-my-pt-practice.html',
  '/is-my-facebook-ads-spend-working.html',
  '/is-my-google-ads-spend-working.html',
  '/is-my-plumbing-companys-ad-spend-paying-off.html',
  '/is-your-med-spas-ad-spend-actually-converting.html',
  '/privacy.html',
];

const SAMPLES = [
  '/samples/unspun-sample-google-ads-report.csv',
  '/samples/unspun-sample-agency-invoice.pdf',
];

const results = [];
function record(name, ok, detail) { results.push({ name, ok, detail }); }

async function req(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    return { status: res.status, text };
  } catch (e) {
    return { status: 0, text: String(e && e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

async function checkPage(path, mustContain) {
  const { status, text } = await req(BASE + path);
  const ok = status === 200 && (!mustContain || text.includes(mustContain));
  record(`page ${path}`, ok, ok ? `200${mustContain ? ' + content' : ''}` : `status=${status}${mustContain && status === 200 ? ' (missing content)' : ''}`);
}

async function checkEndpointRejectsEmpty(path) {
  // Empty body must yield a clean 400 (deployed + validating), never a 5xx (crash).
  const { status, text } = await req(BASE + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  const ok = status === 400;
  record(`api ${path}`, ok, ok ? '400 (healthy, rejects empty)' : `status=${status} ${text.slice(0, 80)}`);
}

async function checkSample(path) {
  const { status } = await req(BASE + path);
  record(`sample ${path}`, status === 200, `status=${status}`);
}

async function checkSupabase() {
  const { status, text } = await req(`${SUPABASE_URL}/auth/v1/health`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  const ok = status === 200;
  record('supabase auth/health', ok, ok ? '200' : `status=${status} ${text.slice(0, 60)}`);
}

async function main() {
  await checkPage('/', 'Run my free audit');
  for (const p of PAGES.slice(1)) await checkPage(p);
  await checkEndpointRejectsEmpty('/api/verify-payment');
  await checkEndpointRejectsEmpty('/api/consume-credit');
  for (const s of SAMPLES) await checkSample(s);
  await checkSupabase();

  const failed = results.filter(r => !r.ok);
  const summary = {
    site: BASE,
    checkedAt: new Date().toISOString(),
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    status: failed.length === 0 ? 'PASS' : 'FAIL',
  };

  if (JSON_OUT) {
    console.log(JSON.stringify({ summary, results }, null, 2));
  } else {
    console.log(`\nUnspun health check — ${summary.status}  (${summary.passed}/${summary.total})  ${summary.checkedAt}`);
    for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name} — ${r.detail}`);
    if (failed.length) {
      console.log(`\n${failed.length} FAILED:`);
      for (const r of failed) console.log(`  - ${r.name}: ${r.detail}`);
    }
    console.log('');
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
