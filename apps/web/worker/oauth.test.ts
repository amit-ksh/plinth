import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { normalizeShop, readCookie, scriptJson, validHmac } from './oauth.ts';

test('store addresses are normalized, and anything else is refused', () => {
  assert.equal(normalizeShop('My-Shop'), 'my-shop.myshopify.com');
  assert.equal(normalizeShop('https://my-shop.myshopify.com/admin'), 'my-shop.myshopify.com');
  for (const bad of ['', 'evil.com', 'my shop', 'a.b.myshopify.com', '-shop', 'x'.repeat(61), null]) assert.equal(normalizeShop(bad), null, String(bad));
});

test('the callback signature is checked the way Shopify signs it', async () => {
  const secret = 'test-secret';
  const params = new URLSearchParams({ code: 'abc', shop: 'my-shop.myshopify.com', state: 's1', timestamp: '1795400000', host: 'aG9zdA' });
  const message = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  params.set('hmac', createHmac('sha256', secret).update(message).digest('hex'));
  assert.equal(await validHmac(params, secret), true);
  assert.equal(await validHmac(params, 'other-secret'), false);
  const tampered = new URLSearchParams(params);
  tampered.set('shop', 'evil.myshopify.com');
  assert.equal(await validHmac(tampered, secret), false);
  const missing = new URLSearchParams(params);
  missing.delete('hmac');
  assert.equal(await validHmac(missing, secret), false);
});

test('cookies and embedded JSON are read and written safely', () => {
  assert.equal(readCookie('a=1; plinth_shopify_state=xyz; b=2', 'plinth_shopify_state'), 'xyz');
  assert.equal(readCookie(null, 'x'), null);
  const json = scriptJson({ title: '</script><script>alert(1)</script>' });
  assert.ok(!json.includes('</script>'));
  assert.deepEqual(JSON.parse(json), { title: '</script><script>alert(1)</script>' });
});

test('sessions are sealed, tamper-proof and expire', async () => {
  const { sealSession, openSession } = await import('./oauth.ts');
  const session = { shop: 'my-shop.myshopify.com', token: 'shpua_secret', expires: Date.now() + 60_000 };
  const sealed = await sealSession(session, 'k1');
  assert.ok(!sealed.includes('shpua_secret'));
  assert.deepEqual(await openSession(sealed, 'k1'), session);
  assert.equal(await openSession(sealed, 'k2'), null);
  assert.equal(await openSession(sealed.slice(0, -2) + 'AA', 'k1'), null);
  assert.equal(await openSession(sealed, 'k1', session.expires + 1), null);
  assert.equal(await openSession('garbage', 'k1'), null);
});

test('webhooks are verified, summarized without costs, and Slack URLs are restricted', async () => {
  const { validWebhook, describeWebhook, isSlackUrl } = await import('./oauth.ts');
  const body = new TextEncoder().encode('{"title":"BUNDLE20"}');
  const signature = createHmac('sha256', 's3').update(body).digest('base64');
  assert.equal(await validWebhook(body.buffer, signature, 's3'), true);
  assert.equal(await validWebhook(body.buffer, signature, 'other'), false);
  assert.equal(await validWebhook(body.buffer, null, 's3'), false);
  const e = describeWebhook('discounts/update', { title: 'BUNDLE20', admin_graphql_api_id: 'gid://shopify/DiscountCodeNode/1' }, 'w1', 5);
  assert.deepEqual(e, { id: 'w1', topic: 'discounts/update', at: 5, label: 'Discount changed: BUNDLE20', gid: 'gid://shopify/DiscountCodeNode/1' });
  const cost = describeWebhook('inventory_items/update', { sku: 'JKT-1', cost: '65.00' }, 'w2', 6)!;
  assert.ok(!cost.label.includes('65'), 'no cost in the log');
  assert.equal(describeWebhook('orders/create', {}, 'w3', 7), null);
  assert.equal(isSlackUrl('https://hooks.slack.com/services/T0/B0/xyz'), true);
  for (const bad of ['http://hooks.slack.com/services/x', 'https://evil.com/services/x', 'https://hooks.slack.com.evil.com/services/x', 42]) assert.equal(isSlackUrl(bad), false);
});
