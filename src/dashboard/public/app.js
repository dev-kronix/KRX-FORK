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

  function clearSession() {
    Object.values(keys).forEach((key) => sessionStorage.removeItem(key));
    currentUser = null;
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
      a.classList.toggle('active', a.getAttribute('href') === location.hash);
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
          location.hash = '#/';
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
            location.hash = '#/';
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
    const role = roleName(currentUser);
    let summary;
    try {
      summary = await api('/usage/summary');
    } catch (error) {
      app.innerHTML =
        '<div class="notice error">' + esc(error.message) + '</div>';
      return;
    }
    app.innerHTML =
      '<section class="hero"><div class="hero-copy"><div class="eyebrow">KRX / PAINEL</div>' +
      '<h1>Olá, ' +
      esc(currentUser.firstName || 'dev') +
      '.</h1>' +
      '<p>Seu acesso à KRX está centralizado aqui. Gerencie suas chaves, acompanhe créditos e consulte o histórico de consumo.</p></div>' +
      '<span class="status">● API ONLINE</span></section>' +
      '<section class="grid"><article class="card metric"><strong>' +
      esc(summary.balance) +
      '</strong><span>Créditos disponíveis</span></article>' +
      '<article class="card metric"><strong>' +
      esc(summary.totalRequests) +
      '</strong><span>Requisições registradas</span></article>' +
      '<article class="card metric"><strong>' +
      esc(summary.totalSpent) +
      '</strong><span>Créditos consumidos</span></article></section>' +
      '<section class="grid two"><article class="card"><div class="eyebrow">01 / CONTA</div><h2>Identidade</h2>' +
      '<p class="muted">' +
      esc(nameOf(currentUser)) +
      '<br>' +
      esc(currentUser.email || 'Sem e-mail') +
      '</p>' +
      '<div class="actions"><a class="button alt" href="#/profile">Editar perfil</a></div></article>' +
      '<article class="card"><div class="eyebrow">02 / API</div><h2>Ferramentas</h2><p class="muted">Acesse a documentação OpenAPI ou teste as rotas disponíveis.</p>' +
      '<div class="actions"><a class="button" href="#/keys">Gerenciar chaves</a><a class="button alt" href="#/usage">Ver consumo</a></div></article></section>' +
      '<div class="quick-links"><a href="/docs" target="_blank">Swagger</a><a href="/">Status da API</a>' +
      (role === 'admin'
        ? '<a href="#/users">Gerenciar usuários</a>'
        : '<a href="#/profile">Minha conta</a>') +
      '</div>';
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
    const [hash, query = ''] = (location.hash || '#/').split('?');
    const params = new URLSearchParams(query);
    if (hash === '#/confirm-email' || hash === '#/confirm-new-email')
      return confirmationView(hash, params);
    if (hash === '#/reset-password') return resetPasswordView(params);
    if (hash === '#/login') return loginView();
    if (hash === '#/register') return registerView();
    if (hash === '#/forgot') return forgotView();

    if (!(await requireUser())) {
      location.hash = '#/login';
      return loginView();
    }

    if (hash === '#/keys') return keysView();
    if (hash === '#/usage') return usageView();
    if (hash === '#/credits') return creditsView();
    if (hash === '#/users') return usersView();
    if (hash === '#/profile') return profileView();
    return dashboardView();
  }

  menuButton?.addEventListener('click', () => nav?.classList.toggle('open'));
  logoutButton?.addEventListener('click', logout);
  window.addEventListener('hashchange', () => {
    routeQueue = routeQueue.then(route, route);
  });

  (async () => {
    await loadConfig();
    await route();
  })();
})();
