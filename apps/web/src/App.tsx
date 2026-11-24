import { useCallback, useEffect, useRef, useState } from 'react';
import { PRODUCT_NAME } from '../../../packages/core/src/product.ts';
import type { Snapshot } from '../../../packages/core/src/workspace.ts';
import { Context, readRoute, type Route } from './context.ts';
import { call, explainError } from './engine.ts';
import { useAgentSync } from './desktop.ts';
import { Shell } from './Shell.tsx';
import { Audit } from './views/Audit.tsx';
import { Calendar } from './views/Calendar.tsx';
import { Checklist } from './views/Checklist.tsx';
import { Connect } from './views/Connect.tsx';
import { Discounts } from './views/Discounts.tsx';
import { History } from './views/History.tsx';
import { Home } from './views/Home.tsx';
import { Import } from './views/Import.tsx';
import { Product } from './views/Product.tsx';
import { Products } from './views/Products.tsx';
import { Settings } from './views/Settings.tsx';

function View({ route }: { route: Route }) {
  switch (route.view) {
    case 'audit': return <Audit />;
    case 'product': return <Product id={route.id ?? ''} key={route.id} />;
    case 'products': return <Products />;
    case 'discounts': return <Discounts id={route.id} />;
    case 'calendar': return <Calendar />;
    case 'history': return <History />;
    case 'checklist': return <Checklist />;
    case 'import': return <Import />;
    case 'settings': return <Settings />;
    case 'agent': return <Connect />;
    default: return <Home />;
  }
}

export function App() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [route, setRoute] = useState(() => readRoute(location.hash));
  const [query, setQueryState] = useState('');
  const [toast, setToast] = useState<{ message: string; undo: boolean } | null>(null);
  const skipFocus = useRef(true); // no focus jump on first load

  useEffect(() => {
    call('snapshot').then(setData, () => setFailed(true));
  }, []);

  useEffect(() => {
    const onHash = () => {
      // The skip link's target is not a screen.
      if (location.hash === '#main') return;
      setRoute(readRoute(location.hash));
    };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  useAgentSync(data);

  const ready = data !== null;
  useEffect(() => {
    if (!ready) return;
    const heading = document.querySelector<HTMLElement>('main h1');
    document.title = heading ? `${heading.textContent} · ${PRODUCT_NAME}` : PRODUCT_NAME;
    if (skipFocus.current) {
      skipFocus.current = false;
      return;
    }
    document.querySelector('.main-panel')?.scrollTo(0, 0);
    scrollTo(0, 0);
    (heading ?? document.getElementById('main'))?.focus({ preventScroll: true });
  }, [route, ready]);

  const notify = useCallback((message: string) => setToast({ message, undo: false }), []);

  const change = useCallback(async (work: () => Promise<Snapshot>, done: string | (() => string)) => {
    try {
      const next = await work();
      setData(next);
      setToast({ message: typeof done === 'function' ? done() : done, undo: next.canUndo });
      return true;
    } catch (error) {
      setToast({ message: explainError(error).join('. '), undo: false });
      return false;
    }
  }, []);

  const setQuery = useCallback((value: string) => {
    setQueryState(value);
    if (value && readRoute(location.hash).view !== 'products') {
      // Typing in search shows results without pulling focus out of the search box.
      skipFocus.current = true;
      history.pushState(null, '', '#products');
      setRoute({ view: 'products' });
    }
  }, []);

  if (failed) {
    return (
      <main className="startup">
        <div className="card" role="alert">
          <h1>Unable to start the audit</h1>
          <p>This browser couldn’t load the local graph engine. Update your browser, then reload.</p>
          <button className="btn primary" onClick={() => location.reload()}>Reload page</button>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="startup">
        <div className="card" role="status">
          <p>Opening your audit…</p>
        </div>
      </main>
    );
  }

  return (
    <Context.Provider value={{ data, change, notify, query, setQuery }}>
      <Shell route={route} toast={toast} dismissToast={() => setToast(null)}>
        <View route={route} />
      </Shell>
    </Context.Provider>
  );
}
