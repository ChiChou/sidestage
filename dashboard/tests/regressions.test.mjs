import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import test from 'node:test'
import ts from 'typescript'

function load(name, globals = {}, imports = {}) {
  const source = readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const context = vm.createContext({ exports: {}, ...globals, require: (id) => {
    assert.ok(id in imports, `Unexpected import: ${id}`)
    return imports[id]
  } })
  vm.runInContext(code, context)
  return context.exports
}
const tick = () => new Promise((resolve) => setImmediate(resolve))
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }

// A shared lock manager model, including simulated release when an owning page closes.
function locks() {
  const tails = new Map(), active = new Map()
  return {
    request(name, callback) {
      const previous = tails.get(name) ?? Promise.resolve()
      const release = deferred()
      tails.set(name, previous.then(() => release.promise))
      return previous.then(async () => {
        active.set(name, release.resolve)
        try { return await callback() } finally { release.resolve() }
      })
    },
    closeOwner(name) { active.get(name)?.() },
  }
}

test('only the owning panel starts a controller; a waiting panel takes over after close', async () => {
  const manager = locks()
  const first = load('ownership', { navigator: { locks: manager } })
  const second = load('ownership', { navigator: { locks: manager } })
  const started = []
  void first.ownController(async () => { started.push('first') })
  void second.ownController(async () => { started.push('second') })
  await tick()
  assert.deepEqual(started, ['first'])
  manager.closeOwner('sidestage-controller')
  await tick()
  assert.deepEqual(started, ['first', 'second'])
})

function controller({ put = async () => {}, initialFiles = [], initialBridges = [], activeBridge, tabUrl = 'https://www.youtube.com/watch?v=AAAAAAAAAAA' } = {}) {
  const files = new Map(initialFiles.map((key) => [key, {}]))
  const manager = locks()
  const ownership = load('ownership', { navigator: { locks: manager } })
  const event = { addListener() {} }
  const persisted = { current: { id: 'AAAAAAAAAAA', title: 'Current song' }, sung: [], upcoming: [], bridges: initialBridges }
  const chrome = {
    runtime: { getURL: (p) => `chrome-extension://test/${p}`, onMessage: event, sendMessage: async () => {}, connect: () => ({ onDisconnect: event }) },
    storage: {
      local: { get: async () => structuredClone(persisted), set: async () => {} },
      session: { get: async () => ({ playerTabId: 1, playerWindowId: 1, activeBridge }), set: async () => {} },
    },
    system: { display: { getInfo: async () => [], onDisplayChanged: event } },
    tabs: { get: async () => ({ url: tabUrl }), update: async () => {}, query: async () => [], onUpdated: event },
    windows: { onRemoved: event },
  }
  const messages = []
  const dj = load('dj', {
    chrome, URL, crypto: webcrypto, window: {}, setInterval() {}, setTimeout() {}, clearTimeout() {},
  }, {
    './ownership': ownership,
    './overlay': { bridgeOverlay() {} },
    './i18n': { t: (key) => key },
    './idb': {
      putFile: async (key, blob) => { await put(key, blob); files.set(key, blob) },
      deleteFile: async (key) => { files.delete(key) },
      listFileKeys: async () => [...files.keys()],
    },
  })
  dj.setToastHandler((message) => messages.push(message))
  return { dj, files, messages, drain: () => ownership.withMediaLock(async () => {}) }
}
const media = (name) => ({ name, type: 'audio/mpeg' })

test('cleanup waits for an import to publish its file references', async () => {
  const paused = deferred(), release = deferred()
  let writes = 0
  const { dj, files, drain } = controller({ put: async () => {
    if (++writes === 2) { paused.resolve(); await release.promise }
  } })
  await dj.boot(); await drain()
  const importing = dj.enqueueFiles([media('one.mp3'), media('two.mp3')])
  await paused.promise
  dj.clearSung()
  release.resolve()
  await importing; await drain()
  assert.equal(dj.getSnapshot().upcoming.length, 2)
  for (const item of dj.getSnapshot().upcoming) assert.ok(files.has(item.id))
})

test('queueing a video that is already waiting prompts instead of adding it', async () => {
  const { dj, drain } = controller()
  await dj.boot(); await drain()
  const prompts = []
  dj.setDuplicateHandler((title, addAnyway) => prompts.push({ title, addAnyway }))
  const first = await dj.enqueue('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'Never Gonna Give You Up')
  assert.ok(first.ok)
  const again = await dj.enqueue('dQw4w9WgXcQ')
  assert.deepEqual([again.ok, again.duplicate], [false, true])
  assert.equal(dj.getSnapshot().upcoming.length, 1)
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].title, 'Never Gonna Give You Up')
  prompts[0].addAnyway()
  await tick()
  assert.equal(dj.getSnapshot().upcoming.length, 2)
})

test('a failed batch rolls back stored files and reports the failure', async () => {
  let writes = 0
  const { dj, files, messages, drain } = controller({ put: async () => {
    if (++writes === 2) throw new Error('quota exceeded')
  } })
  await dj.boot(); await drain()
  await dj.enqueueFiles([media('one.mp3'), media('two.mp3')])
  assert.equal(files.size, 0)
  assert.equal(dj.getSnapshot().upcoming.length, 0)
  assert.ok(messages.includes('fileImportFailed'))
})

test('removing an active bridge retains its file until playback leaves it', async () => {
  const { dj, files, drain } = controller({ initialFiles: ['bridge'], initialBridges: [{ key: 'bridge', kind: 'file', title: 'Mix', pos: 0 }] })
  await dj.boot(); await drain()
  await dj.startBridge(0)
  dj.removeBridge(0)
  await drain()
  assert.ok(files.has('bridge'))
  await dj.next(true); await drain()
  assert.equal(files.has('bridge'), false)
})

test('startup cleanup removes orphaned files and retains listed bridges', async () => {
  const { dj, files, drain } = controller({ initialFiles: ['orphan', 'bridge'], initialBridges: [{ key: 'bridge', kind: 'file', title: 'Mix', pos: 0 }] })
  await dj.boot(); await drain()
  assert.deepEqual([...files.keys()], ['bridge'])
})

test('ownership handoff retains a removed bridge that is still playing', async () => {
  const { dj, files, drain } = controller({
    initialFiles: ['bridge'],
    activeBridge: { key: 'bridge', kind: 'file', title: 'Removed mix', pos: 12 },
    tabUrl: 'chrome-extension://test/media.html?mode=bridge&key=bridge',
  })
  await dj.boot(); await drain()
  assert.equal(dj.getSnapshot().phase, 'bridge')
  assert.equal(dj.getSnapshot().bridges.length, 0)
  assert.ok(files.has('bridge'))
})

function database() {
  let openRequest, transaction, request, closed = false
  const idb = load('idb', { indexedDB: { open() { openRequest = {}; return openRequest } } })
  const db = {
    close() { closed = true },
    transaction() {
      transaction = { objectStore: () => ({ put: () => { request = { result: 'key' }; return request } }) }
      return transaction
    },
  }
  return {
    idb,
    async opened() { openRequest.result = db; openRequest.onsuccess(); await tick() },
    requestSuccess() { request.onsuccess?.() },
    commit() { transaction.oncomplete() },
    abort() { transaction.error = new Error('transaction aborted'); transaction.onabort() },
    get closed() { return closed },
  }
}

test('a successful IDB request resolves only when the transaction commits', async () => {
  const db = database()
  let resolved = false
  const write = db.idb.putFile('key', {}).then(() => { resolved = true })
  await db.opened(); db.requestSuccess(); await tick()
  assert.equal(resolved, false)
  db.commit(); await write
  assert.equal(resolved, true)
  assert.equal(db.closed, true)
})

test('an IDB transaction abort after request success rejects the write', async () => {
  const db = database()
  const write = db.idb.putFile('key', {})
  await db.opened(); db.requestSuccess()
  const rejected = assert.rejects(write, /transaction aborted/)
  db.abort(); await rejected
  assert.equal(db.closed, true)
})

test('transport shortcuts defer to controls and ignore repeats, composition and modifiers', () => {
  class Element {
    constructor(interactive) { this.interactive = interactive }
    closest() { return this.interactive ? this : null }
  }
  const { isTransportShortcut } = load('keyboard', { Element })
  assert.equal(isTransportShortcut({ target: new Element(false) }), true)
  assert.equal(isTransportShortcut({ target: new Element(true) }), false)
  for (const flag of ['defaultPrevented', 'repeat', 'isComposing', 'ctrlKey', 'metaKey', 'altKey']) {
    assert.equal(isTransportShortcut({ target: new Element(false), [flag]: true }), false, flag)
  }
})
