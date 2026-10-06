const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { JSDOM } = require('jsdom');
const html = readFileSync('src/dashboard/public/index.html', 'utf8');
const script = readFileSync('src/dashboard/public/app.js', 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await tick();
  }
  assert.fail('Dashboard did not reach expected state');
}
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status });
const id = 'dfb5a8fc-f7f0-4c08-a84a-1949b6b47d4a';
async function setup(path, handler, admin = false) {
  const dom = new JSDOM(html, {
    url: 'https://krx.test/dashboard/' + path,
    runScripts: 'outside-only',
  });
  dom.window.Headers = Headers;
  dom.window.crypto.randomUUID = randomUUID;
  dom.window.sessionStorage.setItem('krx.dashboard.token', 'test-token');
  const calls = [];
  dom.window.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/dashboard/config')) return json({ apiBase: '/api/v1' });
    if (url.endsWith('/auth/me'))
      return json({
        id: 2,
        firstName: 'Dev',
        role: { id: admin ? 1 : 2, name: admin ? 'admin' : 'user' },
      });
    return handler(url, options);
  };
  dom.window.eval(script);
  await tick();
  await tick();
  return { dom, document: dom.window.document, calls };
}
const submit = (ui, form) =>
  form.dispatchEvent(
    new ui.dom.window.Event('submit', { bubbles: true, cancelable: true }),
  );
test('ticket creation retains request ID on failure, trims text and opens real conversation', async () => {
  let attempts = [];
  const ui = await setup('#/support', (url, options) => {
    if (options.method === 'POST') {
      attempts.push(JSON.parse(options.body));
      return attempts.length === 1
        ? json({ message: 'Tente novamente' }, 503)
        : json({ id });
    }
    if (url.endsWith('/support/' + id))
      return json({ id, subject: 'Dúvida', status: 'open', messages: [] });
    return json({ data: [], total: 0 });
  });
  try {
    await until(() => ui.document.querySelector('#ticketForm'));
    const form = ui.document.querySelector('#ticketForm');
    form.elements.subject.value = ' Dúvida ';
    form.elements.body.value = ' Minha mensagem ';
    submit(ui, form);
    await until(
      () => attempts.length === 1 && !form.querySelector('button').disabled,
    );
    submit(ui, form);
    await until(() => ui.document.querySelector('#replyForm'));
    assert.equal(attempts[0].requestId, attempts[1].requestId);
    assert.equal(attempts[0].body, 'Minha mensagem');
    assert.equal(attempts[0].subject, 'Dúvida');
    assert.equal(ui.dom.window.location.hash, '#/support?ticket=' + id);
  } finally {
    ui.dom.window.close();
  }
});
test('conversation escapes user content and sends admin reply through protected endpoint', async () => {
  const replies = [];
  const ui = await setup(
    '#/support-admin?ticket=' + id,
    (url, options) => {
      if (options.method === 'POST') {
        replies.push({ url, body: JSON.parse(options.body) });
        return json({ id });
      }
      return json({
        id,
        userId: 3,
        subject: '<img src=x onerror=alert(1)>',
        status: 'open',
        messages: [
          {
            body: '<script>unsafe</script>',
            isAdmin: false,
            createdAt: '2026-10-06T00:00:00Z',
          },
        ],
      });
    },
    true,
  );
  try {
    await until(() => ui.document.querySelector('#replyForm'));
    assert.equal(ui.document.querySelector('#app img'), null);
    assert.equal(ui.document.querySelector('#app script'), null);
    assert.match(
      ui.document.querySelector('.message').textContent,
      /<script>unsafe/,
    );
    const form = ui.document.querySelector('#replyForm');
    form.elements.body.value = 'Resposta';
    submit(ui, form);
    await until(() => replies.length === 1);
    assert.equal(replies[0].url, '/api/v1/admin/support/' + id + '/messages');
    assert.equal(replies[0].body.body, 'Resposta');
    assert.ok(replies[0].body.requestId);
  } finally {
    ui.dom.window.close();
  }
});
test('notifications show actual unread count and persist read action', async () => {
  let read = false;
  const ui = await setup('#/notifications', (url, options) => {
    if (options.method === 'PATCH') {
      assert.equal(url, '/api/v1/notifications/' + id + '/read');
      read = true;
      return json({ id });
    }
    return json({
      unread: read ? 0 : 1,
      total: 1,
      data: [
        {
          id,
          ticketId: id,
          title: 'Nova resposta',
          createdAt: '2026-10-06T00:00:00Z',
          readAt: read ? '2026-10-06T01:00:00Z' : null,
        },
      ],
    });
  });
  try {
    await until(() => ui.document.querySelector('[data-read]'));
    ui.document.querySelector('[data-read]').click();
    await until(() => read && !ui.document.querySelector('[data-read]'));
    assert.match(
      ui.document.querySelector('.page-header').textContent,
      /0 não lidas/,
    );
    assert.equal(
      ui.document.querySelector('.notification-row a').getAttribute('href'),
      '#/support?ticket=' + id,
    );
  } finally {
    ui.dom.window.close();
  }
});
test('closed ticket has reopen action and no reply form', async () => {
  const updates = [];
  const ui = await setup('#/support?ticket=' + id, (url, options) => {
    if (options.method === 'PATCH') {
      updates.push(JSON.parse(options.body));
      return json({ id });
    }
    return json({
      id,
      subject: 'Teste',
      status: updates.length ? 'open' : 'closed',
      messages: [],
    });
  });
  try {
    await until(() => ui.document.querySelector('#ticketStatus'));
    assert.equal(ui.document.querySelector('#replyForm'), null);
    ui.document.querySelector('#ticketStatus').click();
    await until(() => ui.document.querySelector('#replyForm'));
    assert.deepEqual(updates, [{ status: 'open' }]);
  } finally {
    ui.dom.window.close();
  }
});
