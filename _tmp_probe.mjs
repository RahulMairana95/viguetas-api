import 'dotenv/config';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { prepare: false, connect_timeout: 20 });
const [u] = await sql`select id, email, role from users order by created_at limit 1`;
const t = jwt.sign({ userId: u.id, email: u.email, role: u.role }, process.env.JWT_SECRET, { expiresIn: '1h' });

for (const p of ['/transfers', '/sales', '/stock?page=1&limit=10&search=', '/products?page=1&limit=10&search=']) {
  const r = await fetch('http://localhost:4000/api' + p, { headers: { Authorization: 'Bearer ' + t } });
  const b = await r.json();
  console.log(p, '=>', JSON.stringify(b).slice(0, 900));
  console.log();
}
await sql.end();
