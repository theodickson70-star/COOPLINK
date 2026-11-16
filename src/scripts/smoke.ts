// =====================================================================
//  SMOKE TEST KABLA YA DEPLOY (v2.4) — kurasa kuu na API kuu zinajibu?
//    npm run build && npm start            (au server iliyopo tayari)
//    SMOKE_URL=http://localhost:4000 npm run smoke
//
//  Inasoma TU (GET) — haibadilishi chochote, kwa hiyo ni salama hata dhidi ya production.
//  Mipangilio (env, si kwenye code):
//    SMOKE_URL        anwani ya server (lazima)
//    SMOKE_PHONE      namba ya mtumishi wa chama (Meneja au Mhasibu) — hiari
//    SMOKE_PASSWORD   nenosiri lake — hiari (haionyeshwi popote)
//    SMOKE_TOKEN      badala ya namba/nenosiri (mf. akaunti yenye OTP/2FA) — hiari
//  Bila akaunti: kurasa za umma na /health tu zinakaguliwa. Exit code 0 = sawa, 1 = kuna tatizo.
// =====================================================================
const BASE = (process.env.SMOKE_URL ?? '').replace(/\/+$/, '');
const TIMEOUT = Number(process.env.SMOKE_TIMEOUT_MS ?? 15000);
let problems = 0, passed = 0, skipped = 0;
const ok = (m: string, ms: number) => { passed++; console.log(`  ✅ ${m} (${ms}ms)`); };
const bad = (m: string) => { problems++; console.log(`  ❌ ${m}`); };
const skip = (m: string) => { skipped++; console.log(`  ⏭️  ${m}`); };

async function get(path: string, token?: string) {
  const t0 = Date.now();
  const r = await fetch(BASE + path, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(TIMEOUT), redirect: 'manual' });
  const text = await r.text();
  return { status: r.status, text, ms: Date.now() - t0, type: r.headers.get('content-type') ?? '' };
}

/** Kurasa za React: zinarudisha index.html, na faili la JavaScript linalotajwa lipo. */
async function page(path: string, label: string) {
  try {
    const r = await get(path);
    if (r.status !== 200 || !r.type.includes('text/html') || !r.text.includes('id="root"')) return bad(`${label} ${path} -> ${r.status}`);
    const js = r.text.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
    if (js) {
      const a = await get(js.startsWith('/') ? js : `/${js}`);
      if (a.status !== 200) return bad(`${label}: faili la JS ${js} -> ${a.status}`);
    }
    ok(`${label} ${path}`, r.ms);
  } catch (e) { bad(`${label} ${path}: ${(e as Error).message}`); }
}

async function api(path: string, label: string, token: string, expect: (j: any) => boolean = () => true) {
  try {
    const r = await get(`/api/v1${path}`, token);
    if (r.status === 403) return skip(`${label}: akaunti hii haina ruhusa (${JSON.parse(r.text)?.error?.code ?? 403})`);
    if (r.status !== 200) return bad(`${label} ${path} -> ${r.status} ${r.text.slice(0, 160)}`);
    let j: unknown;
    try { j = JSON.parse(r.text); } catch { return bad(`${label}: jibu si JSON`); }
    if (!expect(j)) return bad(`${label}: muundo wa jibu si sahihi`);
    if (r.ms > 5000) console.log(`  ⚠️  ${label} imechukua ${r.ms}ms`);
    ok(label, r.ms);
  } catch (e) { bad(`${label} ${path}: ${(e as Error).message}`); }
}

async function login(): Promise<string | null> {
  if (process.env.SMOKE_TOKEN) return process.env.SMOKE_TOKEN;
  const phone = process.env.SMOKE_PHONE?.trim(), password = process.env.SMOKE_PASSWORD;
  if (!phone || !password) { skip('Hakuna SMOKE_PHONE/SMOKE_PASSWORD — API za ndani hazikaguliwi'); return null; }
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone, password }), signal: AbortSignal.timeout(TIMEOUT) });
  const j = await r.json().catch(() => ({})) as { token?: string; otpRequired?: boolean; twoFactorRequired?: boolean; error?: { code?: string } };
  if (j.token) { ok('Kuingia (login)', 0); return j.token; }
  if (j.otpRequired || j.twoFactorRequired) { skip('Akaunti inahitaji OTP/2FA — weka SMOKE_TOKEN kukagua API za ndani'); return null; }
  bad(`Kuingia kumeshindwa: ${r.status} ${j.error?.code ?? ''}`);
  return null;
}

async function main() {
  if (!BASE) { console.error('Weka SMOKE_URL, mf. SMOKE_URL=http://localhost:4000 npm run smoke'); process.exit(1); }
  console.log(`\n=== CoopLink smoke test: ${BASE} ===`);

  console.log('\n— Server na database');
  try {
    const h = await get('/health');
    const j = JSON.parse(h.text);
    if (h.status === 200 && j.status === 'ok' && j.db === 'ok') ok(`/health — toleo ${j.version}${j.migrations ? `, migrations ${j.migrations.total}` : ''}${j.schema ? `, schema ${j.schema}` : ''}`, h.ms);
    else bad(`/health -> ${h.status} ${h.text.slice(0, 120)}`);
    if (j.schema === 'mismatch') bad('Schema ya database hailingani na code');
  } catch (e) { bad(`/health: ${(e as Error).message}`); }

  console.log('\n— Kurasa (React)');
  for (const [p, l] of [['/login', 'Kuingia'], ['/', 'Dashibodi'], ['/members', 'Wakulima'], ['/input-issues', 'Ugawaji wa pembejeo'], ['/sales', 'Mauzo'],
    ['/finance', 'Fedha'], ['/accounting/reports', 'Ripoti za fedha'], ['/accounting/reports/agm', 'Ripoti ya Mkutano Mkuu'], ['/mkulima', 'Portal ya mkulima']] as const) await page(p, l);

  console.log('\n— API za ndani (kusoma tu)');
  const token = await login();
  if (token) {
    const y = new Date().getFullYear();
    await api('/auth/me', 'Akaunti yangu', token, (j) => !!(j.user ?? j).role);
    await api('/notifications', 'Arifa', token, (j) => Array.isArray(j.items));
    await api('/members?pageSize=1', 'Orodha ya wakulima', token, (j) => Array.isArray(j.data));
    await api('/input-issues?pageSize=1', 'Ugawaji wa pembejeo', token, (j) => Array.isArray(j.data));
    await api('/inputs/items', 'Bidhaa za stoo', token, (j) => Array.isArray(j.data));
    await api('/sales/summary', 'Muhtasari wa mauzo', token);
    await api('/sales/markets', 'Masoko', token, (j) => Array.isArray(j.data));
    await api('/finance/accounts', 'Akaunti za fedha', token, (j) => Array.isArray(j.data));
    await api('/finance/farmers?pageSize=1', 'Madeni ya wakulima', token, (j) => Array.isArray(j.data));
    await api('/approvals', 'Idhini', token);
    await api('/accounting/dashboard', 'Dashibodi ya uhasibu', token);
    await api(`/accounting/reports/annual?from=${y}-01-01&to=${y}-12-31`, 'Ripoti ya Mkutano Mkuu', token, (j) => !!j.members && !!j.sales);
  }

  console.log(`\nMatokeo: ${passed} sawa, ${problems} matatizo, ${skipped} yamerukwa`);
  if (problems) { console.log('❌ USI-DEPLOY mpaka matatizo yarekebishwe.\n'); process.exit(1); }
  console.log('✅ Tayari kwa deploy.\n');
}

main().catch((e) => { console.error('Smoke test imeshindwa:', (e as Error).message); process.exit(1); });
