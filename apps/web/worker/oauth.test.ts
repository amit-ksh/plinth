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
