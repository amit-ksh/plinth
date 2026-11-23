import Download01Icon from '@hugeicons/core-free-icons/Download01Icon';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DISCOUNTS_TEMPLATE, PRODUCTS_TEMPLATE } from '../../../../packages/core/src/csv.ts';
import type { StoreInput } from '../../../../packages/core/src/types.ts';
import { useApp } from '../context.ts';
import { call, explainError } from '../engine.ts';
import { Disclosure, download, Icon, Issues, Page, plural } from '../ui.tsx';

interface Preview {
  store: StoreInput;
  missingCost: number;
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
    const { store, missingCost } = preview;
    const counts = [
      plural(store.variants.length, { one: '{n} product', other: '{n} products' }),
      plural(store.discounts.length, { one: '{n} discount', other: '{n} discounts' }),
    ];
    return (
      <Page title="Import your store">
        <div className="card">
          <h2 tabIndex={-1} ref={previewTitle}>Ready to import {counts.join(' and ')}</h2>
          {missingCost > 0 && (
            <p>
              {plural(missingCost, {
                one: '{n} product has no cost, so it will show as “Can’t be sure”.',
                other: '{n} products have no cost, so they will show as “Can’t be sure”.',
              })}
            </p>
          )}
          <p className="muted">This replaces {data.app.settings.storeName} in this browser. You can undo it.</p>
          <div className="actions">
            <button
              className="btn primary"
              onClick={async () => {
                if (await change(() => call('useImport', store, name), 'Store imported and audited')) location.hash = 'audit';
              }}
            >
              Replace and audit
            </button>
            <button className="btn" onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </div>
      </Page>
    );
  }

  return (
    <Page title="Import your store" lead="Two spreadsheet files. Nothing is uploaded.">
      <Issues issues={issues} />
      <form className="card form" onSubmit={review} noValidate>
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
