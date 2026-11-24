import Download01Icon from '@hugeicons/core-free-icons/Download01Icon';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DISCOUNTS_TEMPLATE, PRODUCTS_TEMPLATE } from '../../../../packages/core/src/csv.ts';
import type { ShopifyLink } from '../../../../packages/core/src/app-state.ts';
import type { Currency } from '../../../../packages/core/src/format.ts';
import type { StoreInput } from '../../../../packages/core/src/types.ts';
import { useApp } from '../context.ts';
import { IS_DESKTOP } from '../desktop.ts';
import { connectShopify, SHOPIFY_CONNECT } from '../shopify.ts';
import { call, explainError } from '../engine.ts';
import { Disclosure, download, Icon, Issues, Page, plural } from '../ui.tsx';

interface Preview {
  store: StoreInput;
  missingCost: number;
  /** Set when the store came from Shopify. */
  shop?: string;
  currency?: Currency | null;
  notes?: string[];
  link?: ShopifyLink | null;
}

const HANDOFF = 'plinth-shopify';

/** Reads, once, what the Worker's callback page left for this tab. */
function takeHandoff(): { error?: string; preview?: Preview; storeName?: string } | null {
  try {
    const text = sessionStorage.getItem(HANDOFF);
    if (!text) return null;
    sessionStorage.removeItem(HANDOFF);
    const data = JSON.parse(text);
    if (typeof data?.error === 'string') return { error: data.error };
    if (!data?.store) return { error: 'Plinth couldn’t read what Shopify sent. Connect again.' };
    return {
      storeName: data.storeName,
      preview: { store: data.store, missingCost: data.missingCost ?? 0, shop: data.shop, currency: data.currency, notes: Array.isArray(data.notes) ? data.notes : [], link: data.link ?? null },
    };
  } catch {
    return null;
  }
}

function ConnectShopify() {
  const [shop, setShop] = useState('');
  const [error, setError] = useState('');
  return (
    <form
      className="card form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const name = shop.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.myshopify\.com$/, '');
        if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(name)) {
          setError('Enter your store’s address, like my-shop or my-shop.myshopify.com');
          document.getElementById('shopify-shop')?.focus();
          return;
        }
        connectShopify(name);
      }}
    >
      <h2>Connect Shopify</h2>
      <p className="muted">Plinth reads your products, costs and discounts, and audits them in this browser. Discount changes you make here are checked for leaks, then saved to Shopify. Nothing is kept on a server.</p>
      <div className="field">
        <label htmlFor="shopify-shop">Store address</label>
        <input
          id="shopify-shop"
          name="shop"
          autoComplete="off"
          spellCheck={false}
          placeholder="my-shop.myshopify.com"
          value={shop}
          onChange={(e) => setShop(e.target.value)}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? 'shopify-shop-error' : undefined}
        />
        {error && <p className="error" id="shopify-shop-error">{error}</p>}
      </div>
      <div className="actions">
        <button className="btn primary" type="submit">Connect Shopify</button>
      </div>
    </form>
  );
}

export function Import() {
  const { data, change } = useApp();
  const [name, setName] = useState(data.app.sample ? 'My store' : data.app.settings.storeName);
  const [plus, setPlus] = useState(data.store.plus);
  const [files, setFiles] = useState<{ products?: File; discounts?: File }>({});
  const [errors, setErrors] = useState<{ name?: string; products?: string; discounts?: string }>({});
  const [issues, setIssues] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const previewTitle = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const handoff = takeHandoff();
    if (handoff?.error) setIssues([handoff.error]);
    if (handoff?.preview) {
      if (handoff.storeName) setName(handoff.storeName);
      setPreview(handoff.preview);
    }
  }, []);

  useEffect(() => {
    if (preview) previewTitle.current?.focus();
  }, [preview]);

  const review = async (event: FormEvent) => {
    event.preventDefault();
    const found: typeof errors = {};
    if (!name.trim() || name.trim().length > 80) found.name = 'Enter a store name of up to 80 characters';
    if (!files.products) found.products = 'Choose your products file';
    if (!files.discounts) found.discounts = 'Choose your discounts file';
    setErrors(found);
    setIssues([]);
    const first = Object.keys(found)[0];
    if (first) {
      document.getElementById(`import-${first}`)?.focus();
      return;
    }
    try {
      const [products, discounts] = await Promise.all([files.products!.text(), files.discounts!.text()]);
      setPreview(await call('readCsv', { products, discounts }, plus));
    } catch (error) {
      setIssues(explainError(error));
    }
  };

  const restore = async (file?: File) => {
    if (!file) return;
    setIssues([]);
    const text = await file.text();
    if (await change(() => call('restore', text), 'Backup restored')) location.hash = 'audit';
  };

  if (preview) {
    const { store, missingCost, shop, notes = [], currency, link } = preview;
    const sameStore = SHOPIFY_CONNECT && !!link && data.app.shopify?.shop === link.shop;
    const counts = [
      plural(store.variants.length, { one: '{n} product', other: '{n} products' }),
      plural(store.discounts.length, { one: '{n} discount', other: '{n} discounts' }),
    ];
    return (
      <Page title="Import your store">
        <div className="card">
          <h2 tabIndex={-1} ref={previewTitle}>Ready to import {counts.join(' and ')}</h2>
          {shop && <p>Read from <span className="code">{shop}</span> just now.</p>}
          {missingCost > 0 && (
            <p>
              {plural(missingCost, {
                one: '{n} product has no cost, so it will show as “Can’t be sure”.',
                other: '{n} products have no cost, so they will show as “Can’t be sure”.',
              })}
            </p>
          )}
          {notes.length > 0 && (
            <ul className="notes">
              {notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          )}
          {sameStore ? (
            <p className="muted">This updates {data.app.settings.storeName} with what’s in Shopify now. Your settings, checklist and history stay.</p>
          ) : (
            <p className="muted">This replaces {data.app.settings.storeName} in this browser. You can undo it.</p>
          )}
          <div className="actions">
            <button
              className="btn primary"
              onClick={async () => {
                const work = sameStore ? () => call('refreshFromShopify', store, link!) : () => call('useImport', store, name, currency ?? null, SHOPIFY_CONNECT ? link ?? null : null);
                if (await change(work, sameStore ? 'Updated from Shopify and audited' : 'Store imported and audited')) location.hash = 'audit';
              }}
            >
              {sameStore ? 'Update and audit' : 'Replace and audit'}
            </button>
            <button className="btn" onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </div>
      </Page>
    );
  }

  return (
    <Page title="Import your store" lead={SHOPIFY_CONNECT ? 'Connect Shopify, or use two spreadsheet files.' : 'Two spreadsheet files. Nothing is uploaded.'}>
      <Issues issues={issues} />
      {SHOPIFY_CONNECT && <ConnectShopify />}
      {IS_DESKTOP && (
        <p className="caption muted">
          To connect a Shopify store, use Plinth on the web, then download a backup and restore it here.
        </p>
      )}
      <form className="card form" onSubmit={review} noValidate>
        {SHOPIFY_CONNECT && <h2>Use spreadsheets</h2>}
        <div className="field">
          <label htmlFor="import-name">Store name</label>
          <input id="import-name" name="storeName" autoComplete="organization" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name || undefined} aria-describedby={errors.name ? 'import-name-error' : undefined} />
          {errors.name && <p className="error" id="import-name-error">{errors.name}</p>}
        </div>
        {(['products', 'discounts'] as const).map((key) => (
          <div className="field" key={key}>
            <label htmlFor={`import-${key}`}>{key === 'products' ? 'Products and costs (CSV)' : 'Discounts (CSV)'}</label>
            <input
              id={`import-${key}`}
              name={key}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setFiles({ ...files, [key]: e.target.files?.[0] })}
              aria-invalid={!!errors[key] || undefined}
              aria-describedby={errors[key] ? `import-${key}-error` : undefined}
            />
            {errors[key] && <p className="error" id={`import-${key}-error`}>{errors[key]}</p>}
          </div>
        ))}
        <label className="check">
          <input type="checkbox" name="plus" checked={plus} onChange={(e) => setPlus(e.target.checked)} />
          This store is on Shopify Plus
        </label>
        <div className="actions">
          <button className="btn primary" type="submit">Review import</button>
        </div>
      </form>

      <div className="section">
        <Disclosure summary="Get the spreadsheet templates">
          <p>Fill these in and keep the column names. Separate several values in one cell with semicolons. To show product photos, add an <span className="code">image</span> column with https links.</p>
          <div className="actions">
            <button className="btn with-icon" onClick={() => download('products.csv', PRODUCTS_TEMPLATE, 'text/csv')}>
              <Icon icon={Download01Icon} />
              Download products template
            </button>
            <button className="btn with-icon" onClick={() => download('discounts.csv', DISCOUNTS_TEMPLATE, 'text/csv')}>
              <Icon icon={Download01Icon} />
              Download discounts template
            </button>
          </div>
        </Disclosure>
        <Disclosure summary="Restore a backup">
          <div className="field">
            <label htmlFor="restore">Backup file (JSON)</label>
            <input
              id="restore"
              name="backup"
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                void restore(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        </Disclosure>
      </div>
    </Page>
  );
}
