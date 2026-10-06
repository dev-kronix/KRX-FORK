const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { JSDOM } = require('jsdom');
const html = readFileSync('src/dashboard/public/index.html', 'utf8');
const script = readFileSync('src/dashboard/public/app.js', 'utf8');
const user = {
  id: 2,
  firstName: 'Dev',
  role: { id: 2, name: 'user' },
  status: { name: 'active' },
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await tick();
  }
  assert.fail('UI did not reach expected state');
}
async function setup(hash, handler, authenticated = false) {
  const dom = new JSDOM(html, {
    url: 'https://krx.test/dashboard/' + hash,
    runScripts: 'outside-only',
  });
  const calls = [];
  dom.window.Headers = Headers;
  dom.window.crypto.randomUUID = randomUUID;
  dom.window.confirm = () => true;
  dom.window.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/dashboard/config'))
      return new Response(
        JSON.stringify({ apiBase: '/api/v1', googleClientId: '' }),
      );
    if (url.endsWith('/auth/me') && !options.method)
      return new Response(JSON.stringify(user));
    if (url.endsWith('/usage/summary'))
      return new Response(
        JSON.stringify({ balance: 10, totalRequests: 0, totalSpent: 0 }),
      );
    return handler(url, options);
  };
  if (authenticated) {
    dom.window.sessionStorage.setItem('krx.dashboard.token', 'test-token');
    dom.window.sessionStorage.setItem(
      'krx.dashboard.user',
      JSON.stringify(user),
    );
  }
  dom.window.eval(script);
  await tick();
  await tick();
  return { dom, calls, document: dom.window.document };
}
const submit = (dom, form) =>
  form.dispatchEvent(
    new dom.window.Event('submit', { bubbles: true, cancelable: true }),
  );

test('confirmation submits the hash and removes it after success', async () => {
  const ui = await setup(
    '#/confirm-email?hash=abc%2B123',
    () => new Response(null, { status: 204 }),
  );
  try {
    await until(() => ui.document.querySelector('#confirmEmail'));
    ui.document.querySelector('#confirmEmail').click();
    await until(() => ui.document.querySelector('#loginForm'));
    const call = ui.calls.find((c) => c.url.endsWith('/auth/email/confirm'));
    assert.deepEqual(JSON.parse(call.options.body), { hash: 'abc+123' });
    assert.equal(ui.dom.window.location.hash, '#/login');
    assert.match(
      ui.document.querySelector('#notice').textContent,
      /confirmado/,
    );
  } finally {
    ui.dom.window.close();
  }
});
test('new-email confirmation uses its separate API and invalid links cannot submit', async () => {
  const ui = await setup(
    '#/confirm-new-email?hash=changed',
    () => new Response(null, { status: 204 }),
  );
  try {
    await until(() => ui.document.querySelector('#confirmEmail'));
    ui.document.querySelector('#confirmEmail').click();
    await until(() => ui.document.querySelector('#loginForm'));
    assert(ui.calls.some((c) => c.url.endsWith('/auth/email/confirm/new')));
  } finally {
    ui.dom.window.close();
  }
  const invalid = await setup('#/confirm-email', () => {
    throw Error('must not send');
  });
  try {
    await until(() => invalid.document.querySelector('#confirmEmail'));
    assert(invalid.document.querySelector('#confirmEmail').disabled);
  } finally {
    invalid.dom.window.close();
  }
});
test('reset checks matching passwords, sends the contract and removes the hash', async () => {
  const ui = await setup(
    '#/reset-password?hash=reset-token',
    () => new Response(null, { status: 204 }),
  );
  try {
    await until(() => ui.document.querySelector('#resetForm'));
    const form = ui.document.querySelector('#resetForm');
    form.elements.newPassword.value = 'new-password';
    form.elements.repeatPassword.value = 'different';
    submit(ui.dom, form);
    await tick();
    assert(!ui.calls.some((c) => c.url.endsWith('/auth/reset/password')));
    form.elements.repeatPassword.value = 'new-password';
    submit(ui.dom, form);
    await until(() => ui.document.querySelector('#loginForm'));
    assert.deepEqual(
      JSON.parse(
        ui.calls.find((c) => c.url.endsWith('/auth/reset/password')).options
          .body,
      ),
      { hash: 'reset-token', password: 'new-password' },
    );
    assert.equal(ui.dom.window.location.hash, '#/login');
  } finally {
    ui.dom.window.close();
  }
});
test('expired reset links show the error and allow requesting another link', async () => {
  const ui = await setup(
    '#/reset-password?hash=expired',
    () =>
      new Response(JSON.stringify({ message: 'Link expirado.' }), {
        status: 422,
      }),
  );
  try {
    await until(() => ui.document.querySelector('#resetForm'));
    const form = ui.document.querySelector('#resetForm');
    form.elements.newPassword.value = form.elements.repeatPassword.value =
      'new-password';
    submit(ui.dom, form);
    await until(() => !form.querySelector('button').disabled);
    assert.match(ui.document.querySelector('#notice').textContent, /expirado/);
    assert(ui.document.querySelector('a[href="#/forgot"]'));
  } finally {
    ui.dom.window.close();
  }
});
test('password change resets the captured form after awaiting the response', async () => {
  const ui = await setup(
    '#/profile',
    async () => {
      await tick();
      return new Response(JSON.stringify(user));
    },
    true,
  );
  try {
    await until(() => ui.document.querySelector('#passwordForm'));
    const form = ui.document.querySelector('#passwordForm');
    form.elements.oldPassword.value = 'old-password';
    form.elements.password.value = 'new-password';
    submit(ui.dom, form);
    await until(() => !form.querySelector('button').disabled);
    assert.match(
      ui.document.querySelector('#notice').textContent,
      /Senha alterada/,
    );
    assert.equal(form.elements.password.value, '');
  } finally {
    ui.dom.window.close();
  }
});
test('key creation shows its secret once and revokes the selected record', async () => {
  let revoked = false;
  let created = false;
  const key = {
    id: randomUUID(),
    name: 'Bot',
    maskedKey: 'krx_live_abcd…',
    status: 'active',
  };
  const ui = await setup(
    '#/keys',
    (url, options) => {
      if (options.method === 'POST') {
        created = true;
        return new Response(
          JSON.stringify({ key: 'krx_live_secret', record: key }),
        );
      }
      if (options.method === 'DELETE') {
        revoked = true;
        return new Response(JSON.stringify({ ...key, status: 'revoked' }));
      }
      return new Response(
        JSON.stringify(
          revoked ? [{ ...key, status: 'revoked' }] : created ? [key] : [],
        ),
      );
    },
    true,
  );
  try {
    await until(() => ui.document.querySelector('#keyForm'));
    const form = ui.document.querySelector('#keyForm');
    form.elements.keyName.value = ' Bot ';
    submit(ui.dom, form);
    await until(() => ui.document.querySelector('[data-revoke]'));
    assert.equal(
      ui.document.querySelector('#keyValue').value,
      'krx_live_secret',
    );
    assert.equal(ui.document.querySelector('#newKey').hidden, false);
    ui.document.querySelector('[data-revoke]').click();
    await until(() => revoked && !ui.document.querySelector('[data-revoke]'));
    assert.match(ui.document.querySelector('#notice').textContent, /revogada/);
    ui.dom.window.location.hash = '#/profile';
    await until(() => ui.document.querySelector('#profileForm'));
    assert.equal(ui.document.querySelector('#keyValue'), null);
    assert(
      !JSON.stringify(ui.dom.window.sessionStorage).includes('krx_live_secret'),
    );
  } finally {
    ui.dom.window.close();
  }
});
test('usage renders movements and pagination without inventing service calls', async () => {
  const ui = await setup(
    '#/usage',
    () =>
      new Response(JSON.stringify({ data: [], hasNextPage: false, page: 1 })),
    true,
  );
  try {
    await until(() => ui.document.querySelector('#ledgerTab'));
    ui.document.querySelector('#ledgerTab').click();
    await until(() => ui.calls.some((c) => c.url.includes('/usage/ledger')));
    await until(() => ui.document.querySelector('#nextPage'));
    assert(ui.document.querySelector('#nextPage').disabled);
    assert.match(
      ui.document.querySelector('#app').textContent,
      /Nenhum registro/,
    );
  } finally {
    ui.dom.window.close();
  }
});
