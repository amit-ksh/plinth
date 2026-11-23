// Watches the linked Shopify store for changes made outside Plinth (from the Worker's webhook log),
// and offers to re-read the store and say whether anything new now sells below cost.
import { useEffect, useState } from 'react';
import { call } from './engine.ts';
import { useApp } from './context.ts';
import { isOwnWrite, pullShopify, SHOPIFY_CONNECT, shopifyChanges, type ChangeEvent } from './shopify.ts';
import { plural } from './ui.tsx';

const POLL_MS = 60_000;

function readSeen(key: string): number {
  try {
    const value = Number(localStorage.getItem(key));
    if (value) return value;
    // First visit for this store: only changes from now on are news.
    localStorage.setItem(key, String(Date.now()));
  } catch {
    // Private windows can refuse storage; then every visit starts from now.
  }
  return Date.now();
}

function writeSeen(key: string, at: number): void {
  try {
    localStorage.setItem(key, String(at));
  } catch {
    // See readSeen.
  }
}

export function ChangesBanner() {
  const { data, change } = useApp();
  const shop = SHOPIFY_CONNECT ? data.app.shopify?.shop ?? null : null;
  const [events, setEvents] = useState<ChangeEvent[]>([]);
  const key = `plinth-seen:${shop}`;

  useEffect(() => {
    if (!shop) return;
    let stopped = false;
    const poll = async () => {
      if (document.hidden) return;
      const list = await shopifyChanges(readSeen(key));
      if (!stopped && list) setEvents(list.filter((e) => !isOwnWrite(e)));
    };
    void poll();
    const timer = setInterval(poll, POLL_MS);
    const onShow = () => !document.hidden && void poll();
    document.addEventListener('visibilitychange', onShow);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [shop, key]);

  if (!shop || !events.length) return null;
  const latest = Math.max(...events.map((e) => e.at));
  const labels = [...new Set(events.map((e) => e.label))];

  const recheck = () => {
    const before = new Set(data.audit.variants.filter((v) => v.state === 'leak').map((v) => v.id));
    let fresh: string[] = [];
    return change(
      async () => {
        const pulled = await pullShopify();
        const snap = await call('refreshFromShopify', pulled.store, pulled.link);
        fresh = snap.audit.variants.filter((v) => v.state === 'leak' && !before.has(v.id)).map((v) => v.title);
        writeSeen(key, latest);
        setEvents([]);
        return snap;
      },
      () => (fresh.length ? `New leak: ${fresh.slice(0, 3).join(', ')}${fresh.length > 3 ? ` and ${fresh.length - 3} more` : ''}` : 'Re-checked. No new leak found'),
    );
  };

  return (
    <div className="banner changes" role="status">
      <p>
        <strong>{plural(events.length, { one: '{n} change in Shopify', other: '{n} changes in Shopify' })}</strong>{' '}
        <span className="muted">
          since you last checked: {labels.slice(0, 2).join('; ')}
          {labels.length > 2 ? `; and ${labels.length - 2} more` : ''}.
        </span>
      </p>
      <span className="buttons">
        <button className="btn primary" onClick={recheck}>Re-check now</button>
        <button
          className="btn"
          onClick={() => {
            writeSeen(key, latest);
            setEvents([]);
          }}
        >
          Dismiss
        </button>
      </span>
    </div>
  );
}
