import { useEffect, useState } from 'react';
import { productHref, useApp } from '../context.ts';
import { Page, plural, StateBadge, Thumb } from '../ui.tsx';

const STEP = 25;

export function Products() {
  const { data, query, setQuery, money } = useApp();
  const [limit, setLimit] = useState(STEP);
  useEffect(() => setLimit(STEP), [query]);

  const needle = query.trim().toLowerCase();
  const rank = { leak: 0, unknown: 1, thin: 2, clear_in_model: 3 };
  const found = data.audit.variants
    .filter((v) => v.title.toLowerCase().includes(needle) || v.id.toLowerCase().includes(needle))
    .sort((a, b) => rank[a.state] - rank[b.state] || a.title.localeCompare(b.title, 'en', { numeric: true }));
  const rest = Math.min(found.length - limit, STEP);
  const byId = new Map(data.store.variants.map((v) => [v.id, v]));
  const names = new Map(data.store.collections.map((c) => [c.id, c.title]));

  return (
    <Page title="Products" lead="Every product, with the ones that need you first." wide>
      <div className="section">
        <p className="caption muted" role="status">
          {needle
            ? plural(found.length, { one: `{n} result for “${query.trim()}”`, other: `{n} results for “${query.trim()}”` })
            : plural(found.length, { one: '{n} product', other: '{n} products' })}
        </p>
        {found.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col" className="hide-narrow">Collection</th>
                  <th scope="col" className="num hide-phone">Price</th>
                  <th scope="col" className="num hide-narrow">Cost</th>
                  <th scope="col" className="num hide-narrow">Worst case</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {found.slice(0, limit).map((v) => {
                  const source = byId.get(v.id);
                  const worst = v.worst ? v.worst.net - v.worst.cost : null;
                  return (
                    <tr key={v.id}>
                      <td>
                        <a className="cell-link" href={productHref(v.id)}>
                          <Thumb title={v.title} image={source?.image} />
                          <span className="cell-main">
                            <strong>{v.title}</strong>
                            <span className="caption muted code">{v.id}</span>
                          </span>
                        </a>
                      </td>
                      <td className="hide-narrow muted">{source?.collections.map((c) => names.get(c) ?? c).join(', ') || '—'}</td>
                      <td className="num hide-phone">{money(v.price)}</td>
                      <td className="num hide-narrow">{v.cost === null ? <span className="muted">No cost</span> : money(v.cost)}</td>
                      <td className={`num hide-narrow${worst !== null && worst < 0 ? ' danger-text' : ''}`}>
                        {worst === null ? <span className="muted">—</span> : `${worst < 0 ? 'Loses' : 'Earns'} ${money(Math.abs(worst))}`}
                      </td>
                      <td><StateBadge state={v.state} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card">
            <h2>No products match</h2>
            <p>Check the spelling, or search by product ID.</p>
            <div className="actions">
              <button className="btn" onClick={() => { setQuery(''); document.getElementById('main')?.focus(); }}>Clear search</button>
            </div>
          </div>
        )}
        {rest > 0 && (
          <div className="actions">
            <button className="btn" onClick={() => setLimit(limit + STEP)}>
              {plural(rest, { one: 'Show {n} more product', other: 'Show {n} more products' })}
            </button>
          </div>
        )}
      </div>
    </Page>
  );
}
