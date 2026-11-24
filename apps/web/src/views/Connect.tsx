import { useApp } from '../context.ts';
import { call, explainError } from '../engine.ts';
import { agentFolder, IS_DESKTOP, useAgentStatus } from '../desktop.ts';
import { Disclosure, download, Page } from '../ui.tsx';

/** On the desktop app: one folder the agent reads, kept up to date after every change. */
function DesktopAgent() {
  const { notify } = useApp();
  const agent = useAgentStatus();
  const quoted = agent.file ? `"${agent.file}"` : '<agent file>';
  return (
    <Page title="Connect an AI agent" lead="Your agent reads the audit from a folder on this computer. Plinth updates it after every change. The agent can’t change anything.">
      <ol className="rows">
        <li className="card">
          <h2>1. Choose a folder for your agent</h2>
          {agent.file ? (
            <>
              <p>Plinth keeps <span className="code">{agent.file}</span> up to date.</p>
              <p className="caption muted">
                {agent.error ? agent.error : agent.writtenAt ? `Last updated at ${new Date(agent.writtenAt).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })}.` : 'Writing it now…'}
              </p>
            </>
          ) : (
            <p>Pick any folder, such as Documents. Plinth writes one file there, plinth-audit.json, and nothing else.</p>
          )}
          <div className="actions">
            <button
              className={agent.file ? 'btn' : 'btn primary'}
              onClick={async () => {
                await agentFolder.choose();
                notify('Agent folder saved. Plinth will keep it up to date');
              }}
            >
              {agent.file ? 'Choose another folder' : 'Choose a folder'}
            </button>
            {agent.file && (
              <button
                className="btn"
                onClick={async () => {
                  await agentFolder.stop();
                  notify('Plinth stopped updating the agent folder. The file is left as it was');
                }}
              >
                Stop updating
              </button>
            )}
          </div>
        </li>
        <li className="card">
          <h2>2. Add Plinth to your agent</h2>
          <p>
            In a copy of the <a href="https://github.com/amit-ksh/plinth">Plinth source</a>, run this, then ask “What sells below cost, and how do I fix it?”
          </p>
          <pre>claude mcp add plinth -- node --experimental-strip-types apps/mcp/server.ts {quoted}</pre>
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

export function Connect() {
  if (IS_DESKTOP) return <DesktopAgent />;
  return <BrowserAgent />;
}

function BrowserAgent() {
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
