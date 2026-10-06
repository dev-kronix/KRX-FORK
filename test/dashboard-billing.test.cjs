const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { JSDOM } = require('jsdom');
const html = readFileSync('src/dashboard/public/index.html', 'utf8');
const script = readFileSync('src/dashboard/public/app.js', 'utf8');
const plan = {
  id: 'starter',
  name: 'Starter',
  description: '<script>unsafe</script>',
  priceCents: 1290,
  creditsPerCycle: 100000,
  billingPeriodDays: 30,
  maxActiveKeys: 5,
  apiRateLimit: 30,
  normal: true,
  freefire: true,
  consultas: false,
  active: true,
  public: true,
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await tick();
  }
  assert.fail('Dashboard did not reach expected state');
}
async function setup(path, handler, admin = false) {
  const dom = new JSDOM(html, {
    url: 'https://krx.test/dashboard/' + path,
    runScripts: 'outside-only',
  });
  const calls = [];
  dom.window.Headers = Headers;
  dom.window.crypto.randomUUID = randomUUID;
  dom.window.confirm = () => true;
  dom.window.sessionStorage.setItem('krx.dashboard.token', 'test-token');
  dom.window.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/dashboard/config'))
      return new Response(JSON.stringify({ apiBase: '/api/v1' }));
    if (url.endsWith('/auth/me'))
      return new Response(
        JSON.stringify({
          id: 2,
          firstName: 'Dev',
          role: { id: admin ? 1 : 2, name: admin ? 'admin' : 'user' },
        }),
      );
    if (url.endsWith('/billing/subscription'))
      return new Response(JSON.stringify({ status: 'free', plan: null }));
    if (url.startsWith('/api/v1/billing/payments?'))
      return new Response(JSON.stringify({ data: [], hasNextPage: false }));
    return handler(url, options);
  };
  dom.window.eval(script);
  await tick();
  await tick();
  return { dom, document: dom.window.document, calls };
}
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status });
const submit = (ui, form) =>
  form.dispatchEvent(
    new ui.dom.window.Event('submit', { bubbles: true, cancelable: true }),
  );
test('checkout sends only plan and stable request ID, escapes catalog and retains ID after a failure', async () => {
  let attempts = 0;
  const ui = await setup('#/billing', (url) =>
    url.endsWith('/billing/plans')
      ? json({ plans: [plan], payments: { enabled: true, sandbox: true } })
      : ++attempts === 1
        ? json({ message: 'Provider offline' }, 502)
        : json({
            checkoutUrl: 'https://www.mercadopago.com.br/checkout/v1/test',
          }),
  );
  try {
    await until(() => ui.document.querySelector('[data-checkout]'));
    assert.equal(ui.document.querySelectorAll('#app script').length, 0);
    assert.match(
      ui.document.querySelector('#app').textContent,
      /Ambiente de testes/,
    );
    const button = ui.document.querySelector('[data-checkout]');
    button.click();
    await until(() => !button.disabled);
    button.click();
    await until(() => ui.document.querySelector('.checkout-link a'));
    const calls = ui.calls.filter((c) => c.url.endsWith('/billing/checkout'));
    const a = JSON.parse(calls[0].options.body);
    const b = JSON.parse(calls[1].options.body);
    assert.deepEqual(a, b);
    assert.deepEqual(Object.keys(a).sort(), ['planId', 'requestId']);
    assert.equal(button.disabled, true);
    assert.match(
      ui.document.querySelector('.checkout-link a').href,
      /^https:\/\/www.mercadopago.com.br\//,
    );
  } finally {
    ui.dom.window.close();
  }
});
test('unconfigured payments cannot start checkout', async () => {
  const ui = await setup('#/billing', () =>
    json({ plans: [plan], payments: { enabled: false, sandbox: true } }),
  );
  try {
    await until(() => ui.document.querySelector('[data-checkout]'));
    assert(ui.document.querySelector('[data-checkout]').disabled);
    assert.match(
      ui.document.querySelector('#app').textContent,
      /ainda não configurados/,
    );
  } finally {
    ui.dom.window.close();
  }
});
test('admin editor sends typed fields and preserves disabled sales unless selected', async () => {
  let saved;
  const ui = await setup(
    '#/billing-admin',
    (url, options) => {
      if (options.method === 'POST') {
        saved = JSON.parse(options.body);
        return json(saved);
      }
      return json([{ ...plan, active: false, public: false }]);
    },
    true,
  );
  try {
    await until(() => ui.document.querySelector('[data-edit-plan]'));
    ui.document.querySelector('[data-edit-plan]').click();
    const form = ui.document.querySelector('#planForm');
    form.elements.priceCents.value = '2990';
    form.elements.creditsPerCycle.value = '500000';
    submit(ui, form);
    await until(() => saved);
    assert.equal(saved.priceCents, 2990);
    assert.equal(saved.creditsPerCycle, 500000);
    assert.equal(saved.active, false);
    assert.equal(saved.public, false);
    assert.equal(saved.id, 'starter');
  } finally {
    ui.dom.window.close();
  }
});
test('customer cannot open admin billing or send admin requests', async () => {
  const ui = await setup('#/billing-admin', () => {
    throw new Error('No admin requests');
  });
  try {
    await until(() =>
      ui.document.querySelector('#app').textContent.includes('Sem permissão'),
    );
    assert(!ui.calls.some((c) => c.url.includes('/admin/billing')));
  } finally {
    ui.dom.window.close();
  }
});
test('provider return queries the owned order rather than trusting approved URL status and cleans query', async () => {
  const id = randomUUID();
  const ui = await setup(
    '?external_reference=' + id + '&payment_id=12345&status=approved',
    (url, options) => {
      assert.equal(url, '/api/v1/billing/payments/' + id + '/reconcile');
      assert.deepEqual(JSON.parse(options.body), {
        providerPaymentId: '12345',
      });
      return json({ status: 'pending' });
    },
  );
  try {
    await until(() =>
      ui.document.querySelector('#notice')?.textContent.includes('Pendente'),
    );
    assert.equal(ui.dom.window.location.search, '');
    assert.equal(ui.dom.window.location.hash, '#/payments');
    assert.equal(
      ui.calls.filter((c) => c.url.endsWith('/reconcile')).length,
      1,
    );
  } finally {
    ui.dom.window.close();
  }
});
