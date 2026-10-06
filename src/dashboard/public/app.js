(() => {
  const app = document.querySelector('#app');
  const nav = document.querySelector('#nav');
  const menuButton = document.querySelector('#menuButton');
  const logoutButton = document.querySelector('#logoutButton');
  const keys = {
    token: 'krx.dashboard.token',
    refresh: 'krx.dashboard.refresh',
    expires: 'krx.dashboard.expires',
    user: 'krx.dashboard.user',
  };
  let config = { apiBase: '/api/v1', googleClientId: '' };
  let currentUser = readUser();
  let pendingRefresh;
  let routeQueue = Promise.resolve();
  const returnParams = new URLSearchParams(location.search);
  const returnOrder = returnParams.get('external_reference');
  const returnPayment =
    returnParams.get('payment_id') || returnParams.get('collection_id');
  let checkoutReturn =
    /^[a-f0-9-]{36}$/i.test(returnOrder || '') &&
    /^\d{1,30}$/.test(returnPayment || '')
      ? { orderId: returnOrder, providerPaymentId: returnPayment }
      : null;
  if (
    returnParams.has('external_reference') ||
    returnParams.has('payment_id') ||
    returnParams.has('collection_id')
  )
    history.replaceState(null, '', location.pathname + location.hash);

  function esc(value) {
    return String(value ?? '').replace(
      /[&<>"']/g,
      (char) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[char],
    );
  }

  function readUser() {
    try {
      return JSON.parse(sessionStorage.getItem(keys.user) || 'null');
    } catch {
      return null;
    }
  }

  function saveSession(data) {
    sessionStorage.setItem(keys.token, data.token);
    sessionStorage.setItem(keys.refresh, data.refreshToken);
    sessionStorage.setItem(keys.expires, String(data.tokenExpires || 0));
    if (data.user) {
      currentUser = data.user;
      sessionStorage.setItem(keys.user, JSON.stringify(data.user));
    }
  }

  function authenticatedDestination() {
    const target = sessionStorage.getItem('krx.dashboard.return') || '#/';
    sessionStorage.removeItem('krx.dashboard.return');
    return /^#\/(catalog|playground)(\?route=[a-z0-9_-]{1,80})?$/.test(
      target,
    ) ||
      /^#\/(support|support-admin)(\?ticket=[a-f0-9-]{36})?$/.test(target) ||
      target === '#/notifications'
      ? target
      : '#/';
  }

  function clearSession() {
    Object.values(keys).forEach((key) => sessionStorage.removeItem(key));
    currentUser = null;
    sessionStorage.removeItem('krx.dashboard.return');
  }

  async function refreshSession() {
    if (pendingRefresh) return pendingRefresh;
    pendingRefresh = performRefresh().finally(() => {
      pendingRefresh = null;
    });
    return pendingRefresh;
  }

  async function performRefresh() {
    const refreshToken = sessionStorage.getItem(keys.refresh);
    if (!refreshToken) return false;
    const response = await fetch(config.apiBase + '/auth/refresh', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + refreshToken },
    });
    if (!response.ok) {
      clearSession();
      return false;
    }
    saveSession(await response.json());
    return true;
  }

  async function api(path, options = {}, retry = true) {
    const headers = new Headers(options.headers || {});
    const token = sessionStorage.getItem(keys.token);
    if (token) headers.set('Authorization', 'Bearer ' + token);
    if (options.body && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(config.apiBase + path, {
      ...options,
      headers,
    });
    if (response.status === 401 && retry && (await refreshSession())) {
      return api(path, options, false);
    }
    if (response.status === 204) return null;
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = data?.errors
        ? Object.values(data.errors).join(', ')
        : data?.message;
      const messages = {
        invalidHash: 'Link inválido ou expirado. Solicite um novo link.',
        incorrectEmailOrPassword: 'E-mail ou senha incorretos.',
        incorrectPassword: 'Senha incorreta.',
        emailExists: 'Este e-mail já está cadastrado.',
        missingOldPassword: 'Informe sua senha atual.',
        incorrectOldPassword: 'A senha atual está incorreta.',
      };
      const message = Array.isArray(detail) ? detail.join(', ') : detail;
      throw new Error(
        messages[message] || message || 'Não foi possível concluir a operação.',
      );
    }
    return data;
  }

  async function loadConfig() {
    try {
      const response = await fetch('/api/v1/dashboard/config');
      if (response.ok) config = { ...config, ...(await response.json()) };
    } catch {}
  }

  async function requireUser() {
    if (!sessionStorage.getItem(keys.token)) return false;
    try {
      currentUser = await api('/auth/me');
      sessionStorage.setItem(keys.user, JSON.stringify(currentUser));
      return true;
    } catch {
      clearSession();
      return false;
    }
  }

  function roleName(user) {
    return (
      user?.role?.name || (String(user?.role?.id) === '1' ? 'admin' : 'user')
    );
  }

  function statusName(user) {
    return (
      user?.status?.name ||
      (String(user?.status?.id) === '1' ? 'active' : 'inactive')
    );
  }

  function nameOf(user) {
    return (
      [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
      user?.email ||
      'Usuário'
    );
  }

  function setNav(authenticated) {
    document.body.classList.toggle('guest', !authenticated);
    if (authenticated) {
      const titles = {
        '#/': 'Visão geral',
        '#/keys': 'Chaves de API',
        '#/usage': 'Créditos e consumo',
        '#/catalog': 'Endpoints',
        '#/playground': 'Playground',
        '#/billing': 'Planos e pagamentos',
        '#/payments': 'Histórico de pagamentos',
        '#/billing-admin': 'Administrar planos',
        '#/billing-payments': 'Vendas',
        '#/credits': 'Ajustes de créditos',
        '#/users': 'Usuários',
        '#/support': 'Suporte',
        '#/support-admin': 'Central de chamados',
        '#/notifications': 'Notificações',
        '#/profile': 'Perfil e segurança',
      };
      document.querySelector('#workspaceTitle').textContent =
        titles[location.hash.split('?')[0] || '#/'] || 'Workspace';
      document.querySelector('#workspaceUser').textContent =
        currentUser.email || nameOf(currentUser);
      document.querySelector('#sidebarName').textContent = nameOf(currentUser);
      document.querySelector('#sidebarAvatar').textContent = nameOf(currentUser)
        .slice(0, 1)
        .toUpperCase();
    }
    document.querySelector('.topbar').style.display = authenticated
      ? 'flex'
      : 'none';
    document.querySelector('footer').style.display = authenticated
      ? 'flex'
      : 'none';
    document.querySelectorAll('[data-admin]').forEach((el) => {
      el.style.display =
        authenticated && roleName(currentUser) === 'admin' ? '' : 'none';
    });
    nav?.querySelectorAll('a[href^="#/"]').forEach((a) => {
      const active =
        a.getAttribute('href') === (location.hash.split('?')[0] || '#/');
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function notice(message, error = false) {
    const box = document.querySelector('#notice');
    if (!box) return;
    box.hidden = false;
    box.className = 'notice' + (error ? ' error' : '');
    box.textContent = message;
  }

  function loginView() {
    setNav(false);
    app.innerHTML =
      '<section class="auth-wrap"><div class="auth">' +
      '<div class="eyebrow">KRX / ACESSO</div><h1>Entre na KRX.</h1>' +
      '<p class="muted">Gerencie sua conta e os recursos da API em um só lugar.</p>' +
      '<div class="auth-card"><div id="notice" hidden></div>' +
      '<form id="loginForm"><label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" required>' +
      '<label for="password">Senha</label><input id="password" name="password" type="password" autocomplete="current-password" required>' +
      '<button class="button" type="submit">Entrar</button></form>' +
      '<div class="divider">ou</div><div class="google-slot" id="googleButton"></div>' +
      '<div class="auth-links"><a href="#/register">Criar conta</a><a href="#/forgot">Esqueci a senha</a></div></div></div></section>';

    document
      .querySelector('#loginForm')
      .addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = event.currentTarget.querySelector('button');
        button.disabled = true;
        try {
          const data = await api('/auth/email/login', {
            method: 'POST',
            body: JSON.stringify({
              email: event.currentTarget.elements.namedItem('email').value,
              password:
                event.currentTarget.elements.namedItem('password').value,
            }),
          });
          saveSession(data);
          location.hash = authenticatedDestination();
          // hashchange renders the authenticated page.
        } catch (error) {
          notice(error.message, true);
        } finally {
          button.disabled = false;
        }
      });
    initGoogle();
  }

  function registerView() {
    setNav(false);
    app.innerHTML =
      '<section class="auth-wrap"><div class="auth">' +
      '<div class="eyebrow">KRX / CADASTRO</div><h1>Crie sua conta.</h1>' +
      '<p class="muted">O cadastro por e-mail exige confirmação antes do primeiro login.</p>' +
      '<div class="auth-card"><div id="notice" hidden></div><form id="registerForm">' +
      '<label for="firstName">Nome</label><input id="firstName" name="firstName" required>' +
      '<label for="lastName">Sobrenome</label><input id="lastName" name="lastName" required>' +
      '<label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" required>' +
      '<label for="password">Senha</label><input id="password" name="password" type="password" minlength="6" autocomplete="new-password" required>' +
      '<button class="button" type="submit">Criar conta</button></form>' +
      '<div class="auth-links"><a href="#/login">Já tenho conta</a></div></div></div></section>';

    document
      .querySelector('#registerForm')
      .addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        try {
          await api('/auth/email/register', {
            method: 'POST',
            body: JSON.stringify({
              firstName: form.elements.namedItem('firstName').value,
              lastName: form.elements.namedItem('lastName').value,
              email: form.elements.namedItem('email').value,
              password: form.elements.namedItem('password').value,
            }),
          });
          notice('Conta criada. Confira seu e-mail para ativar o acesso.');
          form.reset();
        } catch (error) {
          notice(error.message, true);
        }
      });
  }

  function forgotView() {
    setNav(false);
    app.innerHTML =
      '<section class="auth-wrap"><div class="auth">' +
      '<div class="eyebrow">KRX / RECUPERAÇÃO</div><h1>Recupere o acesso.</h1>' +
      '<p class="muted">Enviaremos as instruções para o e-mail cadastrado.</p>' +
      '<div class="auth-card"><div id="notice" hidden></div><form id="forgotForm">' +
      '<label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" required>' +
      '<button class="button" type="submit">Enviar instruções</button></form>' +
      '<div class="auth-links"><a href="#/login">Voltar ao login</a></div></div></div></section>';
    document
      .querySelector('#forgotForm')
      .addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          await api('/auth/forgot/password', {
            method: 'POST',
            body: JSON.stringify({
              email: event.currentTarget.elements.namedItem('email').value,
            }),
          });
          notice(
            'Se o e-mail estiver cadastrado, as instruções serão enviadas.',
          );
        } catch (error) {
          notice(error.message, true);
        }
      });
  }

  async function initGoogle() {
    const slot = document.querySelector('#googleButton');
    if (!slot) return;
    if (!config.googleClientId) {
      slot.innerHTML =
        '<span class="muted">Login Google ainda não configurado no servidor.</span>';
      return;
    }
    const start = () => {
      if (!window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: async (response) => {
          try {
            const data = await api('/auth/google/login', {
              method: 'POST',
              body: JSON.stringify({ idToken: response.credential }),
            });
            saveSession(data);
            location.hash = authenticatedDestination();
            // hashchange renders the authenticated page.
          } catch (error) {
            notice(error.message, true);
          }
        },
      });
      window.google.accounts.id.renderButton(slot, {
        theme: 'filled_black',
        size: 'large',
        width: Math.min(400, slot.clientWidth || 400),
        text: 'continue_with',
      });
    };
    if (window.google?.accounts?.id) return start();
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = start;
    document.head.appendChild(script);
  }

  async function dashboardView() {
    setNav(true);
    app.innerHTML =
      '<section class="loading-shell" aria-live="polite"><span class="loading-indicator"></span><h1>Carregando sua conta</h1><p>Consultando saldo e consumo.</p></section>';
    try {
      const summary = await api('/usage/summary');
      const number = (value) => new Intl.NumberFormat('pt-BR').format(value);
      app.innerHTML =
        '<section class="hero"><div class="hero-copy"><div class="eyebrow">SEU WORKSPACE</div><h1>Olá, ' +
        esc(currentUser.firstName || 'dev') +
        '.</h1><p>Suas credenciais, movimentações e ferramentas de desenvolvimento, em um só lugar.</p></div><div class="actions"><a class="button alt" href="#/keys">Gerenciar chaves</a><a class="button" href="#/playground">Abrir playground →</a></div></section>' +
        '<section class="grid" aria-label="Resumo da conta"><article class="card metric"><span>Créditos disponíveis</span><strong>' +
        esc(number(summary.balance)) +
        '</strong><small>Saldo atual da sua conta</small></article><article class="card metric"><span>Requisições registradas</span><strong>' +
        esc(number(summary.totalRequests)) +
        '</strong><small>Histórico de consumo da API</small></article><article class="card metric"><span>Créditos consumidos</span><strong>' +
        esc(number(summary.totalSpent)) +
        '</strong><small>Total registrado no extrato</small></article></section>' +
        '<div class="section-heading"><h2>Continue no workspace</h2><a href="#/catalog">Ver endpoints →</a></div><section class="grid two"><article class="card"><span class="step-label">DESENVOLVIMENTO</span><h2>Explore o que já funciona</h2><p class="muted">Consulte os endpoints implementados e execute leituras com a sua sessão. O resultado exibido vem da API.</p><div class="actions"><a class="button alt" href="#/catalog">Consultar endpoints</a><a class="button alt" href="/docs" target="_blank" rel="noopener noreferrer">Referência Swagger ↗</a></div></article><article class="card"><span class="step-label">CONTA E FATURAMENTO</span><h2>Seu saldo, sem mistério</h2><p class="muted">Confira o extrato de créditos e acompanhe o status das suas compras. Pagamentos aguardam confirmação do provedor.</p><div class="actions"><a class="button alt" href="#/usage">Ver movimentações</a><a class="button alt" href="#/billing">Planos e pagamentos</a></div></article></section>' +
        '<section class="card"><div class="section-heading" style="margin-top:0"><h2>Sua conta</h2><a href="#/profile">Editar perfil →</a></div><p class="muted">' +
        esc(nameOf(currentUser)) +
        ' · ' +
        esc(currentUser.email || 'E-mail não informado') +
        '</p><span class="tag">' +
        (roleName(currentUser) === 'admin' ? 'Administrador' : 'Usuário') +
        '</span></section>' +
        '<div class="quick-links"><a href="#/keys">Credenciais de acesso</a><a href="#/profile">Perfil e segurança</a><a href="#/payments">Histórico de pagamentos</a></div>';
    } catch (error) {
      app.innerHTML =
        '<h1>Não foi possível carregar sua conta</h1><div class="notice error" role="alert">' +
        esc(error.message) +
        '</div><button class="button alt" id="retryDashboard">Tentar novamente</button>';
      document.querySelector('#retryDashboard').onclick = dashboardView;
    }
  }

  async function usersView() {
    setNav(true);
    if (roleName(currentUser) !== 'admin') {
      app.innerHTML =
        '<div class="eyebrow">KRX / ACESSO</div><h1>Sem permissão.</h1><p class="muted">Esta área é exclusiva para administradores.</p>';
      return;
    }
    app.innerHTML =
      '<div class="eyebrow">KRX / ADMIN</div><h1>Usuários.</h1><p class="muted">Carregando usuários...</p>';
    try {
      const result = await api('/users?page=1&limit=50');
      const rows = (result?.data || [])
        .map(
          (user) =>
            '<tr><td class="mono">#' +
            esc(user.id) +
            '</td><td><strong>' +
            esc(nameOf(user)) +
            '</strong><br><span class="muted">' +
            esc(user.email || '—') +
            '</span></td>' +
            '<td><span class="tag">' +
            esc(user.provider || '—') +
            '</span></td><td><span class="tag ' +
            (statusName(user) === 'active' ? 'green' : '') +
            '">' +
            esc(statusName(user)) +
            '</span></td>' +
            '<td><span class="tag">' +
            esc(roleName(user)) +
            '</span></td><td>' +
            esc(
              user.createdAt
                ? new Date(user.createdAt).toLocaleDateString('pt-BR')
                : '—',
            ) +
            '</td></tr>',
        )
        .join('');
      app.innerHTML =
        '<section class="hero"><div class="hero-copy"><div class="eyebrow">KRX / ADMIN</div><h1>Usuários.</h1><p>Primeiros ' +
        esc((result?.data || []).length) +
        ' registros da base.</p></div></section>' +
        '<div class="table-wrap"><table><thead><tr><th>ID</th><th>Usuário</th><th>Provedor</th><th>Status</th><th>Role</th><th>Criado</th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="6">Nenhum usuário encontrado.</td></tr>') +
        '</tbody></table></div>';
    } catch (error) {
      app.innerHTML +=
        '<div class="notice error">' + esc(error.message) + '</div>';
    }
  }

  function profileView() {
    setNav(true);
    app.innerHTML =
      '<section class="hero"><div class="hero-copy"><div class="eyebrow">KRX / PERFIL</div><h1>Minha conta.</h1><p>Atualize seus dados de perfil e senha.</p></div></section>' +
      '<div id="notice" hidden></div><section class="profile-grid"><form class="card" id="profileForm"><h2>Dados pessoais</h2>' +
      '<label for="firstName">Nome</label><input id="firstName" name="firstName" value="' +
      esc(currentUser.firstName || '') +
      '" required>' +
      '<label for="lastName">Sobrenome</label><input id="lastName" name="lastName" value="' +
      esc(currentUser.lastName || '') +
      '" required>' +
      '<button class="button" type="submit">Salvar alterações</button></form>' +
      '<form class="card" id="passwordForm"><h2>Alterar senha</h2><label for="oldPassword">Senha atual</label><input id="oldPassword" name="oldPassword" type="password" autocomplete="current-password" required>' +
      '<label for="password">Nova senha</label><input id="password" name="password" type="password" minlength="6" autocomplete="new-password" required>' +
      '<button class="button" type="submit">Trocar senha</button></form></section>';

    document
      .querySelector('#profileForm')
      .addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          currentUser = await api('/auth/me', {
            method: 'PATCH',
            body: JSON.stringify({
              firstName:
                event.currentTarget.elements.namedItem('firstName').value,
              lastName:
                event.currentTarget.elements.namedItem('lastName').value,
            }),
          });
          sessionStorage.setItem(keys.user, JSON.stringify(currentUser));
          notice('Perfil atualizado.');
        } catch (error) {
          notice(error.message, true);
        }
      });

    document
      .querySelector('#passwordForm')
      .addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector('button');
        button.disabled = true;
        try {
          await api('/auth/me', {
            method: 'PATCH',
            body: JSON.stringify({
              oldPassword: form.elements.namedItem('oldPassword').value,
              password: form.elements.namedItem('password').value,
            }),
          });
          form.reset();
          notice('Senha alterada. As outras sessões foram encerradas.');
        } catch (error) {
          notice(error.message, true);
        } finally {
          button.disabled = false;
        }
      });
  }

  async function keysView() {
    setNav(true);
    app.innerHTML =
      '<div class="eyebrow">KRX / CHAVES</div><h1>Chaves da API.</h1>' +
      '<p class="muted">Até cinco chaves ativas. A chave completa aparece uma única vez, ao criar.</p>' +
      '<div id="notice" role="status" hidden></div><form class="card" id="keyForm"><label for="keyName">Nome da chave</label>' +
      '<input id="keyName" name="keyName" maxlength="80" required placeholder="Meu bot"><button class="button">Criar chave</button></form>' +
      '<section class="card" id="newKey" hidden><h2>Salve sua chave</h2><p>Copie agora. Depois, somente o prefixo fica disponível.</p>' +
      '<label for="keyValue">Chave completa</label><textarea id="keyValue" readonly rows="3"></textarea><button class="button alt" id="copyKey" type="button">Copiar</button></section><div id="keyList"></div>';
    const load = async () => {
      const keys = await api('/keys');
      document.querySelector('#keyList').innerHTML =
        '<div class="table-wrap"><table><thead><tr><th>Nome</th><th>Chave</th><th>Status</th><th>Último uso</th><th>Ação</th></tr></thead><tbody>' +
        (keys
          .map(
            (key) =>
              '<tr><td>' +
              esc(key.name) +
              '</td><td class="mono">' +
              esc(key.maskedKey) +
              '</td><td>' +
              esc(key.status === 'active' ? 'Ativa' : 'Revogada') +
              '</td><td>' +
              esc(
                key.lastUsedAt
                  ? new Date(key.lastUsedAt).toLocaleString('pt-BR')
                  : 'Nunca',
              ) +
              '</td><td>' +
              (key.status === 'active'
                ? '<button class="button danger" type="button" data-revoke="' +
                  esc(key.id) +
                  '">Revogar</button>'
                : '—') +
              '</td></tr>',
          )
          .join('') || '<tr><td colspan="5">Nenhuma chave criada.</td></tr>') +
        '</tbody></table></div>';
    };
    document
      .querySelector('#keyForm')
      .addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector('button');
        button.disabled = true;
        try {
          const result = await api('/keys', {
            method: 'POST',
            body: JSON.stringify({
              name: form.elements.namedItem('keyName').value.trim(),
            }),
          });
          document.querySelector('#keyValue').value = result.key;
          document.querySelector('#newKey').hidden = false;
          form.reset();
          notice('Chave criada. Guarde a chave completa agora.');
          await load();
        } catch (error) {
          notice(error.message, true);
        } finally {
          button.disabled = false;
        }
      });
    document.querySelector('#copyKey').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(
          document.querySelector('#keyValue').value,
        );
        notice('Chave copiada.');
      } catch {
        document.querySelector('#keyValue').select();
        notice('Selecione e copie a chave manualmente.');
      }
    });
    document
      .querySelector('#keyList')
      .addEventListener('click', async (event) => {
        const button = event.target.closest('[data-revoke]');
        if (
          !button ||
          !window.confirm(
            'Revogar esta chave? Ela deixará de autenticar imediatamente.',
          )
        )
          return;
        button.disabled = true;
        try {
          await api('/keys/' + button.dataset.revoke, { method: 'DELETE' });
          await load();
          notice('Chave revogada.');
        } catch (error) {
          notice(error.message, true);
          button.disabled = false;
        }
      });
    try {
      await load();
    } catch (error) {
      notice(error.message, true);
    }
  }

  async function usageView(page = 1, ledger = false) {
    setNav(true);
    app.innerHTML =
      '<div class="eyebrow">KRX / CONSUMO</div><h1>Histórico.</h1><div id="notice" role="status" hidden></div>';
    try {
      const summary = await api('/usage/summary');
      const result = await api(
        '/usage/' +
          (ledger ? 'ledger' : 'recent') +
          '?page=' +
          page +
          '&limit=20',
      );
      app.innerHTML +=
        '<p>Saldo: <strong>' +
        esc(summary.balance) +
        '</strong> créditos. Consumo registrado: ' +
        esc(summary.totalSpent) +
        ' créditos.</p>' +
        '<p class="muted">As rotas de serviços serão adicionadas em uma próxima etapa. Ajustes administrativos aparecem em Movimentações.</p>' +
        '<div class="actions"><button class="button alt" id="usageTab">Requisições</button><button class="button alt" id="ledgerTab">Movimentações</button></div><div class="table-wrap"><table><thead><tr>' +
        (ledger
          ? '<th>Data</th><th>Motivo</th><th>Variação</th><th>Saldo após</th>'
          : '<th>Data</th><th>Rota</th><th>Status</th><th>Custo</th>') +
        '</tr></thead><tbody>' +
        (result.data
          .map(
            (row) =>
              '<tr><td>' +
              esc(new Date(row.createdAt).toLocaleString('pt-BR')) +
              '</td>' +
              (ledger
                ? '<td>' +
                  esc(row.reason) +
                  '</td><td>' +
                  esc(row.delta) +
                  '</td><td>' +
                  esc(row.balanceAfter) +
                  '</td>'
                : '<td>' +
                  esc(row.method + ' ' + row.route) +
                  '</td><td>' +
                  esc(row.status) +
                  '</td><td>' +
                  esc(row.cost) +
                  '</td>') +
              '</tr>',
          )
          .join('') || '<tr><td colspan="4">Nenhum registro ainda.</td></tr>') +
        '</tbody></table></div><div class="actions"><button class="button alt" id="previousPage" ' +
        (page === 1 ? 'disabled' : '') +
        '>Anterior</button><span>Página ' +
        page +
        '</span><button class="button alt" id="nextPage" ' +
        (!result.hasNextPage ? 'disabled' : '') +
        '>Próxima</button></div>';
      document.querySelector('#usageTab').onclick = () => usageView(1, false);
      document.querySelector('#ledgerTab').onclick = () => usageView(1, true);
      document.querySelector('#previousPage').onclick = () =>
        usageView(page - 1, ledger);
      document.querySelector('#nextPage').onclick = () =>
        usageView(page + 1, ledger);
    } catch (error) {
      notice(error.message, true);
    }
  }

  function creditsView() {
    setNav(true);
    if (roleName(currentUser) !== 'admin') {
      app.innerHTML = '<h1>Sem permissão.</h1>';
      return;
    }
    app.innerHTML =
      '<div class="eyebrow">KRX / ADMIN</div><h1>Ajustar créditos.</h1>' +
      '<p class="muted">Todo ajuste registra o administrador, motivo e saldo resultante.</p><div id="notice" role="status" hidden></div>' +
      '<form id="creditsForm" class="card"><label for="userId">ID do usuário (consulte a aba Usuários)</label><input id="userId" name="userId" type="number" min="1" step="1" required>' +
      '<label for="delta">Créditos: positivo adiciona, negativo retira</label><input id="delta" name="delta" type="number" step="1" min="-2147483647" max="2147483647" required>' +
      '<label for="reason">Motivo</label><input id="reason" name="reason" maxlength="240" required><button class="button">Registrar ajuste</button></form>';
    let requestId = crypto.randomUUID();
    let fingerprint = '';
    document
      .querySelector('#creditsForm')
      .addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector('button');
        const payload = {
          delta: Number(form.elements.namedItem('delta').value),
          reason: form.elements.namedItem('reason').value.trim(),
        };
        const currentFingerprint = JSON.stringify([
          form.elements.namedItem('userId').value,
          payload,
        ]);
        if (fingerprint && fingerprint !== currentFingerprint)
          requestId = crypto.randomUUID();
        fingerprint = currentFingerprint;
        button.disabled = true;
        try {
          const result = await api(
            '/admin/credits/' +
              Number(form.elements.namedItem('userId').value) +
              '/adjustments',
            { method: 'POST', body: JSON.stringify({ ...payload, requestId }) },
          );
          notice(
            'Ajuste registrado. Saldo resultante: ' +
              result.balanceAfter +
              ' créditos.',
          );
          requestId = crypto.randomUUID();
          fingerprint = '';
          form.reset();
        } catch (error) {
          notice(error.message, true);
        } finally {
          button.disabled = false;
        }
      });
  }

  function confirmationView(page, params) {
    setNav(false);
    app.innerHTML =
      '<section class="auth-wrap"><div class="auth"><div class="eyebrow">KRX / CONFIRMAÇÃO</div><h1>Confirme seu e-mail.</h1>' +
      '<div class="auth-card"><div id="notice" role="status" hidden></div><p>Conclua a confirmação para ativar seu acesso.</p><button class="button" id="confirmEmail" type="button">Confirmar e-mail</button><div class="auth-links"><a href="#/login">Voltar ao login</a></div></div></div></section>';
    const hash = params.get('hash');
    const button = document.querySelector('#confirmEmail');
    if (!hash) {
      button.disabled = true;
      notice('Link inválido: falta o código de confirmação.', true);
      return;
    }
    button.onclick = async () => {
      button.disabled = true;
      try {
        await api(
          page === '#/confirm-new-email'
            ? '/auth/email/confirm/new'
            : '/auth/email/confirm',
          { method: 'POST', body: JSON.stringify({ hash }) },
        );
        history.replaceState(null, '', location.pathname + '#/login');
        loginView();
        notice('E-mail confirmado. Você já pode entrar.');
      } catch (error) {
        notice(error.message, true);
        button.disabled = false;
      }
    };
  }

  function resetPasswordView(params) {
    setNav(false);
    app.innerHTML =
      '<section class="auth-wrap"><div class="auth"><div class="eyebrow">KRX / RECUPERAÇÃO</div><h1>Defina sua senha.</h1>' +
      '<div class="auth-card"><div id="notice" role="status" hidden></div><form id="resetForm"><label for="newPassword">Nova senha</label><input id="newPassword" name="newPassword" type="password" minlength="6" maxlength="128" autocomplete="new-password" required>' +
      '<label for="repeatPassword">Repita a senha</label><input id="repeatPassword" name="repeatPassword" type="password" minlength="6" maxlength="128" autocomplete="new-password" required><button class="button">Salvar nova senha</button></form>' +
      '<div class="auth-links"><a href="#/forgot">Pedir outro link</a><a href="#/login">Login</a></div></div></div></section>';
    const hash = params.get('hash');
    if (!hash) {
      document.querySelector('#resetForm button').disabled = true;
      notice('Link inválido: falta o código de recuperação.', true);
      return;
    }
    document
      .querySelector('#resetForm')
      .addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        if (
          form.elements.namedItem('newPassword').value !==
          form.elements.namedItem('repeatPassword').value
        )
          return notice('As senhas não coincidem.', true);
        const button = form.querySelector('button');
        button.disabled = true;
        try {
          await api('/auth/reset/password', {
            method: 'POST',
            body: JSON.stringify({
              hash,
              password: form.elements.namedItem('newPassword').value,
            }),
          });
          history.replaceState(null, '', location.pathname + '#/login');
          loginView();
          notice('Senha redefinida. Entre com a nova senha.');
        } catch (error) {
          notice(error.message, true);
          button.disabled = false;
        }
      });
  }

  const paymentLabels = {
    creating: 'Preparando checkout',
    checkout_error: 'Checkout indisponível',
    pending: 'Pendente',
    in_process: 'Em análise',
    authorized: 'Autorizado',
    approved: 'Aprovado',
    rejected: 'Recusado',
    cancelled: 'Cancelado',
    refunded: 'Reembolsado',
    charged_back: 'Contestação',
    review_required: 'Revisão necessária',
    review_resolved: 'Revisão encerrada',
  };
  const money = (cents) =>
    new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(cents / 100);
  const billingDate = (value) =>
    value ? new Date(value).toLocaleString('pt-BR') : '—';
  function safeCheckout(url) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'https:' ||
      !/(^|\.)mercadopago\.(com|com\.br)$/.test(parsed.hostname)
    )
      throw new Error('Link de pagamento inválido.');
    return parsed.href;
  }
  function billingError(error) {
    notice(error.message, true);
  }
  async function billingView() {
    setNav(true);
    app.innerHTML =
      '<div class="eyebrow">KRX / PLANOS</div><h1>Planos e pagamentos.</h1><div id="notice" hidden></div><p>Carregando...</p>';
    try {
      const [catalog, subscription, recent] = await Promise.all([
        api('/billing/plans'),
        api('/billing/subscription'),
        api('/billing/payments?page=1&limit=100'),
      ]);
      const latestPlans = new Set();
      recent.data.forEach((p) => {
        if (latestPlans.has(p.planId)) return;
        latestPlans.add(p.planId);
        if (p.creditedAt)
          sessionStorage.removeItem(
            'krx.checkout.' + currentUser.id + '.' + p.planId,
          );
      });
      const status = {
        active: 'Ativo',
        expired: 'Expirado',
        free: 'Gratuito',
        review_required: 'Pagamento em revisão',
      }[subscription.status];
      app.innerHTML =
        '<div class="eyebrow">KRX / PLANOS</div><h1>Planos e pagamentos.</h1><div id="notice" hidden></div>' +
        '<article class="card"><h2>' +
        esc(
          subscription.status === 'active' ? subscription.plan.name : status,
        ) +
        '</h2><p class="muted">' +
        esc(status) +
        (subscription.expiresAt
          ? ' · Validade: ' + esc(billingDate(subscription.expiresAt))
          : '') +
        '</p><a class="button alt" href="#/payments">Histórico de pagamentos</a></article>' +
        '<p class="muted">Compra avulsa, sem renovação automática. Os créditos entram após a confirmação do pagamento.</p>' +
        (!catalog.payments.enabled
          ? '<p class="notice">Pagamentos ainda não configurados.</p>'
          : catalog.payments.sandbox
            ? '<p class="notice">Ambiente de testes. Não use pagamentos reais.</p>'
            : '') +
        '<section class="grid">' +
        catalog.plans
          .map(
            (plan) =>
              '<article class="card"><h2>' +
              esc(plan.name) +
              '</h2><p>' +
              esc(plan.description) +
              '</p><strong>' +
              esc(money(plan.priceCents)) +
              '</strong><p class="muted">' +
              esc(plan.creditsPerCycle.toLocaleString('pt-BR')) +
              ' créditos · ' +
              esc(plan.billingPeriodDays) +
              ' dias<br>' +
              esc(plan.maxActiveKeys) +
              ' chaves ativas</p><button class="button" data-checkout="' +
              esc(plan.id) +
              '" ' +
              (!catalog.payments.enabled ||
              subscription.status === 'review_required'
                ? 'disabled'
                : '') +
              '>Comprar ' +
              esc(plan.name) +
              '</button><button class="button alt" data-new-checkout="' +
              esc(plan.id) +
              '" ' +
              (!catalog.payments.enabled ||
              subscription.status === 'review_required'
                ? 'disabled'
                : '') +
              '>Preparar outra compra</button><div class="checkout-link"></div></article>',
          )
          .join('') +
        '</section>' +
        (!catalog.plans.length
          ? '<p class="muted">Nenhum plano disponível no momento.</p>'
          : '');
      document.querySelectorAll('[data-new-checkout]').forEach(
        (button) =>
          (button.onclick = () => {
            if (
              !confirm(
                'Consulte seu histórico antes: outra compra gera um checkout separado. Continuar?',
              )
            )
              return;
            sessionStorage.removeItem(
              'krx.checkout.' +
                currentUser.id +
                '.' +
                button.dataset.newCheckout,
            );
            const checkoutButton =
              button.parentElement.querySelector('[data-checkout]');
            checkoutButton.disabled = false;
            checkoutButton.textContent = 'Comprar';
            button.parentElement.querySelector('.checkout-link').innerHTML = '';
            notice(
              'Nova compra preparada. Clique em Comprar para abrir outro checkout.',
            );
          }),
      );
      document.querySelectorAll('[data-checkout]').forEach((button) =>
        button.addEventListener('click', async () => {
          button.disabled = true;
          const planId = button.dataset.checkout;
          const storageKey = 'krx.checkout.' + currentUser.id + '.' + planId;
          const requestId =
            sessionStorage.getItem(storageKey) || crypto.randomUUID();
          sessionStorage.setItem(storageKey, requestId);
          try {
            const payment = await api('/billing/checkout', {
              method: 'POST',
              body: JSON.stringify({ planId, requestId }),
            });
            const url = safeCheckout(payment.checkoutUrl);
            button.parentElement.querySelector('.checkout-link').innerHTML =
              '<p><a class="button" href="' +
              esc(url) +
              '" target="_blank" rel="noopener noreferrer">Abrir Mercado Pago ↗</a></p><p class="muted">Após pagar, consulte o histórico para confirmar o status.</p>';
            button.textContent = 'Checkout preparado';
            notice('Checkout preparado. Continue no Mercado Pago.');
          } catch (error) {
            billingError(error);
            button.disabled = false;
          }
        }),
      );
    } catch (error) {
      billingError(error);
    }
  }
  async function paymentsView(page = 1, admin = false) {
    setNav(true);
    if (admin && roleName(currentUser) !== 'admin') {
      app.innerHTML = '<h1>Sem permissão.</h1>';
      return;
    }
    app.innerHTML =
      '<div class="eyebrow">KRX / ' +
      (admin ? 'ADMIN' : 'PAGAMENTOS') +
      '</div><h1>Histórico de pagamentos.</h1><div id="notice" hidden></div>';
    try {
      const prefix = admin ? '/admin/billing' : '/billing';
      const result = await api(prefix + '/payments?page=' + page + '&limit=20');
      app.insertAdjacentHTML(
        'beforeend',
        '<div class="actions"><a class="button alt" href="' +
          (admin ? '#/billing-admin' : '#/billing') +
          '">Voltar aos planos</a></div><div class="table-wrap"><table><thead><tr><th>Compra</th>' +
          (admin ? '<th>Usuário</th>' : '') +
          '<th>Plano</th><th>Valor</th><th>Status</th><th>Data</th><th>Ações</th></tr></thead><tbody>' +
          result.data
            .map(
              (p) =>
                '<tr><td><code>' +
                esc(p.id) +
                '</code></td>' +
                (admin ? '<td>' + esc(p.userId) + '</td>' : '') +
                '<td>' +
                esc(p.planName) +
                '</td><td>' +
                esc(money(p.amountCents)) +
                '</td><td>' +
                esc(paymentLabels[p.status] || p.status) +
                '</td><td>' +
                esc(billingDate(p.createdAt)) +
                '</td><td><button class="button alt" data-reconcile="' +
                esc(p.id) +
                '">Verificar</button>' +
                (p.checkoutUrl && p.status === 'pending'
                  ? '<a class="button alt" href="' +
                    esc(safeCheckout(p.checkoutUrl)) +
                    '" target="_blank" rel="noopener noreferrer">Pagar ↗</a>'
                  : '') +
                '</td></tr>',
            )
            .join('') +
          '</tbody></table></div>' +
          (!result.data.length
            ? '<p class="muted">Nenhum pagamento registrado.</p>'
            : '') +
          '<div class="actions"><button class="button alt" id="billingPrevious" ' +
          (page === 1 ? 'disabled' : '') +
          '>Anterior</button><span>Página ' +
          page +
          '</span><button class="button alt" id="billingNext" ' +
          (!result.hasNextPage ? 'disabled' : '') +
          '>Próxima</button></div><div id="reconcileArea"></div>',
      );
      document.querySelector('#billingPrevious').onclick = () =>
        paymentsView(page - 1, admin);
      document.querySelector('#billingNext').onclick = () =>
        paymentsView(page + 1, admin);
      document.querySelectorAll('[data-reconcile]').forEach(
        (button) =>
          (button.onclick = () => {
            const payment = result.data.find(
              (p) => p.id === button.dataset.reconcile,
            );
            document.querySelector('#reconcileArea').innerHTML =
              '<article class="card"><h2>Verificar pagamento</h2><p class="muted">Informe o número do pagamento no comprovante do Mercado Pago. A KRX consultará o provedor.</p><form id="reconcileForm"><label for="providerPaymentId">Número do pagamento</label><input id="providerPaymentId" name="providerPaymentId" inputmode="numeric" pattern="[0-9]{1,30}" maxlength="30" value="' +
              esc(payment.providerPaymentId || '') +
              '" required><button class="button">Consultar</button></form></article>';
            document.querySelector('#reconcileForm').onsubmit = async (
              event,
            ) => {
              event.preventDefault();
              const form = event.currentTarget;
              const submit = form.querySelector('button');
              submit.disabled = true;
              try {
                await api(prefix + '/payments/' + payment.id + '/reconcile', {
                  method: 'POST',
                  body: JSON.stringify({
                    providerPaymentId: form.elements.providerPaymentId.value,
                  }),
                });
                await paymentsView(page, admin);
                notice('Status atualizado após consulta ao Mercado Pago.');
              } catch (error) {
                billingError(error);
                submit.disabled = false;
              }
            };
          }),
      );
    } catch (error) {
      billingError(error);
    }
  }
  async function billingAdminView() {
    setNav(true);
    if (roleName(currentUser) !== 'admin') {
      app.innerHTML = '<h1>Sem permissão.</h1>';
      return;
    }
    app.innerHTML =
      '<div class="eyebrow">KRX / ADMIN</div><h1>Administrar planos.</h1><div id="notice" hidden></div>';
    try {
      const plans = await api('/admin/billing/plans');
      app.insertAdjacentHTML(
        'beforeend',
        '<div class="actions"><a class="button alt" href="#/billing-payments">Todos os pagamentos</a><button class="button" id="newPlan">Novo plano</button></div><section class="grid">' +
          plans
            .map(
              (p) =>
                '<article class="card"><h2>' +
                esc(p.name) +
                '</h2><p>' +
                esc(money(p.priceCents)) +
                ' · ' +
                (p.active ? 'Ativo' : 'Desativado') +
                ' · ' +
                (p.public ? 'Público' : 'Privado') +
                '</p><button class="button alt" data-edit-plan="' +
                esc(p.id) +
                '">Editar</button></article>',
            )
            .join('') +
          '</section><div id="planEditor"></div><article class="card"><h2>Encerrar revisão de pagamento</h2><p class="muted">Revise o estorno e ajuste os créditos na área Créditos antes de encerrar. O encerramento libera a conta com acesso gratuito.</p><form id="reviewForm"><label for="reviewUser">ID do usuário</label><input id="reviewUser" name="userId" type="number" min="1" required><label for="reviewReason">Motivo e providências</label><input id="reviewReason" name="reason" maxlength="240" required><button class="button">Encerrar revisão</button></form></article>',
      );
      const numberFields = [
        ['priceCents', 'Preço em centavos', 100, 100000000],
        ['creditsPerCycle', 'Créditos por compra', 1, 100000000],
        ['billingPeriodDays', 'Validade em dias', 1, 366],
        ['maxActiveKeys', 'Máximo de chaves ativas', 1, 100],
      ];
      const boolFields = [
        ['active', 'Ativo'],
        ['public', 'Visível no catálogo'],
      ];
      const edit = (
        p = {
          id: '',
          name: '',
          description: '',
          priceCents: 1290,
          creditsPerCycle: 100000,
          billingPeriodDays: 30,
          maxActiveKeys: 5,
          apiRateLimit: 30,
          normal: true,
          freefire: false,
          consultas: false,
          active: false,
          public: false,
        },
      ) => {
        document.querySelector('#planEditor').innerHTML =
          '<article class="card"><h2>Editar plano</h2><p class="muted">Mudanças valem para novas compras. Compras anteriores mantêm suas condições originais.</p><form id="planForm"><label for="planId">Identificador</label><input id="planId" name="id" pattern="[a-z][a-z0-9-]{1,39}" value="' +
          esc(p.id) +
          '" ' +
          (p.id ? 'readonly' : '') +
          ' required><label for="planName">Nome</label><input id="planName" name="name" maxlength="80" value="' +
          esc(p.name) +
          '" required><label for="planDescription">Descrição</label><input id="planDescription" name="description" maxlength="400" value="' +
          esc(p.description) +
          '">' +
          numberFields
            .map(
              ([field, label, min, max]) =>
                '<label for="plan-' +
                field +
                '">' +
                label +
                '</label><input id="plan-' +
                field +
                '" name="' +
                field +
                '" type="number" min="' +
                min +
                '" max="' +
                max +
                '" step="1" value="' +
                esc(p[field]) +
                '" required>',
            )
            .join('') +
          boolFields
            .map(
              ([field, label]) =>
                '<label class="check-field"><input type="checkbox" name="' +
                field +
                '" ' +
                (p[field] ? 'checked' : '') +
                '> ' +
                label +
                '</label>',
            )
            .join('') +
          '<button class="button">Salvar plano</button></form></article>';
        document.querySelector('#planForm').onsubmit = async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const button = form.querySelector('button');
          button.disabled = true;
          const dto = {
            id: form.elements.id.value,
            name: form.elements.name.value,
            description: form.elements.description.value,
            apiRateLimit: p.apiRateLimit,
            normal: p.normal,
            freefire: p.freefire,
            consultas: p.consultas,
          };
          numberFields.forEach(
            ([f]) => (dto[f] = Number(form.elements[f].value)),
          );
          boolFields.forEach(([f]) => (dto[f] = form.elements[f].checked));
          try {
            await api('/admin/billing/plans', {
              method: 'POST',
              body: JSON.stringify(dto),
            });
            await billingAdminView();
            notice(
              'Plano salvo. Compras anteriores mantêm as condições originais.',
            );
          } catch (error) {
            billingError(error);
            button.disabled = false;
          }
        };
      };
      document.querySelector('#newPlan').onclick = () => edit();
      document
        .querySelectorAll('[data-edit-plan]')
        .forEach(
          (b) =>
            (b.onclick = () =>
              edit(plans.find((p) => p.id === b.dataset.editPlan))),
        );
      document.querySelector('#reviewForm').onsubmit = async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector('button');
        button.disabled = true;
        const reason = form.elements.reason.value.trim();
        if (!reason) {
          notice('Informe o motivo da revisão.', true);
          button.disabled = false;
          return;
        }
        if (!confirm('Encerrar a revisão e expirar o plano deste usuário?')) {
          button.disabled = false;
          return;
        }
        try {
          await api(
            '/admin/billing/reviews/' +
              Number(form.elements.userId.value) +
              '/resolve',
            { method: 'POST', body: JSON.stringify({ reason }) },
          );
          notice('Revisão encerrada. A conta volta ao acesso gratuito.');
          form.reset();
        } catch (error) {
          billingError(error);
        } finally {
          button.disabled = false;
        }
      };
    } catch (error) {
      billingError(error);
    }
  }

  const readablePaths = new Set([
    '/api/v1/auth/me',
    '/api/v1/keys',
    '/api/v1/usage/summary',
    '/api/v1/usage/recent',
    '/api/v1/usage/ledger',
    '/api/v1/billing/plans',
    '/api/v1/billing/subscription',
    '/api/v1/billing/payments',
  ]);
  const authLabel = {
    none: 'Pública',
    session: 'Sessão JWT',
    apiKey: 'Chave de API',
  };
  async function loadCatalog() {
    const response = await api(
      roleName(currentUser) === 'admin' ? '/admin/catalog' : '/catalog',
    );
    const categories = response.data.categories
      .map((c) => ({
        ...c,
        routes: c.routes.filter(
          (r) =>
            r.source === 'current' &&
            r.executable === true &&
            r.method === 'GET' &&
            readablePaths.has(r.path),
        ),
      }))
      .filter((c) => c.routes.length);
    return {
      ...response.data,
      categories,
      routeCount: categories.reduce((n, c) => n + c.routes.length, 0),
    };
  }
  const searchText = (value) =>
    String(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  async function catalogView() {
    setNav(true);
    app.innerHTML =
      '<div class="eyebrow">DESENVOLVIMENTO</div><h1>Endpoints disponíveis</h1><p class="muted">Leituras implementadas e disponíveis no playground. A referência completa da API está no Swagger.</p><div id="notice" role="status" hidden></div>';
    try {
      const catalog = await loadCatalog();
      app.insertAdjacentHTML(
        'beforeend',
        '<section class="card endpoint-toolbar"><div><label for="catalogSearch">Buscar endpoint</label><input id="catalogSearch" type="search" placeholder="Nome, caminho ou descrição..."></div><div><label for="catalogCategory">Categoria</label><select id="catalogCategory"><option value="">Todas as categorias</option>' +
          catalog.categories
            .map(
              (c) =>
                '<option value="' +
                esc(c.id) +
                '">' +
                esc(c.name) +
                '</option>',
            )
            .join('') +
          '</select></div></section><div class="section-heading"><span id="catalogCount" class="muted"></span><a href="/docs" target="_blank" rel="noopener noreferrer">Abrir Swagger ↗</a></div><div id="catalogResults"></div>',
      );
      const render = () => {
        const query = searchText(
          document.querySelector('#catalogSearch').value,
        );
        const category = document.querySelector('#catalogCategory').value;
        const visible = catalog.categories
          .filter((c) => !category || c.id === category)
          .map((c) => ({
            ...c,
            routes: c.routes.filter((r) =>
              searchText(
                r.name + ' ' + r.path + ' ' + r.description + ' ' + c.name,
              ).includes(query),
            ),
          }))
          .filter((c) => c.routes.length);
        const count = visible.reduce((n, c) => n + c.routes.length, 0);
        document.querySelector('#catalogCount').textContent =
          count + ' endpoint(s) encontrado(s)';
        document.querySelector('#catalogResults').innerHTML =
          visible
            .map(
              (c) =>
                '<section class="catalog-group"><h2>' +
                esc(c.name) +
                '</h2><p class="muted">' +
                esc(c.description) +
                '</p><div class="table-wrap">' +
                c.routes
                  .map(
                    (r) =>
                      '<article class="endpoint-row"><span class="method-badge">' +
                      esc(r.method) +
                      '</span><div><h3>' +
                      esc(r.name) +
                      '</h3><code>' +
                      esc(r.path) +
                      '</code><p>' +
                      esc(r.description) +
                      '</p></div><div class="endpoint-meta"><span>' +
                      esc(authLabel[r.auth]) +
                      '</span><a class="button alt" href="#/playground?route=' +
                      encodeURIComponent(r.id) +
                      '">Testar →</a></div></article>',
                  )
                  .join('') +
                '</div></section>',
            )
            .join('') ||
          '<div class="empty-state"><strong>Nenhum endpoint encontrado</strong><p>Tente outro termo ou selecione todas as categorias.</p></div>';
      };
      document
        .querySelector('#catalogSearch')
        .addEventListener('input', render);
      document
        .querySelector('#catalogCategory')
        .addEventListener('change', render);
      render();
    } catch (error) {
      notice(error.message, true);
    }
  }

  async function playgroundView(params) {
    setNav(true);
    app.innerHTML =
      '<div class="eyebrow">DESENVOLVIMENTO</div><h1>Playground</h1><p class="muted">Execute uma leitura real e inspecione o resultado. Nenhuma chamada é feita antes de clicar em Executar.</p><div id="notice" role="status" hidden></div>';
    try {
      const catalog = await loadCatalog();
      const routes = catalog.categories.flatMap((c) =>
        c.routes.map((r) => ({ ...r, categoryName: c.name })),
      );
      const selected = params.get('route') || 'current-usage';
      const route = routes.find((r) => r.id === selected);
      if (!route) {
        notice(
          'Endpoint não encontrado. Ele pode ter sido removido. Consulte a lista de endpoints disponíveis.',
          true,
        );
        return;
      }
      const helpers = window.KrxPlayground;
      const canRun =
        route.source === 'current' &&
        route.executable === true &&
        route.method === 'GET' &&
        readablePaths.has(route.path);
      app.insertAdjacentHTML(
        'beforeend',
        '<section class="card"><label for="playgroundRoute">Endpoint</label><select id="playgroundRoute">' +
          catalog.categories
            .map(
              (c) =>
                '<optgroup label="' +
                esc(c.name) +
                '">' +
                c.routes
                  .map(
                    (r) =>
                      '<option value="' +
                      esc(r.id) +
                      '" ' +
                      (r.id === selected ? 'selected' : '') +
                      '>' +
                      esc(r.method + ' ' + r.name) +
                      '</option>',
                  )
                  .join('') +
                '</optgroup>',
            )
            .join('') +
          '</select><h2>' +
          esc(route.name) +
          '</h2><code>' +
          esc(route.method + ' ' + route.path) +
          '</code><p>' +
          esc(route.description) +
          '</p><p class="muted">' +
          esc(authLabel[route.auth]) +
          ' · ' +
          esc(route.credits) +
          ' crédito(s)' +
          (canRun ? ' · Leitura disponível' : ' · Execução indisponível') +
          '</p>' +
          (!canRun
            ? '<p class="notice">Este endpoint não está disponível para execução. Escolha outro endpoint.</p>'
            : '<p class="notice">Usa a sessão desta conta. Os exemplos copiados contêm apenas placeholders de credenciais.</p>') +
          '</section><section class="grid two"><article class="card"><h2>Requisição</h2><form id="playgroundForm">' +
          (route.parameters || [])
            .map(
              (p, i) =>
                '<label for="requestParam' +
                i +
                '">' +
                esc(p.name) +
                (p.required ? ' *' : '') +
                ' (' +
                esc(p.in) +
                ')</label><input id="requestParam' +
                i +
                '" data-parameter="' +
                esc(p.name) +
                '" type="text" value="' +
                esc(p.example === undefined ? '' : p.example) +
                '" ' +
                (p.required ? 'required' : '') +
                '><p class="muted">' +
                esc(p.description) +
                '</p>',
            )
            .join('') +
          (route.body
            ? route.body.format === 'multipart'
              ? '<p class="muted">Multipart: exemplo com avatar.png no campo file. O upload será liberado na migração.</p>'
              : '<label for="requestBody">Corpo JSON</label><textarea id="requestBody" rows="8" spellcheck="false">' +
                esc(helpers.bodyDefault(route) || '{}') +
                '</textarea>'
            : '<p class="muted">Sem corpo de requisição.</p>') +
          '<div class="actions"><button class="button alt" type="button" id="buildSamples">Atualizar exemplos</button><button class="button" id="executeRequest" ' +
          (!canRun ? 'disabled' : '') +
          '>Executar leitura</button><button class="button alt" type="button" id="cancelRequest" hidden>Cancelar</button></div></form><h3>URL</h3><code id="requestUrl"></code></article><article class="card"><h2>Exemplos de código</h2><label for="sampleLanguage">Linguagem</label><select id="sampleLanguage"><option value="curl">cURL</option><option value="javascript">JavaScript</option><option value="typescript">TypeScript</option><option value="python">Python</option></select><pre class="code-panel"><code id="codeSample"></code></pre><button class="button alt" id="copySample">Copiar exemplo</button><h3>Resultado da execução</h3><p id="executionStatus" class="muted">Nenhuma requisição executada.</p><pre class="code-panel"><code id="executionOutput"></code></pre></article></section><article class="card"><h2>Documentação da resposta' +
          (route.source === 'legacy' ? ' do legado' : '') +
          '</h2><p class="muted">' +
          esc(
            route.documentation?.responseNote ||
              'Formato documentado. Exemplos não são resultados de execução.',
          ) +
          '</p><ul>' +
          (route.documentation?.fields || [])
            .map(
              (f) =>
                '<li><code>' +
                esc(f.name) +
                '</code> — ' +
                esc(f.description) +
                '</li>',
            )
            .join('') +
          '</ul>' +
          (route.documentation?.notes || [])
            .map((n) => '<p class="muted">' + esc(n) + '</p>')
            .join('') +
          '<pre class="code-panel"><code>' +
          esc(
            JSON.stringify(
              route.documentation?.responseSchema || route.responses || [],
              null,
              2,
            ),
          ) +
          '</code></pre><h3>Erros documentados</h3>' +
          (route.errors || [])
            .map(
              (e) =>
                '<p><code>' +
                esc(e.status + ' ' + (e.code || '')) +
                '</code> ' +
                esc(e.description) +
                '</p>',
            )
            .join('') +
          '</article>',
      );
      document.querySelector('#playgroundRoute').onchange = (event) =>
        (location.hash =
          '#/playground?route=' + encodeURIComponent(event.target.value));
      let samples;
      let resolved;
      let pending;
      let controller;
      const update = () => {
        const values = Object.fromEntries(
          [...document.querySelectorAll('[data-parameter]')].map((input) => [
            input.dataset.parameter,
            input.value,
          ]),
        );
        const bodyText = document.querySelector('#requestBody')?.value || '';
        helpers.validateRequest(route, values, bodyText);
        resolved = helpers.resolvedPath(route, values);
        samples = helpers.buildCodeSamples(route, {
          baseUrl: location.origin,
          parameters: values,
          bodyText,
        });
        document.querySelector('#requestUrl').textContent =
          location.origin + resolved;
        document.querySelector('#codeSample').textContent =
          samples[document.querySelector('#sampleLanguage').value];
      };
      const safeUpdate = () => {
        try {
          update();
        } catch (error) {
          notice(error.message, true);
        }
      };
      document.querySelector('#buildSamples').onclick = safeUpdate;
      document.querySelector('#sampleLanguage').onchange = safeUpdate;
      document.querySelector('#copySample').onclick = async () => {
        try {
          update();
          await navigator.clipboard.writeText(
            document.querySelector('#codeSample').textContent,
          );
          notice('Exemplo copiado.');
        } catch (error) {
          notice(
            error.message ||
              'Não foi possível copiar. Selecione o código e copie manualmente.',
            true,
          );
        }
      };
      const cancel = () => controller?.abort();
      document.querySelector('#cancelRequest').onclick = cancel;
      window.addEventListener('hashchange', cancel, { once: true });
      document.querySelector('#playgroundForm').onsubmit = async (event) => {
        event.preventDefault();
        if (!canRun || pending) return;
        try {
          update();
        } catch (error) {
          notice(error.message, true);
          return;
        }
        const target = new URL(resolved, location.origin);
        if (
          target.origin !== location.origin ||
          !readablePaths.has(target.pathname)
        ) {
          notice('Destino inválido.', true);
          return;
        }
        const execute = document.querySelector('#executeRequest');
        const status = document.querySelector('#executionStatus');
        const output = document.querySelector('#executionOutput');
        const cancelButton = document.querySelector('#cancelRequest');
        pending = true;
        controller = new AbortController();
        execute.disabled = true;
        cancelButton.hidden = false;
        output.textContent = '';
        status.textContent = 'Consultando...';
        const timer = setTimeout(() => controller.abort(), 30000);
        const start = performance.now();
        try {
          const headers = { Accept: 'application/json' };
          if (route.auth === 'session') {
            const token = sessionStorage.getItem(keys.token);
            if (!token) throw new Error('Sua sessão expirou. Entre novamente.');
            headers.Authorization = 'Bearer ' + token;
          }
          const response = await fetch(target.href, {
            method: 'GET',
            headers,
            signal: controller.signal,
            redirect: 'error',
            cache: 'no-store',
          });
          const reader = response.body?.getReader();
          let size = 0;
          const chunks = [];
          if (!reader) throw new Error('Resposta vazia.');
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 1048576) {
              await reader.cancel();
              throw new Error(
                'Resposta excede 1 MiB. Reduza os parâmetros de paginação.',
              );
            }
            chunks.push(value);
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          chunks.forEach((chunk) => {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          });
          const text = new TextDecoder().decode(bytes);
          let payload;
          try {
            payload = JSON.parse(text);
          } catch {
            payload = text;
          }
          output.textContent =
            typeof payload === 'string'
              ? payload
              : JSON.stringify(payload, null, 2);
          status.textContent =
            'HTTP ' +
            response.status +
            ' · ' +
            Math.round(performance.now() - start) +
            ' ms · ' +
            size +
            ' bytes';
          if (!response.ok || payload?.success === false)
            notice(
              'A API retornou um erro. Confira o resultado da execução.',
              true,
            );
        } catch (error) {
          status.textContent =
            error.name === 'AbortError'
              ? 'Requisição cancelada ou tempo limite atingido.'
              : error.message;
        } finally {
          clearTimeout(timer);
          pending = false;
          execute.disabled = false;
          cancelButton.hidden = true;
        }
      };
      safeUpdate();
    } catch (error) {
      notice(error.message, true);
    }
  }

  function supportPath(admin) {
    return admin ? '/admin/support' : '/support';
  }
  function supportHash(admin) {
    return admin ? '#/support-admin' : '#/support';
  }
  function supportStatus(status) {
    return status === 'closed' ? 'Encerrado' : 'Aberto';
  }
  async function supportView(params, admin = false) {
    if (admin && roleName(currentUser) !== 'admin') {
      location.hash = '#/';
      return;
    }
    setNav(true);
    const id = params.get('ticket');
    if (id) return ticketView(id, admin);
    const page = Math.max(1, Number(params.get('page')) || 1);
    app.innerHTML =
      '<div class="loading-shell" role="status">Carregando chamados…</div>';
    try {
      const result = await api(
        supportPath(admin) + '?page=' + page + '&limit=20',
      );
      app.innerHTML = `<div class="page-header"><div><p class="eyebrow">${admin ? 'Administração' : 'Atendimento'}</p><h1>${admin ? 'Central de chamados' : 'Suporte'}</h1><p class="muted">${admin ? 'Leia o contexto, responda e acompanhe cada solicitação.' : 'Converse com a equipe e acompanhe suas solicitações.'}</p></div><span class="tag">${result.total} chamados</span></div><div id="notice" role="status"></div>
      ${!admin ? `<section class="card"><h2>Novo chamado</h2><form id="ticketForm"><label>Assunto<input name="subject" maxlength="120" required placeholder="Como podemos ajudar?"></label><label>Mensagem<textarea name="body" maxlength="4000" rows="5" required placeholder="Descreva o problema e o que você já tentou. Não envie senhas ou chaves de API."></textarea></label><div class="actions"><button class="button" type="submit">Abrir chamado</button><span class="muted">Até 4.000 caracteres. Atendimento por texto.</span></div></form></section>` : ''}
      <section class="card"><h2>${admin ? 'Fila de atendimento' : 'Seus chamados'}</h2>${result.data.length ? `<div class="ticket-list">${result.data.map((t) => `<a class="ticket-row" href="${supportHash(admin)}?ticket=${esc(t.id)}"><div><strong>${esc(t.subject)}</strong><p class="muted">${admin ? 'Conta #' + esc(t.userId) + ' · ' : ''}Atualizado em ${esc(new Date(t.updatedAt).toLocaleString('pt-BR'))}</p></div><span class="tag ${t.status === 'open' ? 'green' : ''}">${supportStatus(t.status)}</span></a>`).join('')}</div>` : '<div class="empty-state"><h3>Nenhum chamado por aqui</h3><p>As solicitações aparecerão aqui quando forem abertas.</p></div>'}<div class="actions">${page > 1 ? `<a class="button alt" href="${supportHash(admin)}?page=${page - 1}">Anterior</a>` : ''}${page * 20 < result.total ? `<a class="button alt" href="${supportHash(admin)}?page=${page + 1}">Próxima</a>` : ''}</div></section>`;
      const form = document.querySelector('#ticketForm');
      if (form) {
        let requestId = crypto.randomUUID();
        let attempt = null;
        form.onsubmit = async (event) => {
          event.preventDefault();
          const button = form.querySelector('button');
          const fields = new FormData(form);
          const payload = {
            subject: fields.get('subject').trim(),
            body: fields.get('body').trim(),
          };
          const fingerprint = JSON.stringify(payload);
          if (attempt && attempt !== fingerprint)
            requestId = crypto.randomUUID();
          attempt = fingerprint;
          button.disabled = true;
          try {
            const t = await api('/support', {
              method: 'POST',
              body: JSON.stringify({ ...payload, requestId }),
            });
            location.hash = '#/support?ticket=' + t.id;
          } catch (error) {
            notice(error.message, true);
            button.disabled = false;
          }
        };
      }
    } catch (error) {
      app.innerHTML = '<h1>Suporte</h1><div id="notice" role="status"></div>';
      notice(error.message, true);
    }
  }
  async function ticketView(id, admin) {
    try {
      const ticket = await api(
        supportPath(admin) + '/' + encodeURIComponent(id),
      );
      app.innerHTML = `<div class="page-header"><div><a class="muted" href="${supportHash(admin)}">← Todos os chamados</a><h1>${esc(ticket.subject)}</h1><p class="muted">Chamado ${esc(ticket.id)}${admin ? ' · Conta #' + esc(ticket.userId) : ''}</p></div><span class="tag ${ticket.status === 'open' ? 'green' : ''}">${supportStatus(ticket.status)}</span></div><div id="notice" role="status"></div><section class="card"><div class="actions"><button id="ticketStatus" class="button alt">${ticket.status === 'open' ? 'Encerrar chamado' : 'Reabrir chamado'}</button></div><div class="conversation" aria-label="Histórico da conversa">${ticket.messages.map((m) => `<article class="message ${m.isAdmin ? 'staff' : ''}"><div class="message-meta"><strong>${m.isAdmin ? 'Equipe KRX' : 'Cliente'}</strong><time>${esc(new Date(m.createdAt).toLocaleString('pt-BR'))}</time></div><p>${esc(m.body)}</p></article>`).join('')}</div>${ticket.status === 'open' ? '<form id="replyForm"><label>Resposta<textarea name="body" maxlength="4000" rows="5" required placeholder="Escreva sua mensagem"></textarea></label><button class="button" type="submit">Enviar resposta</button></form>' : '<div class="empty-state"><h3>Conversa encerrada</h3><p>Reabra o chamado para continuar o atendimento.</p></div>'}</section>`;
      document.querySelector('#ticketStatus').onclick = async (event) => {
        event.target.disabled = true;
        try {
          await api(supportPath(admin) + '/' + id + '/status', {
            method: 'PATCH',
            body: JSON.stringify({
              status: ticket.status === 'open' ? 'closed' : 'open',
            }),
          });
          await ticketView(id, admin);
        } catch (error) {
          notice(error.message, true);
          event.target.disabled = false;
        }
      };
      const form = document.querySelector('#replyForm');
      if (form) {
        let requestId = crypto.randomUUID();
        let previous = null;
        form.onsubmit = async (event) => {
          event.preventDefault();
          const button = form.querySelector('button');
          const body = new FormData(form).get('body').trim();
          if (previous !== null && body !== previous)
            requestId = crypto.randomUUID();
          previous = body;
          button.disabled = true;
          try {
            await api(supportPath(admin) + '/' + id + '/messages', {
              method: 'POST',
              body: JSON.stringify({ body, requestId }),
            });
            await ticketView(id, admin);
          } catch (error) {
            notice(error.message, true);
            button.disabled = false;
          }
        };
      }
    } catch (error) {
      app.innerHTML = '<h1>Chamado</h1><div id="notice" role="status"></div>';
      notice(error.message, true);
    }
  }
  async function notificationsView(params) {
    setNav(true);
    const page = Math.max(1, Number(params.get('page')) || 1);
    try {
      const result = await api('/notifications?page=' + page + '&limit=20');
      app.innerHTML = `<div class="page-header"><div><p class="eyebrow">Sua conta</p><h1>Notificações</h1><p class="muted">Respostas e atualizações dos seus chamados.</p></div><span class="tag">${result.unread} não lidas</span></div><div id="notice" role="status"></div><section class="card">${result.data.length ? result.data.map((n) => `<article class="notification-row ${n.readAt ? '' : 'unread'}"><div><strong>${esc(n.title)}</strong><p class="muted">${esc(new Date(n.createdAt).toLocaleString('pt-BR'))} · ${n.readAt ? 'Lida' : 'Não lida'}</p><a href="#/support?ticket=${esc(n.ticketId)}">Ver chamado</a></div>${n.readAt ? '' : `<button class="button alt" data-read="${esc(n.id)}">Marcar como lida</button>`}</article>`).join('') : '<div class="empty-state"><h3>Tudo em dia</h3><p>Você ainda não recebeu notificações.</p></div>'}<div class="actions">${page > 1 ? `<a class="button alt" href="#/notifications?page=${page - 1}">Anterior</a>` : ''}${page * 20 < result.total ? `<a class="button alt" href="#/notifications?page=${page + 1}">Próxima</a>` : ''}</div></section>`;
      app.querySelectorAll('[data-read]').forEach((button) => {
        button.onclick = async () => {
          button.disabled = true;
          try {
            await api('/notifications/' + button.dataset.read + '/read', {
              method: 'PATCH',
            });
            await notificationsView(params);
          } catch (error) {
            notice(error.message, true);
            button.disabled = false;
          }
        };
      });
    } catch (error) {
      app.innerHTML =
        '<h1>Notificações</h1><div id="notice" role="status"></div>';
      notice(error.message, true);
    }
  }

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {}
    clearSession();
    location.hash = '#/login';
    loginView();
  }

  async function route() {
    nav?.classList.remove('open');
    menuButton?.setAttribute('aria-expanded', 'false');
    const [hash, query = ''] = (location.hash || '#/').split('?');
    const params = new URLSearchParams(query);
    if (hash === '#/confirm-email' || hash === '#/confirm-new-email')
      return confirmationView(hash, params);
    if (hash === '#/reset-password') return resetPasswordView(params);
    if (hash === '#/login') return loginView();
    if (hash === '#/register') return registerView();
    if (hash === '#/forgot') return forgotView();

    if (!(await requireUser())) {
      if (hash === '#/catalog' || hash === '#/playground') {
        const requestedRoute = params.get('route');
        sessionStorage.setItem(
          'krx.dashboard.return',
          hash +
            (hash === '#/playground' &&
            /^[a-z0-9_-]{1,80}$/.test(requestedRoute || '')
              ? '?route=' + requestedRoute
              : ''),
        );
      }
      if (['#/support', '#/support-admin', '#/notifications'].includes(hash)) {
        const ticket = params.get('ticket');
        sessionStorage.setItem(
          'krx.dashboard.return',
          hash +
            (hash !== '#/notifications' && /^[a-f0-9-]{36}$/.test(ticket || '')
              ? '?ticket=' + ticket
              : ''),
        );
      }
      location.hash = '#/login';
      return loginView();
    }

    if (checkoutReturn) {
      const pending = checkoutReturn;
      checkoutReturn = null;
      let message;
      let failed = false;
      try {
        const payment = await api(
          '/billing/payments/' + pending.orderId + '/reconcile',
          {
            method: 'POST',
            body: JSON.stringify({
              providerPaymentId: pending.providerPaymentId,
            }),
          },
        );
        message =
          'Pagamento consultado: ' +
          (paymentLabels[payment.status] || payment.status);
      } catch (error) {
        message = error.message;
        failed = true;
      }
      history.replaceState(null, '', location.pathname + '#/payments');
      await paymentsView();
      notice(message, failed);
      return;
    }
    if (hash === '#/support') return supportView(params);
    if (hash === '#/support-admin') return supportView(params, true);
    if (hash === '#/notifications') return notificationsView(params);
    if (hash === '#/catalog') return catalogView();
    if (hash === '#/playground') return playgroundView(params);
    if (hash === '#/billing') return billingView();
    if (hash === '#/payments') return paymentsView();
    if (hash === '#/billing-admin') return billingAdminView();
    if (hash === '#/billing-payments') return paymentsView(1, true);
    if (hash === '#/keys') return keysView();
    if (hash === '#/usage') return usageView();
    if (hash === '#/credits') return creditsView();
    if (hash === '#/users') return usersView();
    if (hash === '#/profile') return profileView();
    return dashboardView();
  }

  menuButton?.addEventListener('click', () => {
    const open = nav?.classList.toggle('open');
    menuButton.setAttribute('aria-expanded', String(Boolean(open)));
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      nav?.classList.remove('open');
      menuButton?.setAttribute('aria-expanded', 'false');
    }
  });
  logoutButton?.addEventListener('click', logout);
  document.querySelector('.skip-link')?.addEventListener('click', (event) => {
    event.preventDefault();
    app.focus();
  });
  window.addEventListener('hashchange', () => {
    routeQueue = routeQueue.then(route, route);
  });

  (async () => {
    await loadConfig();
    await route();
  })();
})();
