import { useApp } from '../context.ts';
import { call, explainError } from '../engine.ts';
import { Disclosure, download, Page } from '../ui.tsx';

export function Connect() {
  const { notify } = useApp();

  const backup = async () => {
    try {
      download('audit-backup.json', await call('backup'), 'application/json');
      notify('Backup downloaded');
    } catch (error) {
      notify(explainError(error).join('. '));
    }
  };

  return (
    <Page title="Connect an AI agent" lead="An agent can read your audit and test promotions. It can’t change anything.">
      <ol className="rows">
        <li className="card">
          <h2>1. Download this audit</h2>
          <p>The agent reads a copy, so download again after big changes.</p>
          <div className="actions"><button className="btn primary" onClick={backup}>Download audit</button></div>
        </li>
        <li className="card">
          <h2>2. Turn it into a local store</h2>
          <p>Run this in the project folder.</p>
          <pre>npm run store:import -- audit-backup.json data/store</pre>
        </li>
        <li className="card">
          <h2>3. Add it to Claude Code</h2>
          <p>Run this in the same folder, then ask “What sells below cost, and how do I fix it?”</p>
          <pre>claude mcp add discount-audit -- node --experimental-strip-types apps/mcp/server.ts data/store</pre>
        </li>
      </ol>
      <Disclosure summary="What can the agent do?">
        <ul className="facts">
          <li>List the products that sell below cost.</li>
          <li>Explain a leak and suggest fixes.</li>
          <li>Preview a fix.</li>
          <li>Check a promotion before you create it.</li>
        </ul>
      </Disclosure>
    </Page>
  );
}
