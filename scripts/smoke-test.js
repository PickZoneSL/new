require('dotenv').config();
const { Client } = require('pg');

const BASE = process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 3000);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@pickzonesl';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'lock@pickzonesl';

let adminCookie = '';
let customerCookie = '';
function cookieFrom(response, current) {
  const values = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  if (!values.length) {
    const one = response.headers.get('set-cookie');
    if (one) values.push(one);
  }
  let next = current;
  for (const value of values) {
    const pair = value.split(';', 1)[0];
    const name = pair.split('=', 1)[0];
    next = next.split(';').filter(x => x && x.trim().split('=')[0] !== name).concat(pair).join(';');
  }
  return next;
}
async function call(path, options = {}, cookie = '') {
  const headers = {'Content-Type':'application/json', ...(options.headers || {})};
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(BASE + path, {...options, headers});
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {raw:text}; }
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} -> ${response.status}: ${data.message || text}`);
  return {data, cookie: cookieFrom(response, cookie)};
}
function assert(condition, message) { if (!condition) throw new Error(message); }

(async () => {
  const tag = Date.now().toString(36);
  const code = `PZSMOKE-${tag}`;
  const email = `pickzonesl.smoke.${tag}@gmail.com`;
  const pg = process.env.DATABASE_URL ? new Client({connectionString:process.env.DATABASE_URL, ssl:process.env.PGSSL==='disable'?false:{rejectUnauthorized:false}}) : null;
  let productId = null, customerId = null, orderId = null;
  try {
    if (!pg) throw new Error('DATABASE_URL is required for the smoke test');
    await pg.connect();
    const h = await call('/api/health'); assert(h.data.ok === true, 'Database health check failed');

    let r = await call('/api/auth/admin/login', {method:'POST', body:JSON.stringify({email:ADMIN_EMAIL,password:ADMIN_PASSWORD})});
    adminCookie = r.cookie; assert(r.data.authenticated, 'Admin login failed');

    r = await call('/api/admin/products', {method:'POST', body:JSON.stringify({code,title:'PickZoneSL Smoke Test Product',price:123.45,stock:5,description:'Temporary smoke test product',categories:['General & Utility'],images:[]})}, adminCookie);
    adminCookie = r.cookie; productId = r.data.product.id; assert(productId, 'Product creation failed');

    r = await call('/api/auth/register', {method:'POST', body:JSON.stringify({email,whatsapp:'777777777',password:'2468'})});
    assert(r.data.customer?.email === email, 'Customer registration failed');
    r = await call('/api/auth/login', {method:'POST', body:JSON.stringify({email,password:'2468'})});
    customerCookie = r.cookie; customerId = r.data.customer.id; assert(customerId, 'Customer login failed');

    r = await call('/api/cart/items', {method:'POST', body:JSON.stringify({productId,quantity:1})}, customerCookie);
    customerCookie = r.cookie; assert(r.data.items?.[0]?.quantity === 1, 'Cart add failed');
    r = await call('/api/cart/items/' + productId, {method:'PATCH', body:JSON.stringify({quantity:2})}, customerCookie);
    customerCookie = r.cookie; assert(r.data.items?.[0]?.quantity === 2, 'Cart quantity change failed');

    r = await call('/api/orders', {method:'POST', body:JSON.stringify({items:[{productId,quantity:2}],customer:{name:'Smoke Customer',phone1:'711111111',phone2:'722222222',city:'Kurunegala',province:'North Western',district:'Kurunegala',address:'Smoke Test Address'}})}, customerCookie);
    orderId = r.data.order.id; assert(r.data.order.status === 'pending', 'Order was not created as Pending');
    assert(Number(r.data.order.items?.[0]?.unitPrice) === 123.45, 'Order did not use DB price');

    const stock = await pg.query('SELECT stock FROM products WHERE id=$1',[productId]);
    assert(Number(stock.rows[0]?.stock) === 3, 'Stock did not decrease transactionally');

    r = await call('/api/admin/orders/' + orderId + '/status', {method:'PATCH', body:JSON.stringify({status:'confirmed',message:'Smoke test'})}, adminCookie);
    assert(r.data.order.status === 'confirmed', 'Admin status update failed');

    r = await call('/api/orders/my', {}, customerCookie);
    const mine = r.data.orders.find(o => String(o.id) === String(orderId));
    assert(mine?.status === 'confirmed', 'Customer did not see updated order status');

    console.log('PASS: admin login -> product save -> customer cart -> quantity change -> order -> stock decrease -> admin status -> customer status');
  } finally {
    if (pg) {
      try {
        if (orderId) await pg.query('DELETE FROM orders WHERE id=$1',[orderId]);
        if (productId) await pg.query('DELETE FROM products WHERE id=$1',[productId]);
        if (customerId) await pg.query('DELETE FROM customers WHERE id=$1',[customerId]);
      } catch (cleanupError) { console.error('Cleanup warning:', cleanupError.message); }
      await pg.end().catch(()=>{});
    }
  }
})().catch(error => { console.error('FAIL:', error.message); process.exitCode = 1; });
