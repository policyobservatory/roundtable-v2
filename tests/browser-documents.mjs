import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
// Optional real-browser smoke test against built assets and a local mocked API.
// No production requests, browser permissions, or audio inference are exercised.
// Set BROWSER_PATH to a Chromium/Chrome/Edge executable outside the default Windows setup.
const root = process.cwd();
const { referenceFingerprint, referenceRevision } = await import(pathToFileURL(join(root, 'shared/document-references.ts')));
const nodes = [{ id: 'privacy', title: 'Data privacy', summary: 'Discuss retention obligations.', decisions: ['Review the policy'], actions: [], concerns: [] }, { id: 'budget', title: 'Budget', summary: 'Fund implementation.', decisions: [], actions: ['Estimate costs'], concerns: [] }, { id: 'general', title: 'General discussion', summary: 'No related bill.', decisions: [], actions: [], concerns: [] }];
const meeting = { id: '00000000-0000-4000-8000-000000000001', title: 'Browser reference test', status: 'completed', provider: 'openrouter', model: 'openai/gpt-4o-mini', metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), map: { nodes, edges: [{ source: 'privacy', target: 'budget', label: 'Needs funding' }] } };
const docs = [{ id: 'HB-1_s1', title: 'HB-1 · Retention', content: 'Keep records only as necessary.', url: 'https://example.org/provision', source_url: 'https://example.org/original.pdf', bill_status: 'Pending' }];
const jobs = new Map();
let submissions = 0;
const server = createServer(async (req, res) => {
 try {
  const url = new URL(req.url, 'http://localhost');
  const json = (data) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
  if (url.pathname === '/api/meetings') return json([meeting]);
  if (url.pathname.endsWith('/references')) {
   if (req.method === 'POST') {
    submissions++;
    let text = ''; for await (const chunk of req) text += chunk;
    const body = JSON.parse(text); const references = [];
    assert.equal(body.retry, false, 'The UI must not request document retries');
    for (const node of body.nodes) {
     const fp = await referenceFingerprint(node);
     if (!jobs.has(fp)) jobs.set(fp, { id: fp, fingerprint: fp, generation: 0, status: 'queued', documents: [], updated_at: new Date().toISOString(), topic: node.id });
     const job = jobs.get(fp);
     if (body.retry && job.status === 'error') Object.assign(job, { generation: job.generation + 1, status: 'queued', error: undefined, updated_at: new Date().toISOString() });
     references.push({ revision: referenceRevision(node), reference: job });
    }
    return json({ references });
   }
   const references = url.searchParams.get('fingerprints').split(',').map((fp) => {
    const job = jobs.get(fp);
    if (job.status === 'queued') Object.assign(job, job.topic === 'privacy' ? { status: 'error', error: 'Test upstream HTTP 500' } : job.topic === 'general' ? { status: 'empty', documents: [] } : { status: 'ready', documents: docs });
    job.updated_at = new Date().toISOString(); return job;
   });
   return json({ references });
  }
  if (url.pathname.startsWith('/api/meetings/')) return json({ meeting, transcript: 'Privacy and budget discussion', chunks: [] });
  const path = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\//, '');
  if (path.includes('..')) { res.statusCode = 400; return res.end(); }
  const data = await readFile(join(root, 'dist', path));
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' })[extname(path)] ?? 'application/octet-stream'); res.end(data);
 } catch (error) { res.statusCode = 404; res.end('Not found'); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(join(tmpdir(), 'roundtable-docs-browser-'));
const browser = spawn(process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let ws;
let spawnError;
browser.on('error', (error) => { spawnError = error; });
try {
 let port;
 for (let i = 0; i < 100 && !port; i++) { try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { await new Promise((r) => setTimeout(r, 100)); } }
 assert.ok(port, spawnError ? `Set BROWSER_PATH to an installed Chromium browser: ${spawnError.message}` : 'Browser debugging port');
 const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
 ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
 await new Promise((r) => ws.addEventListener('open', r, { once: true }));
 let sequence = 0; const pending = new Map(); const exceptions = [];
 ws.addEventListener('message', (event) => { const message = JSON.parse(event.data); if (message.id) { const callback = pending.get(message.id); pending.delete(message.id); callback?.(message); } else if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params); });
 const command = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, (message) => message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)); ws.send(JSON.stringify({ id, method, params })); });
 const evaluate = async (expression) => { const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
 const waitFor = async (expression) => { for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; await new Promise((r) => setTimeout(r, 100)); } console.log('DEBUG', await evaluate('document.body.innerText'), JSON.stringify(exceptions)); throw new Error('Browser wait timed out: ' + expression); };
 const click = (text) => evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(text)})?.click()`);
 await command('Runtime.enable'); await command('Page.enable');
 await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
 await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
 await waitFor(`document.body.innerText.includes('Browser reference test')`);
 await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Browser reference test')).click()`);
 await waitFor(`document.querySelector('[aria-label="Canvas view"]')`);
 assert.equal(await evaluate(`document.querySelector('[aria-label="Canvas view"] [aria-pressed="true"]').textContent`), 'Organized canvas');
 const assertQuiet = async () => assert.equal(await evaluate(`/No matching documents|0 documents|Document search|Retry document|Finding related|Document lookup/.test(document.body.innerText)`), false);
 await assertQuiet();
 await waitFor(`document.body.innerText.includes('1 related provision')`);
 for (const title of ['Data privacy', 'General discussion']) {
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.querySelector('h3')?.textContent === ${JSON.stringify(title)}).click()`);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="Related policy documents"]')`), false, 'No reference section for errors/empty results');
  await assertQuiet();
 }
 await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.querySelector('h3')?.textContent === 'Budget').click()`);
 await waitFor(`document.body.innerText.includes('Original document')`);
 assert.equal(await evaluate(`Array.from(document.querySelectorAll('a')).find(a => a.textContent.includes('Original document')).getAttribute('rel')`), 'noopener noreferrer');
 const beforeToggle = submissions;
 await click('Live graph'); await new Promise((r) => setTimeout(r, 2500));
 assert.equal(submissions, beforeToggle, 'Switching views must not requeue empty or completed results');
 await assertQuiet();
 const tops = await evaluate(`Array.from(document.querySelectorAll('button')).filter(b => b.querySelector('h3')).map(b => parseFloat(b.style.top))`);
 assert.ok(tops[1] > tops[0]);
 const screenshot = await command('Page.captureScreenshot', { format: 'png' });
 await writeFile(join(tmpdir(), 'roundtable-documents-ui.png'), Buffer.from(screenshot.data, 'base64'));
 await click('New transcript');
 await waitFor(`document.body.innerText.includes('Share browser tab audio')`);
 await click('Share browser tab audio');
 await waitFor(`document.querySelector('#live-audio-source')?.value === 'tab'`);
 assert.equal(await evaluate(`document.querySelector('#live-speech-language').value`), 'fil-en');
 assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
 console.log(JSON.stringify({ passed: true, checks: ['organized default', 'quiet pending/error/empty states', 'only matched documents linked', 'layout toggle without resubmission', 'downward live layout', 'tab audio selection preserved', 'Taglish preset preserved', 'no browser runtime exceptions'], screenshot: join(tmpdir(), 'roundtable-documents-ui.png') }, null, 2));
} finally {
 if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id: 999999, method: 'Browser.close' }));
 await new Promise((r) => setTimeout(r, 500));
 ws?.close(); browser.kill(); server.closeAllConnections(); server.close();
 await rm(profile, { recursive: true, force: true }).catch(() => {});
}
