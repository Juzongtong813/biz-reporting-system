const BASE = 'http://localhost:3000';
const creds = [
  { u: 'demo_contract', p: 'Test@2026biz', label: 'contract_manager' },
  { u: 'manual_super', p: 'Test@2026biz', label: 'super_admin' },
];
for (const c of creds) {
  try {
    const login = await fetch(BASE + '/api/biz/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: c.u, password: c.p }),
    });
    const ld = await login.json().catch(() => ({}));
    const token = ld && ld.accessToken;
    console.log('\n[biz-login ' + c.u + ' (' + c.label + ')] status=' + login.status + ' hasToken=' + !!token);
    if (!token) { console.log('  body=' + JSON.stringify(ld)); continue; }
    const me = await fetch(BASE + '/api/biz/auth/me', { headers: { Authorization: 'Bearer ' + token } });
    console.log('  GET /api/biz/auth/me -> ' + me.status + ' ' + (await me.text()).slice(0, 260));
    for (const path of ['/api/biz/fee-rates/maintenance', '/api/biz/fee-rates/import/00000000-0000-4000-8000-000000000000/errors']) {
      const r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + token } });
      const body = await r.text().catch(() => '');
      console.log('  GET ' + path + ' -> ' + r.status + '  body=' + body.slice(0, 240));
    }
  } catch (e) {
    console.log('[' + c.u + '] ERROR ' + e.message);
  }
}
