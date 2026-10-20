import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import metrics from '../src/renderer/hud-metrics.js';

// The renderer files are plain scripts (window.HudDom, window.HudCard, ...), so the tests
// run them in a tiny DOM instead of pulling in a browser environment.
const source = name => readFileSync(new URL(`../src/renderer/${name}`, import.meta.url), 'utf8');
const camel = name => name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());

class FakeStyle {
  constructor() { this.values = {}; }
  setProperty(name, value) { this.values[name] = value; }
}

function makeClassList(node) {
  const read = () => (node.getAttribute('class') || '').split(/\s+/).filter(Boolean);
  return {
    add(...names) { node.setAttribute('class', [...new Set([...read(), ...names])].join(' ')); },
    remove(...names) { node.setAttribute('class', read().filter(name => !names.includes(name)).join(' ')); },
    contains(name) { return read().includes(name); },
    toggle(name, force) {
      const on = force === undefined ? !read().includes(name) : Boolean(force);
      if (on) this.add(name); else this.remove(name);
      return on;
    },
  };
}

function matchesSimple(node, selector) {
  const text = selector.trim();
  const tag = text.match(/^[a-z][\w:-]*/i);
  let rest = text;
  if (tag) {
    if (node.tag.toLowerCase() !== tag[0].toLowerCase()) return false;
    rest = rest.slice(tag[0].length);
  }
  const tokens = /([.#])([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g;
  let consumed = '';
  for (const match of rest.matchAll(tokens)) {
    consumed += match[0];
    if (match[1] === '.') {
      if (!node.classList.contains(match[2])) return false;
    } else if (match[1] === '#') {
      if (node.getAttribute('id') !== match[2]) return false;
    } else {
      const wanted = match[4];
      const actual = match[3].startsWith('data-') ? node.dataset[camel(match[3].slice(5))] : node.getAttribute(match[3]);
      if (wanted === undefined ? actual === undefined || actual === null : actual !== wanted) return false;
    }
  }
  return consumed === rest;
}

const descendantsOf = node => node.children.flatMap(child => [child, ...descendantsOf(child)]);
function queryAll(root, selector) {
  let current = [root];
  for (const part of selector.trim().split(/\s+/)) current = current.flatMap(descendantsOf).filter(node => matchesSimple(node, part));
  return current;
}

class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.parentNode = null;
    this.hidden = false;
    this.disabled = false;
    this._text = '';
    this.style = new FakeStyle();
    this.listeners = {};
    this.classList = makeClassList(this);
    if (tag === 'canvas') this.getContext = () => ({ font: '', measureText: value => ({ width: String(value).length * 7 }) });
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith('data-')) this.dataset[camel(name.slice(5))] = String(value);
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  append(...nodes) {
    for (const node of nodes.flat()) {
      if (!node) continue;
      if (typeof node === 'string') { this._text += node; continue; }
      node.parentNode = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this._text = '';
    this.append(...nodes);
  }
  addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }
  get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this._text; }
  set textContent(value) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this._text = String(value);
  }
  get className() { return this.getAttribute('class') || ''; }
  get firstElementChild() { return this.children[0] || null; }
  get offsetWidth() { return 120; }
  get offsetHeight() { return 30; }
  get offsetLeft() { return 0; }
  get offsetTop() { return 0; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 20, height: 20 }; }
  querySelector(selector) { return queryAll(this, selector)[0] || null; }
  querySelectorAll(selector) { return queryAll(this, selector); }
  closest(selector) {
    let node = this;
    while (node) {
      if (matchesSimple(node, selector)) return node;
      node = node.parentNode;
    }
    return null;
  }
  remove() {
    const at = this.parentNode?.children.indexOf(this) ?? -1;
    if (at >= 0) this.parentNode.children.splice(at, 1);
    this.parentNode = null;
  }
}

function createDocument() {
  const body = new FakeNode('body');
  body.classList.add('edge-right');
  const documentElement = new FakeNode('html');
  documentElement.clientWidth = 1920;
  documentElement.clientHeight = 1040;
  return {
    body,
    documentElement,
    createElement: tag => new FakeNode(tag),
    createElementNS: (_ns, tag) => new FakeNode(tag),
    querySelector: () => null,
    addEventListener() {},
  };
}

function createSandbox(now) {
  const clock = { now };
  class FakeDate extends Date { static now() { return clock.now; } }
  const document = createDocument();
  const window = {};
  const intervals = [];
  const context = vm.createContext({
    window,
    document,
    Date: FakeDate,
    console,
    ResizeObserver: class { constructor(callback) { this.callback = callback; } observe() {} },
    setInterval: callback => { intervals.push(callback); return intervals.length; },
    clearInterval() {},
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: id => clearTimeout(id),
    requestAnimationFrame: callback => callback(),
  });
  const run = name => vm.runInContext(source(name), context, { filename: name });
  run('hud-dom.js');
  run('hud-bots.js');
  return { window, document, clock, intervals, run };
}

function cardHarness(alerts, now) {
  const sandbox = createSandbox(now);
  sandbox.run('hud-card.js');
  const root = new FakeNode('section');
  root.hidden = true;
  const approveCalls = [];
  const pending = [];
  sandbox.window.hud = {
    card() {},
    approve(id, decision) {
      approveCalls.push([id, decision]);
      return new Promise(resolve => pending.push(resolve));
    },
  };
  const card = sandbox.window.HudCard.create({
    root,
    strip: { markRect: () => null },
    getItem: () => ({ id: 'claude', name: 'Claude', card: { rows: [] } }),
    getTokens: () => null,
    getMetric: () => 'quota',
    setMetric() {},
    onOpenStats() {},
    onChange() {},
    getAlerts: () => alerts,
    onDismiss() {},
    onReturn: async () => ({ status: 'gone' }),
  });
  card.open('claude');
  return { sandbox, root, card, approveCalls, pending };
}

const byAct = (root, act) => queryAll(root, `[data-act="${act}"]`);

test('an approval alert shows Approve?, the tool, the summary and two decision buttons', () => {
  const now = Date.now();
  const { root } = cardHarness([{
    id: 'approval:abc', vendor: 'claude', kind: 'approval', title: 'Fix the build',
    tool: 'Bash', text: 'npm test', at: now - 90_000,
  }], now);
  const [block] = queryAll(root, '.alert-block');
  assert.ok(block);
  assert.equal(block.dataset.id, 'approval:abc');
  assert.equal(queryAll(block, '.alert-chip')[0].textContent, 'Approve?');
  assert.equal(queryAll(block, '.bot.asking').length, 1);
  assert.equal(queryAll(block, '.alert-x').length, 0);
  assert.equal(queryAll(block, '.alert-tool')[0].textContent, 'Bash: npm test');
  assert.equal(queryAll(block, '.alert-summary').length, 0);
  assert.equal(queryAll(block, '.alert-time')[0].textContent, 'Waiting 1m');
  const allow = byAct(block, 'approve-allow')[0];
  const deny = byAct(block, 'approve-deny')[0];
  assert.equal(allow.textContent, 'Allow once');
  assert.equal(deny.textContent, 'Deny');
  assert.ok(allow.classList.contains('alert-allow'));
  assert.ok(deny.classList.contains('alert-deny'));
  assert.equal(allow.dataset.id, 'approval:abc');
  assert.equal(deny.dataset.id, 'approval:abc');
  assert.equal(byAct(block, 'return').length, 0);
});

test('approval alerts without tool or summary still render', () => {
  const now = Date.now();
  const { root } = cardHarness([{ id: 'approval:min', vendor: 'claude', kind: 'approval', at: now }], now);
  const [block] = queryAll(root, '.alert-block');
  assert.equal(block.dataset.id, 'approval:min');
  assert.equal(queryAll(block, '.alert-tool').length, 0);
  assert.equal(queryAll(block, '.alert-summary').length, 0);
  assert.equal(byAct(block, 'approve-allow').length, 1);
});

test('decisions call hud.approve and both buttons stay disabled until it settles', async () => {
  const now = Date.now();
  const { root, approveCalls, pending } = cardHarness([{
    id: 'approval:abc', vendor: 'claude', kind: 'approval', tool: 'Bash', text: 'npm test', at: now,
  }], now);
  const [block] = queryAll(root, '.alert-block');
  const allow = byAct(block, 'approve-allow')[0];
  const deny = byAct(block, 'approve-deny')[0];
  for (const listener of root.listeners.click || []) listener({ target: allow });
  assert.deepEqual(approveCalls, [['approval:abc', 'allow']]);
  assert.equal(allow.disabled, true);
  assert.equal(deny.disabled, true);
  pending[0]({ status: 'decided' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(allow.disabled, false);
  assert.equal(deny.disabled, false);
  for (const listener of root.listeners.click || []) listener({ target: deny });
  assert.deepEqual(approveCalls, [['approval:abc', 'allow'], ['approval:abc', 'deny']]);
});

test('approval alerts sort before waiting alerts, then by time', () => {
  const now = Date.now();
  const { root } = cardHarness([
    { id: 'reply:old', vendor: 'claude', kind: 'reply', at: now - 300_000 },
    { id: 'waiting:new', vendor: 'claude', kind: 'waiting', at: now - 10_000, tool: 'Bash' },
    { id: 'approval:old', vendor: 'claude', kind: 'approval', at: now - 600_000, tool: 'Edit', text: 'src/a.js' },
  ], now);
  assert.deepEqual(queryAll(root, '.alert-block').map(block => block.dataset.id), ['approval:old', 'waiting:new', 'reply:old']);
});

function settingsHarness(state) {
  const sandbox = createSandbox(Date.now());
  sandbox.run('hud-settings.js');
  const actions = [];
  const nodes = sandbox.window.HudSettings.view({
    settings: state,
    getSettings: () => state,
    getItems: () => [],
    back() {},
    onChange() {},
    onAction: async name => { actions.push(name); return { status: 'ok' }; },
  });
  const wrapper = new FakeNode('div');
  wrapper.append(...nodes);
  return { sandbox, nodes, actions, row: queryAll(wrapper, '[data-row="approvals"]')[0] };
}

test('the Approvals row falls back to Not connected with Connect when approvals state is missing', async () => {
  const { row, actions } = settingsHarness({ size: 22, ringWidth: 1.5, showsRings: true, showsNumbers: true });
  assert.ok(row);
  assert.equal(queryAll(row, '.set-note')[0].textContent, 'Not connected');
  const connect = queryAll(row, 'button').find(button => button.textContent === 'Connect');
  assert.ok(connect);
  assert.equal(queryAll(row, 'button').some(button => button.textContent === 'Disconnect'), false);
  connect.listeners.click[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(actions, ['approval-connect']);
});

test('the Approvals row follows the pushed connection state and the Codex trust note', () => {
  const state = { size: 22, ringWidth: 1.5, showsRings: true, showsNumbers: true, approvals: { claude: false, codex: false, codexAvailable: true } };
  const { row, nodes } = settingsHarness(state);
  assert.equal(queryAll(row, '.set-note')[0].textContent, 'Not connected');
  assert.equal(queryAll(row, '.set-note').some(note => note.textContent === 'Codex: run /hooks once to trust'), false, 'nothing to trust before the hook is installed');
  state.approvals = { claude: true, codex: false, codexAvailable: true };
  nodes.update();
  assert.equal(queryAll(row, '.set-note')[0].textContent, 'Connected');
  assert.ok(queryAll(row, 'button').some(button => button.textContent === 'Disconnect'));
  assert.equal(queryAll(row, 'button').some(button => button.textContent === 'Connect'), false);
  assert.equal(queryAll(row, '.set-note').some(note => note.textContent === 'Codex: run /hooks once to trust'), false);
  state.approvals = { claude: true, codex: true, codexAvailable: true };
  nodes.update();
  assert.ok(queryAll(row, '.set-note').some(note => note.textContent === 'Codex: run /hooks once to trust'), 'installed Codex hook still needs /hooks trust');
});

function stripHarness(now) {
  const sandbox = createSandbox(now);
  sandbox.window.HudMetrics = metrics;
  sandbox.run('hud-strip.js');
  const root = new FakeNode('div');
  const pill = new FakeNode('div');
  const frame = { style: new FakeStyle(), setAttribute() {}, firstElementChild: { setAttribute() {} } };
  const strip = sandbox.window.HudStrip.create({
    root, pill, frame,
    isBlocked: () => false,
    onClick() {},
    onDragStart() {},
    onStrips() {},
    onAlertsChanged() {},
  });
  strip.setSettings({ size: 22, ringWidth: 1.5, showsRings: true, showsNumbers: true });
  strip.setItems([
    { id: 'claude', name: 'Claude', label: '12%', ring: { usedPct: 12, level: 'ok', dashed: false } },
    { id: 'codex', name: 'Codex', label: '—', ring: { usedPct: null, level: 'none', dashed: false } },
  ]);
  return { sandbox, strip };
}

const sessionsWith = alerts => ({ vendors: { claude: { phase: 'asking', running: 1 }, codex: { phase: 'idle', running: 0 } }, alerts });

test('the capsule shows Approve? for a pending approval before a newer Waiting alert', () => {
  const now = Date.now();
  const { sandbox, strip } = stripHarness(now);
  strip.setSessions(sessionsWith([
    { id: 'waiting:1', vendor: 'claude', kind: 'waiting', at: now - 5_000 },
    { id: 'approval:1', vendor: 'claude', kind: 'approval', at: now - 90_000 },
  ]));
  const pills = sandbox.document.body.children.filter(node => node.classList.contains('alert-pill'));
  assert.equal(pills.length, 1);
  const text = queryAll(pills[0], '.alert-text')[0];
  assert.equal(text.textContent, 'Approve? · 1m');
  assert.ok(text.classList.contains('approval'));
});

test('the approval capsule refreshes on the 15 second tick', () => {
  const now = Date.now();
  const { sandbox, strip } = stripHarness(now);
  strip.setSessions(sessionsWith([{ id: 'approval:1', vendor: 'claude', kind: 'approval', at: now - 90_000 }]));
  const tick = sandbox.intervals[0];
  assert.ok(tick);
  sandbox.clock.now += 60_000;
  tick();
  const text = queryAll(sandbox.document.body, '.alert-text.approval')[0];
  assert.equal(text.textContent, 'Approve? · 2m');
});
