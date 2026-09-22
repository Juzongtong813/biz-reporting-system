const BASE = 'http://localhost:3000';
const badToken = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJoYWNrIiwiaWF0IjoxfQ.hacktoken';

// 1) wrong-token (old admin jwt) must be 401 on biz route
const wrong = await fetch(`${BASE}/api/biz/fee-rates/maintenance`, { headers: { Authorization: badToken } });
console.log('[wrong admin token] biz maintenance ->', wrong.status);

// 2) biz login -> maintenance (read) -> contracts list (read)
const login = await fetch(`${BASE}/api/biz/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'demo_contract', password: 'Test@2026biz' }),
});
console.log('[biz login demo_contract] ->', login.status);
const token = (await login.json()).token;
const h = { Authorization: `Bearer ${token}` };
const m = await fetch(`${BASE}/api/biz/fee-rates/maintenance`, { headers: h });
const mj = await m.json();
console.log('[biz maintenance read] ->', m.status, '(items:', mj.items?.length ?? '?', ')');
const c = await fetch(`${BASE}/api/biz/contracts?pageSize=2`, { headers: h });
const cj = await c.json().catch(() => ({}));
console.log('[biz contracts read] ->', c.status, '(keys:', Object.keys(cj).slice(0, 4).join(',') || '-', ')');
