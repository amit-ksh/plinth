import { useEffect, useState } from 'react';
import { productHref, useApp } from '../context.ts';
import { Page, plural, StateBadge } from '../ui.tsx';

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

  return (
    <Page title="Products" lead="Every product, with the ones that need you first.">
      <div className="section">
        <p className="caption muted" role="status">
          {needle
            ? plural(found.length, { one: `{n} result for “${query.trim()}”`, other: `{n} results for “${query.trim()}”` })
            : plural(found.length, { one: '{n} product', other: '{n} products' })}
        </p>
        {found.length ? (
          <ul className="rows">
            {found.slice(0, limit).map((v) => (
              <li key={v.id}>
                <a className="row" href={productHref(v.id)}>
                  <span className="body">
                    <strong>{v.title}</strong>
                    <span className="caption muted num">
                      {money(v.price)} price · {v.cost === null ? 'no cost' : `${money(v.cost)} cost`}
                    </span>
                  </span>
                  <span className="end"><StateBadge state={v.state} /></span>
                </a>
              </li>
            ))}
          </ul>
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
