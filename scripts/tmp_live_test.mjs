const BASE = 'http://localhost:3000';
const creds = [
  { u: 'demo_contract', p: 'Test@2026biz' },
  { u: 'manual_super', p: 'Test@2026biz' },
];
for (const c of creds) {
  try {
    const login = await fetch(BASE + '/api/auth/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: c.u, password: c.p }),
    });
    const ld = await login.json().catch(() => ({}));
    const token = ld && ld.token;
    console.log('\n[login ' + c.u + '] status=' + login.status + ' hasToken=' + !!token);
    if (!token) { console.log('  body=' + JSON.stringify(ld)); continue; }
    for (const path of ['/api/biz/fee-rates/maintenance', '/api/biz/contracts']) {
      const r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + token } });
      const body = await r.text().catch(() => '');
      console.log('  GET ' + path + ' -> ' + r.status + '  body=' + body.slice(0, 240));
    }
  } catch (e) {
    console.log('[' + c.u + '] ERROR ' + e.message);
  }
}
