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
let holdReferences = true;
let includeTimestamps = true;
const chatRequests = [];
let releaseChat;
const transcriptSegments = [
 { id: 's1', segment_index: 0, text: 'Privacy discussion', created_at: '2026-09-14T09:00:10.000Z' },
 { id: 's2', segment_index: 1, text: 'Budget discussion', created_at: '2026-09-14T09:00:20.000Z' }
];
const server = createServer(async (req, res) => {
 try {
  const url = new URL(req.url, 'http://localhost');
  const json = (data) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
  if (url.pathname === '/api/meetings') return json([meeting]);
  if (url.pathname === '/api/chat') {
   let text = ''; for await (const chunk of req) text += chunk;
   chatRequests.push(JSON.parse(text));
   await new Promise(resolve => { releaseChat = resolve; });
   return json({ content: '# Meeting summary\n\n**Approved** the budget.\n\n- Assign an owner\n- Follow up\n\n```js\nconst budget = 100;\n```\n\n| Topic | Owner |\n| --- | --- |\n| Budget | Alex |\n\n[Policy](https://example.org)\n\n<script>window.markdownInjected = true</script>\n\n[unsafe](javascript:alert%281%29)' });
  }
  if (url.pathname.endsWith('/references')) {
   if (req.method === 'POST') {
    submissions++;
    let text = ''; for await (const chunk of req) text += chunk;
    const body = JSON.parse(text); const references = [];
    assert.equal(body.retry, false, 'Document failures must not trigger UI retries');
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
    if (!holdReferences && job.status === 'queued') Object.assign(job, job.topic === 'privacy' && job.generation === 0 ? { status: 'error', error: 'Test upstream HTTP 500' } : job.topic === 'general' ? { status: 'empty', documents: [] } : { status: 'ready', documents: docs });
    job.updated_at = new Date().toISOString(); return job;
   });
   return json({ references });
  }
  if (url.pathname.startsWith('/api/meetings/')) return json({ meeting, transcript: 'Imported notes\nPrivacy discussion\nBudget discussion', baseTranscript: 'Imported notes', segments: includeTimestamps ? transcriptSegments : [], chunks: [] });
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
 assert.equal(await evaluate(`Array.from(document.querySelectorAll('span')).find(s => s.classList.contains('rounded-full') && s.textContent.includes('completed'))?.textContent.trim()`), 'completed', 'Status badge has no stray brace');
 await waitFor(`document.querySelectorAll('[aria-label="Timestamped transcript"] time').length === 2`);
 assert.equal(await evaluate(`document.querySelector('[aria-label="Timestamped transcript"] time').getAttribute('datetime')`), transcriptSegments[0].created_at);
 assert.equal(await evaluate(`document.body.innerText.includes('Imported notes · no segment timestamp')`), true);
 await click('Plain text');
 assert.equal(await evaluate(`document.querySelector('[aria-label="Timestamped transcript"]')`), null);
 assert.equal(await evaluate(`document.body.innerText.includes('Imported notes\\nPrivacy discussion\\nBudget discussion')`), true);
 await click('Timestamps');
 await waitFor(`document.querySelectorAll('[aria-label="Timestamped transcript"] time').length === 2`);
 await click('Chat');
 await waitFor(`document.querySelector('textarea[placeholder="Ask something..."]')`);
 assert.equal(await evaluate(`!!document.querySelector('input[placeholder="Policy document query (optional)"]')`), false);
 await evaluate(`(() => { const model = document.querySelector('#chat-ai-model'); model.value = 'workers-glm-5-3-flash'; model.dispatchEvent(new Event('change', { bubbles: true })); })()`);
 assert.equal(await evaluate(`!!document.querySelector('#chat-ai-model-description')`), false, 'Removed model note leaves no empty paragraph');
 const inputSelector = `document.querySelector('textarea[placeholder="Ask something..."]')`;
 const setInput = text => evaluate(`(() => { const input = ${inputSelector}; input.value = ${JSON.stringify(text)}; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); })()`);
 await setInput('Summarize the meeting');
 await evaluate(`${inputSelector}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })); ${inputSelector}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true }));`);
 assert.equal(chatRequests.length, 0, 'Composition and held Enter do not submit');
 await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 8, text: '\r' });
 await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 8 });
 assert.equal(await evaluate(`${inputSelector}.value.includes('\\n')`), true, 'Shift+Enter inserts a newline');
 assert.equal(chatRequests.length, 0);
 await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
 await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
 await waitFor(`document.querySelector('[data-message-role="user"]')`);
 for (let i = 0; i < 100 && !releaseChat; i++) await new Promise(r => setTimeout(r, 20));
 assert.equal(chatRequests.length, 1, 'Enter sends one message');
 assert.equal(chatRequests[0].doc_query, 'Summarize the meeting', 'Automatic document lookup still uses the question');
 await setInput('Draft while waiting');
 await evaluate(`${inputSelector}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); ${inputSelector}.closest('form').requestSubmit();`);
 assert.equal(await evaluate(`${inputSelector}.value`), 'Draft while waiting', 'Sending is guarded while a response is pending');
 assert.equal(chatRequests.length, 1);
 releaseChat();
 await waitFor(`document.querySelector('.markdown h1')?.textContent === 'Meeting summary'`);
 assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-message-role="user"]')).textAlign`), 'left');
 assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-message-role="user"]')).marginLeft`), '0px');
 await setInput('   ');
 await evaluate(`${inputSelector}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
 assert.equal(chatRequests.length, 1, 'Whitespace-only messages are not sent');
 assert.equal(await evaluate(`document.querySelector('.markdown strong')?.textContent`), 'Approved');
 assert.equal(await evaluate(`document.querySelectorAll('.markdown ul li').length`), 2);
 assert.equal(await evaluate(`!!document.querySelector('.markdown pre code') && !!document.querySelector('.markdown table')`), true);
 assert.equal(await evaluate(`document.querySelector('.markdown a')?.getAttribute('href')`), 'https://example.org');
 assert.equal(await evaluate(`!!window.markdownInjected || !!document.querySelector('.markdown script, .markdown a[href^="javascript:"]')`), false);
 assert.equal(await evaluate(`getComputedStyle(document.querySelector('.markdown ul')).listStyleType`), 'disc');
 await click('Hide chat');
 const assertQuiet = async () => assert.equal(await evaluate(`/Document search|No matching documents|Waiting to queue|Searching Policy Observatory|Document service unavailable|Retry document search|HTTP 500/.test(document.body.innerText)`), false);
 await assertQuiet();
 assert.equal(await evaluate(`document.querySelectorAll('[aria-label="Related policy documents"], [data-document-links]').length`), 0, 'Pending searches have no document heading or container');
 const emptyHeights = await evaluate(`Object.fromEntries(Array.from(document.querySelectorAll('[data-topic-card]')).map(c => [c.dataset.topicCard, parseFloat(c.style.height)]))`);
 assert.ok(Object.values(emptyHeights).every(h => h <= 110), 'Short cards fit their content instead of reserving whitespace');
 assert.equal(await evaluate(`Array.from(document.querySelectorAll('[data-topic-card]')).every(c => Math.abs(parseFloat(c.style.height) - c.querySelector('button').offsetHeight - 2) < 1)`), true, 'Measured card height matches topic content plus border');
 holdReferences = false;
 await waitFor(`document.querySelector('[data-topic-card="budget"] a')`);
 const fetchedHeights = await evaluate(`Object.fromEntries(Array.from(document.querySelectorAll('[data-topic-card]')).map(c => [c.dataset.topicCard, parseFloat(c.style.height)]))`);
 assert.equal(fetchedHeights.privacy, emptyHeights.privacy);
 assert.equal(fetchedHeights.general, emptyHeights.general);
 assert.ok(fetchedHeights.budget > emptyHeights.budget && fetchedHeights.budget - emptyHeights.budget < 132, 'Only the matched card grows to fit its document list');
 assert.equal(await evaluate(`document.querySelector('[data-topic-card="budget"] a').textContent`), docs[0].title, 'Documents are listed directly on topic cards');
 assert.equal(await evaluate(`document.querySelector('[data-topic-card="budget"] a').getAttribute('href')`), docs[0].source_url);
 await assertQuiet();
 for (const id of ['privacy', 'general']) {
  assert.equal(await evaluate(`document.querySelectorAll('[data-topic-card="${id}"] [data-document-links]').length`), 0, 'Failed and empty cards have no document section or divider');
  await evaluate(`document.querySelector('[data-topic-card="${id}"] button').click()`);
  await waitFor(`document.querySelector('button[title="Close topic details"]')`);
  assert.equal(await evaluate(`document.querySelectorAll('aside [aria-label="Related policy documents"]').length`), 0, 'Details hide documents when none were fetched');
  await assertQuiet();
 }
 await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.querySelector('h3')?.textContent === 'Budget').click()`);
 await waitFor(`document.body.innerText.includes('Original document')`);
 assert.equal(await evaluate(`Array.from(document.querySelectorAll('a')).find(a => a.textContent.includes('Original document')).getAttribute('rel')`), 'noopener noreferrer');
 const beforeToggle = submissions;
 await click('Live graph'); await new Promise((r) => setTimeout(r, 2500));
 assert.equal(submissions, beforeToggle, 'Switching views must not requeue empty or completed results');
 assert.equal(await evaluate(`document.querySelectorAll('[data-topic-card="budget"] a').length`), 1, 'Document list survives layout changes');
 const tops = await evaluate(`Array.from(document.querySelectorAll('[data-topic-card]')).map(b => parseFloat(b.style.top))`);
 assert.ok(tops[1] > tops[0]);
 await evaluate(`document.querySelector('button[title="Close topic details"]')?.click()`);
 const canvas = `document.querySelector('[role="application"]')`;
 const follow = `Array.from(document.querySelectorAll('label')).find(l => l.textContent.includes('Follow latest topic')).querySelector('input')`;
 const transform = () => evaluate(`${canvas}.querySelector('div[style*="transform"]').style.transform`);
 const assertCentered = async () => {
  const distance = await evaluate(`(() => { const v = ${canvas}.getBoundingClientRect(); const n = Array.from(${canvas}.querySelectorAll('[data-topic-card]')).at(-1).getBoundingClientRect(); return Math.hypot(n.x + n.width / 2 - v.x - v.width / 2, n.y + n.height / 2 - v.y - v.height / 2); })()`);
  assert.ok(distance < 2, 'Latest topic is centered');
 };
 const refollow = async () => {
  assert.equal(await evaluate(`${follow}.checked`), false, 'Manual navigation pauses follow');
  await evaluate(`${follow}.click()`);
  await new Promise(r => setTimeout(r, 50));
  await assertCentered();
 };
 await evaluate(`if (!${follow}.checked) ${follow}.click()`);
 await new Promise(r => setTimeout(r, 50));
 await assertCentered();
 await evaluate(`${follow}.click()`); // off then on without a new topic or any movement
 await refollow();
 const drag = async (onCard) => {
  const point = await evaluate(`(() => { const r = ${onCard ? `Array.from(${canvas}.querySelectorAll('button')).at(-1)` : canvas}.getBoundingClientRect(); return { x: r.x + ${onCard ? 'r.width / 2' : '25'}, y: r.y + ${onCard ? 'r.height / 2' : '25'} }; })()`);
  const before = await transform();
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + 100, y: point.y + 70, button: 'left', buttons: 1 });
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + 100, y: point.y + 70, button: 'left', clickCount: 1 });
  assert.notEqual(await transform(), before, 'Dragging pans the canvas');
  assert.equal(await evaluate(`!!document.querySelector('button[title="Close topic details"]')`), false, 'Dragging does not select a card');
  await refollow();
 };
 await drag(false);
 await drag(true);
 const beforeWheel = await transform();
 const point = await evaluate(`(() => { const r = ${canvas}.getBoundingClientRect(); return { x: r.x + 30, y: r.y + 30 }; })()`);
 await command('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 60, deltaY: 120 });
 await waitFor(`${follow}.checked === false`);
 assert.notEqual(await transform(), beforeWheel, 'Trackpad/wheel pans the canvas');
 await refollow();
 await evaluate(`${canvas}.focus(); ${canvas}.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));`);
 await refollow();
 await evaluate(`Array.from(${canvas}.querySelectorAll('button')).at(-1).click()`);
 await waitFor(`document.querySelector('button[title="Close topic details"]')`);
 await refollow();
 assert.equal(await evaluate(`!!document.querySelector('button[title="Close topic details"]')`), false, 'Following closes details so they cannot obscure the centered topic');
 const screenshot = await command('Page.captureScreenshot', { format: 'png' });
 await writeFile(join(tmpdir(), 'roundtable-documents-ui.png'), Buffer.from(screenshot.data, 'base64'));
 await click('New transcript');
 includeTimestamps = false;
 await waitFor(`document.body.innerText.includes('Browser reference test')`);
 await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Browser reference test')).click()`);
 await waitFor(`document.body.innerText.includes('No segment timestamps were saved')`);
 assert.equal(await evaluate(`document.querySelectorAll('[aria-label="Timestamped transcript"] time').length`), 0, 'No invented timestamps for older or uploaded transcripts');
 await click('New transcript');
 await waitFor(`document.body.innerText.includes('Share browser tab audio')`);
 await click('Share browser tab audio');
 await waitFor(`document.querySelector('#live-audio-source')?.value === 'tab'`);
 assert.equal(await evaluate(`document.querySelector('#live-speech-language').value`), 'fil-en');
 assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
 console.log(JSON.stringify({ passed: true, checks: ['organized default', 'clean status badge', 'safe styled chat Markdown', 'left-aligned user chat', 'Enter sends and Shift+Enter inserts newline', 'no duplicate or IME sends', 'removed note and query box', 'compact cards without document whitespace', 'background and card drag panning', 'wheel and keyboard panning', 'follow toggle recenters existing latest topic', 'topic clicks preserved', 'hidden pending/failed/empty document sections', 'document lists on cards', 'timestamp/plain-text transcript toggle', 'legacy transcript fallback', 'only matched documents linked', 'layout toggle without resubmission', 'downward live layout', 'tab audio selection preserved', 'Taglish preset preserved', 'no browser runtime exceptions'], screenshot: join(tmpdir(), 'roundtable-documents-ui.png') }, null, 2));
} finally {
 if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id: 999999, method: 'Browser.close' }));
 await new Promise((r) => setTimeout(r, 500));
 ws?.close(); browser.kill(); server.closeAllConnections(); server.close();
 await rm(profile, { recursive: true, force: true }).catch(() => {});
}
