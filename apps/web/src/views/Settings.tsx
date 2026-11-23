import { useEffect, useState, type FormEvent } from 'react';
import { CURRENCIES, parseMoney, parsePercent, type Currency } from '../../../../packages/core/src/format.ts';
import { editable, useApp } from '../context.ts';
import { call } from '../engine.ts';
import { connectShopify, disconnectShopify, pullShopify, SHOPIFY_CONNECT, shopifySession } from '../shopify.ts';
import { Page } from '../ui.tsx';

function SettingsForm() {
  const { data, change } = useApp();
  const saved = data.app.settings;
  const [name, setName] = useState(saved.storeName);
  const [currency, setCurrency] = useState<Currency>(saved.currency);
  const [shipping, setShipping] = useState(editable(saved.shippingCost));
  const [quantity, setQuantity] = useState(String(saved.maxQty));
  const [margin, setMargin] = useState(saved.floorBps ? String(saved.floorBps / 100) : '');
  const [plus, setPlus] = useState(data.store.plus);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const shippingCost = parseMoney(shipping);
    const maxQty = /^\d+$/.test(quantity.trim()) ? Number(quantity) : 0;
    const floorBps = margin.trim() ? parsePercent(margin) : 0;
    const found: Record<string, string> = {};
    if (!name.trim() || name.trim().length > 80) found.name = 'Enter a store name of up to 80 characters';
    if (shippingCost === null) found.shipping = 'Enter an amount like 8.00';
    if (maxQty < 1 || maxQty > 20) found.quantity = 'Enter a number from 1 to 20';
    if (floorBps === null || floorBps >= 10000) found.margin = 'Enter a percentage below 100, or leave it empty';
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) {
      document.getElementById(`setting-${first}`)?.focus();
      return;
    }
    const settings = { storeName: name, currency, shippingCost: shippingCost!, maxQty, floorBps: floorBps! };
    void change(() => call('saveSettings', settings, plus), 'Settings saved and audit updated');
  };

  const fields = [
    { key: 'shipping', label: 'What free shipping costs you', hint: 'Your average cost per order', value: shipping, set: setShipping, placeholder: '8.00' },
    { key: 'quantity', label: 'Check quantities up to', hint: 'Items of one product in a cart', value: quantity, set: setQuantity, placeholder: '3' },
    { key: 'margin', label: 'Warn below this margin (optional)', hint: 'Shows as Thin margin', value: margin, set: setMargin, placeholder: '15%' },
  ];

  return (
    <form className="card form" onSubmit={submit} noValidate>
      <div className="fields">
        <div className="field">
          <label htmlFor="setting-name">Store name</label>
          <input id="setting-name" name="storeName" autoComplete="organization" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name || undefined} aria-describedby={errors.name ? 'setting-name-error' : undefined} />
          {errors.name && <p className="error" id="setting-name-error">{errors.name}</p>}
        </div>
        <div className="field">
          <label htmlFor="setting-currency">Currency</label>
          <select id="setting-currency" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
            {CURRENCIES.map((code) => <option key={code}>{code}</option>)}
          </select>
        </div>
        {fields.map((f) => (
          <div className="field" key={f.key}>
            <label htmlFor={`setting-${f.key}`}>{f.label}</label>
            <input id={`setting-${f.key}`} name={f.key} inputMode="decimal" autoComplete="off" placeholder={f.placeholder} value={f.value} onChange={(e) => f.set(e.target.value)} aria-invalid={!!errors[f.key] || undefined} aria-describedby={`setting-${f.key}-${errors[f.key] ? 'error' : 'hint'}`} />
            {errors[f.key] ? (
              <p className="error" id={`setting-${f.key}-error`}>{errors[f.key]}</p>
            ) : (
              <p className="hint" id={`setting-${f.key}-hint`}>{f.hint}</p>
            )}
          </div>
        ))}
      </div>
      <label className="check">
        <input type="checkbox" name="plus" checked={plus} onChange={(e) => setPlus(e.target.checked)} />
        Allow product discounts to stack on one item (Shopify Plus)
      </label>
      <div className="actions">
        <button className="btn primary" type="submit">Save settings</button>
      </div>
    </form>
  );
}

function ShopifyLinkSection() {
  const { data, change, notify } = useApp();
  const link = data.app.shopify;
  const [session, setSession] = useState<{ connected: boolean; shop?: string } | null>(null);
  useEffect(() => {
    shopifySession().then(setSession);
  }, []);
  if (!SHOPIFY_CONNECT || !link) return null;
  const live = session?.connected && session.shop === link.shop;

  return (
    <section className="section" aria-labelledby="shopify">
      <h2 id="shopify">Shopify</h2>
      <p className="muted">
        This audit is linked to <span className="code">{link.shop}</span>.{' '}
        {session === null ? '' : live ? 'Discount changes are saved there.' : 'The sign-in has ended, so connect again before saving changes.'}
      </p>
      <div className="actions">
        {live ? (
          <>
            <button
              className="btn"
              onClick={() =>
                change(async () => {
                  const fresh = await pullShopify();
                  return call('refreshFromShopify', fresh.store, fresh.link);
                }, 'Refreshed from Shopify and audited')
              }
            >
              Refresh from Shopify
            </button>
            <button
              className="btn"
              onClick={async () => {
                await disconnectShopify().catch(() => null);
                setSession({ connected: false });
                notify('Signed out of Shopify. The audit stays here');
              }}
            >
              Sign out of Shopify
            </button>
          </>
        ) : (
          <button className="btn" onClick={() => connectShopify(link.shop.replace(/\.myshopify\.com$/, ''))}>Connect again</button>
        )}
      </div>
    </section>
  );
}

export function Settings() {
  const { data, change } = useApp();
  return (
    <Page title="Settings" lead="These change how the audit does its math.">
      {/* Undo, import and reset change the saved values, so the form restarts from them. */}
      <SettingsForm key={JSON.stringify([data.app.settings, data.store.plus])} />
      <ShopifyLinkSection />
      <section className="section" aria-labelledby="sample">
        <h2 id="sample">Sample data</h2>
        <p className="muted">Replace what’s here with the sample store. You can undo it.</p>
        <div className="actions">
          <button className="btn" onClick={() => change(() => call('resetSample'), 'Sample store loaded')}>Load sample store</button>
        </div>
      </section>
    </Page>
  );
}
