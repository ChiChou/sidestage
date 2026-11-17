import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const backgroundSource = readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8')
function background({ contexts = [], legacy = false } = {}) {
  let message, connect
  const runtime = {
    getURL: path => `chrome-extension://test/${path}`,
    onMessage: { addListener: fn => { message = fn } },
    onConnect: { addListener: fn => { connect = fn } },
    ...(legacy ? {} : { getContexts: async filter => {
      assert.deepEqual(Array.from(filter.contextTypes), ['SIDE_PANEL'])
      assert.deepEqual(Array.from(filter.documentUrls), ['chrome-extension://test/panel.html'])
      return contexts
    } }),
  }
  vm.runInNewContext(backgroundSource, { chrome: {
    runtime, sidePanel: { setPanelBehavior: async () => {} },
    commands: { onCommand: { addListener() {} } },
    tabs: { query: async () => [], sendMessage: async () => {} },
  } })
  return {
    query: () => new Promise(resolve => { message({ type: 'controller' }, {}, resolve) }),
    connect() {
      let disconnect
      connect({ name: 'controller', onDisconnect: { addListener: fn => { disconnect = fn } } })
      return () => disconnect()
    },
  }
}

test('worker restart recognizes an already open side panel without a new port', async () => {
  const worker = background({ contexts: [{ contextType: 'SIDE_PANEL' }] })
  assert.equal((await worker.query()).open, true)
})

test('no side panel means queue controls stay hidden, even with a stale port', async () => {
  const worker = background()
  worker.connect()
  assert.equal((await worker.query()).open, false)
})

test('Chrome without getContexts falls back to live controller ports', async () => {
  const worker = background({ legacy: true })
  assert.equal((await worker.query()).open, false)
  const close = worker.connect()
  assert.equal((await worker.query()).open, true)
  close()
  assert.equal((await worker.query()).open, false)
})

function contentScript() {
  let hidden, message
  const queries = [], events = new Map()
  const document = {
    documentElement: { classList: { toggle(_name, value) { hidden = value } } },
    visibilityState: 'visible',
    addEventListener: (name, fn) => events.set(name, fn),
    querySelectorAll: () => [], querySelector: () => null,
  }
  vm.runInNewContext(readFileSync(new URL('../../extension/content-queue.js', import.meta.url), 'utf8'), {
    document, location: { pathname: '/', search: '' }, URLSearchParams,
    MutationObserver: class { observe() {} }, setTimeout() {},
    chrome: { runtime: {
      onMessage: { addListener: fn => { message = fn } },
      sendMessage: msg => msg.type === 'controller'
        ? new Promise(resolve => queries.push(resolve))
        : Promise.resolve({ role: 'browser' }),
    } },
  })
  return { queries, events, notify: open => message({ type: 'controller', open }), get hidden() { return hidden } }
}
const settled = () => new Promise(resolve => setImmediate(resolve))

test('a delayed closed response cannot hide buttons after the panel opens', async () => {
  const page = contentScript()
  assert.equal(page.hidden, true)
  page.notify(true)
  page.queries[0]({ open: false })
  await settled()
  assert.equal(page.hidden, false)
  page.notify(false)
  assert.equal(page.hidden, true)
})

test('returning to YouTube and SPA navigation refresh the panel presence', async () => {
  const page = contentScript()
  page.queries[0]({ open: false })
  await settled()
  assert.equal(page.hidden, true)
  page.events.get('visibilitychange')()
  page.queries[1]({ open: true })
  await settled()
  assert.equal(page.hidden, false)
  page.events.get('yt-navigate-finish')()
  page.queries[2]({ open: false })
  await settled()
  assert.equal(page.hidden, true)
})
