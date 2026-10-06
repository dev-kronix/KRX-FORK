const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { JSDOM } = require('jsdom');
const helpers = require('../src/dashboard/public/playground.js');
const legacy = JSON.parse(
  readFileSync('src/catalog/contracts/legacy.json', 'utf8'),
);
const gpt = legacy.categories
  .flatMap((c) => c.routes)
  .find((r) => r.id === 'ias-gpt');
const user = { id: 2, firstName: 'Dev', role: { id: 2, name: 'user' } };
const current = {
  id: 'current-usage',
  name: 'Saldo',
  method: 'GET',
  path: '/api/v1/usage/summary',
  source: 'current',
  auth: 'session',
  executable: true,
  credits: 0,
  parameters: [],
  contentType: 'application/json',
  body: null,
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await tick();
  }
  assert.fail('UI did not reach expected state');
}
async function setup(
  path,
  handler = () => new Response(JSON.stringify({ balance: 42 })),
  routes = [current, { ...gpt, source: 'legacy', executable: false }],
  authenticated = true,
) {
  const dom = new JSDOM(
    readFileSync('src/dashboard/public/index.html', 'utf8'),
    { url: 'https://krx.test/dashboard/' + path, runScripts: 'outside-only' },
  );
  const calls = [];
  Object.assign(dom.window, {
    Headers,
    TextDecoder,
    TextEncoder,
    AbortController,
  });
  if (authenticated)
    dom.window.sessionStorage.setItem(
      'krx.dashboard.token',
      'REAL_SECRET_SESSION',
    );
  dom.window.navigator.clipboard = { writeText: async () => {} };
  dom.window.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/dashboard/config')) return new Response('{}');
    if (url.endsWith('/auth/me')) return new Response(JSON.stringify(user));
    if (url.endsWith('/catalog'))
      return new Response(
        JSON.stringify({
          data: {
            routeCount: routes.length,
            categories: [
              { id: 'ias', name: 'IAs', description: 'Modelos', routes },
            ],
          },
        }),
      );
    return handler(url, options);
  };
  dom.window.eval(readFileSync('src/dashboard/public/playground.js', 'utf8'));
  dom.window.eval(readFileSync('src/dashboard/public/app.js', 'utf8'));
  await tick();
  await tick();
  return { dom, document: dom.window.document, calls };
}
const submit = (ui) =>
  ui.document
    .querySelector('#playgroundForm')
    .dispatchEvent(
      new ui.dom.window.Event('submit', { bubbles: true, cancelable: true }),
    );
test('examples encode parameters and never embed supplied credentials', () => {
  const values = { query: 'A & B? / café' };
  const code = helpers.buildCodeSamples(gpt, {
    baseUrl: 'https://krx.test',
    parameters: values,
    apiKey: 'SECRET_API_KEY',
    sessionToken: 'SECRET_JWT',
  });
  assert.equal(new URL(code.url).searchParams.get('query'), values.query);
  for (const value of Object.values(code)) {
    assert(!value.includes('SECRET_API_KEY'));
    assert(!value.includes('SECRET_JWT'));
  }
  assert.match(code.javascript, /SUA_CHAVE_KRX/);
  assert.match(code.javascript, /payload.data.resposta/);
  assert.match(
    helpers.buildCodeSamples(current).javascript,
    /const resultado = payload;/,
  );
  assert.match(
    helpers.buildCodeSamples(current).python,
    /resultado = payload\n/,
  );
});
test('required inputs and JSON body are checked without silently replacing invalid data', () => {
  assert.throws(() => helpers.validateRequest(gpt, { query: '' }, ''), /query/);
  const bodyRoute = {
    ...current,
    body: { fields: [{ name: 'title', required: true }] },
  };
  assert.throws(
    () => helpers.validateRequest(bodyRoute, {}, 'broken'),
    /JSON inválido/,
  );
  assert.throws(() => helpers.validateRequest(bodyRoute, {}, '{}'), /title/);
  assert.throws(
    () => helpers.buildCodeSamples(bodyRoute, { bodyText: 'broken' }),
    /JSON inválido/,
  );
  helpers.validateRequest(bodyRoute, {}, '{"title":"Hello"}');
});
test('multipart and binary examples preserve upload boundaries and download handling', () => {
  const routes = legacy.categories.flatMap((c) => c.routes);
  const upload = routes.find((r) => r.id === 'upload');
  const sample = helpers.buildCodeSamples(upload);
  assert.match(sample.javascript, /body: formData/);
  assert(!sample.javascript.includes('"Content-Type": "multipart/form-data"'));
  assert.match(sample.curl, /--form/);
  const binary = routes.find((r) => r.contentType.startsWith('image/'));
  assert.match(
    helpers.buildCodeSamples(binary).javascript,
    /response.arrayBuffer/,
  );
});
test('all restored default code samples are syntactically valid JavaScript and Python', () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const python = [];
  for (const route of [
    ...legacy.categories.flatMap((c) => c.routes),
    current,
  ]) {
    const samples = helpers.buildCodeSamples(route);
    assert.doesNotThrow(
      () =>
        new AsyncFunction(samples.javascript.replace(/^import .*;\n/gm, '')),
      route.id,
    );
    python.push(samples.python);
  }
  const result = spawnSync(
    'python3',
    ['-c', 'import ast,json,sys\nfor s in json.load(sys.stdin): ast.parse(s)'],
    { input: JSON.stringify(python), encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});
test('legacy selection builds examples and cannot execute even through a synthetic submit', async () => {
  const ui = await setup('#/playground?route=ias-gpt');
  try {
    await until(() => ui.document.querySelector('#executeRequest'));
    assert(ui.document.querySelector('#executeRequest').disabled);
    submit(ui);
    await tick();
    assert(!ui.calls.some((c) => c.url.includes('/ias/gpt')));
    assert.match(
      ui.document.querySelector('#codeSample').textContent,
      /SUA_CHAVE_KRX/,
    );
    assert(
      !ui.document
        .querySelector('#codeSample')
        .textContent.includes('REAL_SECRET_SESSION'),
    );
  } finally {
    ui.dom.window.close();
  }
});
test('current read uses JWT on the same origin and reports the actual response without exposing it in examples', async () => {
  const ui = await setup('#/playground?route=current-usage');
  try {
    await until(() => ui.document.querySelector('#executeRequest'));
    submit(ui);
    await until(() =>
      ui.document
        .querySelector('#executionStatus')
        .textContent.startsWith('HTTP'),
    );
    const call = ui.calls.find(
      (c) => c.url === 'https://krx.test/api/v1/usage/summary',
    );
    assert.equal(
      call.options.headers.Authorization,
      'Bearer REAL_SECRET_SESSION',
    );
    assert.equal(call.options.method, 'GET');
    assert.match(
      ui.document.querySelector('#executionOutput').textContent,
      /42/,
    );
    assert(
      !ui.document
        .querySelector('#codeSample')
        .textContent.includes('REAL_SECRET_SESSION'),
    );
  } finally {
    ui.dom.window.close();
  }
});
test('public reads omit JWT and unknown or modified destinations cannot run', async () => {
  const route = {
    ...current,
    id: 'current-plans',
    auth: 'none',
    path: '/api/v1/billing/plans',
  };
  const ui = await setup(
    '#/playground?route=current-plans',
    () => new Response('{"plans":[]}'),
    [route],
  );
  try {
    await until(() => ui.document.querySelector('#executeRequest'));
    submit(ui);
    await until(() =>
      ui.document
        .querySelector('#executionStatus')
        .textContent.startsWith('HTTP'),
    );
    const call = ui.calls.find((c) => c.url.startsWith('https://'));
    assert.equal(call.options.headers.Authorization, undefined);
  } finally {
    ui.dom.window.close();
  }
  const blocked = await setup(
    '#/playground?route=current-usage',
    () => {
      throw Error('Must not execute');
    },
    [{ ...current, path: 'https://evil.test/secret' }],
  );
  try {
    await until(() => blocked.document.querySelector('#executeRequest'));
    assert(blocked.document.querySelector('#executeRequest').disabled);
    submit(blocked);
    await tick();
    assert(!blocked.calls.some((c) => c.url.startsWith('https://')));
  } finally {
    blocked.dom.window.close();
  }
});
test('logical errors, non-JSON responses and excessive payloads remain distinct from illustrative contracts', async () => {
  for (const [response, expected] of [
    [new Response('{"success":false,"error":{"message":"Nope"}}'), /Nope/],
    [new Response('<script>unsafe</script>', { status: 502 }), /unsafe/],
    [new Response('x'.repeat(1048577)), /1 MiB/],
  ]) {
    const ui = await setup('#/playground', () => response);
    try {
      await until(() => ui.document.querySelector('#executeRequest'));
      submit(ui);
      await until(
        () =>
          ui.document.querySelector('#executionStatus').textContent !==
            'Consultando...' &&
          ui.document.querySelector('#executionStatus').textContent !==
            'Nenhuma requisição executada.',
      );
      assert.match(
        ui.document.querySelector('#executionOutput').textContent +
          ui.document.querySelector('#executionStatus').textContent,
        expected,
      );
      assert.equal(ui.document.querySelector('#executionOutput script'), null);
    } finally {
      ui.dom.window.close();
    }
  }
});
test('category search filters contracts and handles a missing selection', async () => {
  const ui = await setup('#/catalog');
  try {
    await until(() => ui.document.querySelector('#catalogSearch'));
    const input = ui.document.querySelector('#catalogSearch');
    input.value = 'GPT';
    input.dispatchEvent(new ui.dom.window.Event('input'));
    assert.equal(
      ui.document.querySelectorAll('#catalogResults article').length,
      1,
    );
    input.value = 'notfound';
    input.dispatchEvent(new ui.dom.window.Event('input'));
    assert.match(
      ui.document.querySelector('#catalogResults').textContent,
      /Nenhum/,
    );
  } finally {
    ui.dom.window.close();
  }
  const missing = await setup('#/playground?route=unknown');
  try {
    await until(() =>
      missing.document
        .querySelector('#notice')
        ?.textContent.includes('não encontrado'),
    );
    assert.equal(missing.document.querySelector('#executeRequest'), null);
  } finally {
    missing.dom.window.close();
  }
});

test('login restores deep links including legacy contract IDs with underscores', async () => {
  for (const routeId of ['ias-gpt', 'stickers-figu_anime']) {
    const legacyRoute = legacy.categories
      .flatMap((c) => c.routes)
      .find((r) => r.id === routeId);
    const ui = await setup(
      '#/playground?route=' + routeId,
      (url) => {
        assert(url.endsWith('/auth/email/login'));
        return new Response(
          JSON.stringify({
            token: 'REAL_SECRET_SESSION',
            refreshToken: 'refresh',
            user,
          }),
        );
      },
      [current, { ...legacyRoute, source: 'legacy', executable: false }],
      false,
    );
    try {
      await until(() => ui.document.querySelector('#loginForm'));
      const form = ui.document.querySelector('#loginForm');
      form.elements.email.value = 'dev@example.com';
      form.elements.password.value = 'test-password';
      form.dispatchEvent(
        new ui.dom.window.Event('submit', { bubbles: true, cancelable: true }),
      );
      await until(() => ui.document.querySelector('#playgroundRoute'));
      assert.equal(
        ui.dom.window.location.hash,
        '#/playground?route=' + routeId,
      );
      assert.equal(
        ui.document.querySelector('#playgroundRoute').value,
        routeId,
      );
      assert.equal(
        ui.dom.window.sessionStorage.getItem('krx.dashboard.return'),
        null,
      );
    } finally {
      ui.dom.window.close();
    }
  }
});
test('running read can be cancelled without enabling legacy execution', async () => {
  const ui = await setup(
    '#/playground',
    (url, options) =>
      new Promise((resolve, reject) =>
        options.signal.addEventListener(
          'abort',
          () => reject(new DOMException('Cancelled', 'AbortError')),
          { once: true },
        ),
      ),
  );
  try {
    await until(() => ui.document.querySelector('#executeRequest'));
    submit(ui);
    await until(() => !ui.document.querySelector('#cancelRequest').hidden);
    ui.document.querySelector('#cancelRequest').click();
    await until(() =>
      ui.document
        .querySelector('#executionStatus')
        .textContent.includes('cancelada'),
    );
    assert.equal(ui.document.querySelector('#executeRequest').disabled, false);
  } finally {
    ui.dom.window.close();
  }
});
