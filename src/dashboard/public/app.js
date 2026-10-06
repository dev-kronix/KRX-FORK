(() => {
  const app = document.querySelector('#app');
  const nav = document.querySelector('#nav');
  const menuButton = document.querySelector('#menuButton');
  const logoutButton = document.querySelector('#logoutButton');
  const keys = {
    token: 'krx.dashboard.token',
    refresh: 'krx.dashboard.refresh',
    expires: 'krx.dashboard.expires',
    user: 'krx.dashboard.user'
  };
  let config = { apiBase: '/api/v1', googleClientId: '' };
  let currentUser = readUser();

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function readUser() {
    try { return JSON.parse(sessionStorage.getItem(keys.user) || 'null'); }
    catch { return null; }
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
    const refreshToken = sessionStorage.getItem(keys.refresh);
    if (!refreshToken) return false;
    const response = await fetch(config.apiBase + '/auth/refresh', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + refreshToken }
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
    const response = await fetch(config.apiBase + path, { ...options, headers });
    if (response.status === 401 && retry && await refreshSession()) {
      return api(path, options, false);
    }
    if (response.status === 204) return null;
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = data?.errors ? Object.values(data.errors).join(', ') : data?.message;
      throw new Error(detail || 'Não foi possível concluir a operação.');
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
    return user?.role?.name || (String(user?.role?.id) === '1' ? 'admin' : 'user');
  }

  function statusName(user) {
    return user?.status?.name || (String(user?.status?.id) === '1' ? 'active' : 'inactive');
  }

  function nameOf(user) {
    return [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || 'Usuário';
  }

  function setNav(authenticated) {
    document.querySelector('.topbar').style.display = authenticated ? 'flex' : 'none';
    document.querySelector('footer').style.display = authenticated ? 'flex' : 'none';
    document.querySelectorAll('[data-admin]').forEach((el) => {
      el.style.display = authenticated && roleName(currentUser) === 'admin' ? '' : 'none';
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
    app.innerHTML = '<section class="auth-wrap"><div class="auth">' +
      '<div class="eyebrow">KRX / ACESSO</div><h1>Entre na KRX.</h1>' +
      '<p class="muted">Gerencie sua conta e os recursos da API em um só lugar.</p>' +
      '<div class="auth-card"><div id="notice" hidden></div>' +
      '<form id="loginForm"><label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" required>' +
      '<label for="password">Senha</label><input id="password" name="password" type="password" autocomplete="current-password" required>' +
      '<button class="button" type="submit">Entrar</button></form>' +
      '<div class="divider">ou</div><div class="google-slot" id="googleButton"></div>' +
      '<div class="auth-links"><a href="#/register">Criar conta</a><a href="#/forgot">Esqueci a senha</a></div></div></div></section>';

    document.querySelector('#loginForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector('button');
      button.disabled = true;
      try {
        const data = await api('/auth/email/login', {
          method: 'POST',
          body: JSON.stringify({
            email: event.currentTarget.email.value,
            password: event.currentTarget.password.value
          })
        });
        saveSession(data);
        location.hash = '#/';
        await route();
      } catch (error) {
        notice(error.message, true);
      } finally { button.disabled = false; }
    });
    initGoogle();
  }

  function registerView() {
    setNav(false);
    app.innerHTML = '<section class="auth-wrap"><div class="auth">' +
      '<div class="eyebrow">KRX / CADASTRO</div><h1>Crie sua conta.</h1>' +
      '<p class="muted">O cadastro por e-mail exige confirmação antes do primeiro login.</p>' +
      '<div class="auth-card"><div id="notice" hidden></div><form id="registerForm">' +
      '<label for="firstName">Nome</label><input id="firstName" name="firstName" required>' +
      '<label for="lastName">Sobrenome</label><input id="lastName" name="lastName" required>' +
      '<label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" required>' +
      '<label for="password">Senha</label><input id="password" name="password" type="password" minlength="6" autocomplete="new-password" required>' +
      '<button class="button" type="submit">Criar conta</button></form>' +
      '<div class="auth-links"><a href="#/login">Já tenho conta</a></div></div></div></section>';

    document.querySelector('#registerForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        await api('/auth/email/register', {
          method: 'POST',
          body: JSON.stringify({
            firstName: form.firstName.value,
            lastName: form.lastName.value,
            email: form.email.value,
            password: form.password.value
          })
        });
        notice('Conta criada. Confira seu e-mail para ativar o acesso.');
        form.reset();
      } catch (error) { notice(error.message, true); }
    });
  }

  function forgotView() {
    setNav(false);
    app.innerHTML = '<section class="auth-wrap"><div class="auth">' +
      '<div class="eyebrow">KRX / RECUPERAÇÃO</div><h1>Recupere o acesso.</h1>' +
      '<p class="muted">Enviaremos as instruções para o e-mail cadastrado.</p>' +
      '<div class="auth-card"><div id="notice" hidden></div><form id="forgotForm">' +
      '<label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" required>' +
      '<button class="button" type="submit">Enviar instruções</button></form>' +
      '<div class="auth-links"><a href="#/login">Voltar ao login</a></div></div></div></section>';
    document.querySelector('#forgotForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('/auth/forgot/password', {
          method: 'POST',
          body: JSON.stringify({ email: event.currentTarget.email.value })
        });
        notice('Se o e-mail estiver cadastrado, as instruções serão enviadas.');
      } catch (error) { notice(error.message, true); }
    });
  }

  async function initGoogle() {
    const slot = document.querySelector('#googleButton');
    if (!slot) return;
    if (!config.googleClientId) {
      slot.innerHTML = '<span class="muted">Login Google ainda não configurado no servidor.</span>';
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
              body: JSON.stringify({ idToken: response.credential })
            });
            saveSession(data);
            location.hash = '#/';
            await route();
          } catch (error) { notice(error.message, true); }
        }
      });
      window.google.accounts.id.renderButton(slot, {
        theme: 'filled_black',
        size: 'large',
        width: Math.min(400, slot.clientWidth || 400),
        text: 'continue_with'
      });
    };
    if (window.google?.accounts?.id) return start();
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = start;
    document.head.appendChild(script);
  }

  function dashboardView() {
    setNav(true);
    const role = roleName(currentUser);
    const status = statusName(currentUser);
    app.innerHTML = '<section class="hero"><div class="hero-copy"><div class="eyebrow">KRX / PAINEL</div>' +
      '<h1>Olá, ' + esc(currentUser.firstName || 'dev') + '.</h1>' +
      '<p>Seu acesso à KRX está centralizado aqui. Métricas de consumo e chaves entram quando os módulos correspondentes forem adicionados à API.</p></div>' +
      '<span class="status">● API ONLINE</span></section>' +
      '<section class="grid"><article class="card metric"><strong>' + esc(role) + '</strong><span>Nível de acesso</span></article>' +
      '<article class="card metric"><strong>' + esc(status) + '</strong><span>Status da conta</span></article>' +
      '<article class="card metric"><strong>' + esc(currentUser.provider || 'email') + '</strong><span>Provedor de login</span></article></section>' +
      '<section class="grid two"><article class="card"><div class="eyebrow">01 / CONTA</div><h2>Identidade</h2>' +
      '<p class="muted">' + esc(nameOf(currentUser)) + '<br>' + esc(currentUser.email || 'Sem e-mail') + '</p>' +
      '<div class="actions"><a class="button alt" href="#/profile">Editar perfil</a></div></article>' +
      '<article class="card"><div class="eyebrow">02 / API</div><h2>Ferramentas</h2><p class="muted">Acesse a documentação OpenAPI ou teste as rotas disponíveis.</p>' +
      '<div class="actions"><a class="button" href="/docs" target="_blank">Abrir documentação ↗</a></div></article></section>' +
      '<div class="quick-links"><a href="/docs" target="_blank">Swagger</a><a href="/">Status da API</a>' +
      (role === 'admin' ? '<a href="#/users">Gerenciar usuários</a>' : '<a href="#/profile">Minha conta</a>') + '</div>';
  }

  async function usersView() {
    setNav(true);
    if (roleName(currentUser) !== 'admin') {
      app.innerHTML = '<div class="eyebrow">KRX / ACESSO</div><h1>Sem permissão.</h1><p class="muted">Esta área é exclusiva para administradores.</p>';
      return;
    }
    app.innerHTML = '<div class="eyebrow">KRX / ADMIN</div><h1>Usuários.</h1><p class="muted">Carregando usuários...</p>';
    try {
      const result = await api('/users?page=1&limit=50');
      const rows = (result?.data || []).map((user) =>
        '<tr><td class="mono">#' + esc(user.id) + '</td><td><strong>' + esc(nameOf(user)) + '</strong><br><span class="muted">' + esc(user.email || '—') + '</span></td>' +
        '<td><span class="tag">' + esc(user.provider || '—') + '</span></td><td><span class="tag ' + (statusName(user) === 'active' ? 'green' : '') + '">' + esc(statusName(user)) + '</span></td>' +
        '<td><span class="tag">' + esc(roleName(user)) + '</span></td><td>' + esc(user.createdAt ? new Date(user.createdAt).toLocaleDateString('pt-BR') : '—') + '</td></tr>'
      ).join('');
      app.innerHTML = '<section class="hero"><div class="hero-copy"><div class="eyebrow">KRX / ADMIN</div><h1>Usuários.</h1><p>Primeiros ' + esc((result?.data || []).length) + ' registros da base.</p></div></section>' +
        '<div class="table-wrap"><table><thead><tr><th>ID</th><th>Usuário</th><th>Provedor</th><th>Status</th><th>Role</th><th>Criado</th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="6">Nenhum usuário encontrado.</td></tr>') + '</tbody></table></div>';
    } catch (error) {
      app.innerHTML += '<div class="notice error">' + esc(error.message) + '</div>';
    }
  }

  function profileView() {
    setNav(true);
    app.innerHTML = '<section class="hero"><div class="hero-copy"><div class="eyebrow">KRX / PERFIL</div><h1>Minha conta.</h1><p>Atualize seus dados de perfil e senha.</p></div></section>' +
      '<div id="notice" hidden></div><section class="profile-grid"><form class="card" id="profileForm"><h2>Dados pessoais</h2>' +
      '<label for="firstName">Nome</label><input id="firstName" name="firstName" value="' + esc(currentUser.firstName || '') + '" required>' +
      '<label for="lastName">Sobrenome</label><input id="lastName" name="lastName" value="' + esc(currentUser.lastName || '') + '" required>' +
      '<button class="button" type="submit">Salvar alterações</button></form>' +
      '<form class="card" id="passwordForm"><h2>Alterar senha</h2><label for="oldPassword">Senha atual</label><input id="oldPassword" name="oldPassword" type="password" autocomplete="current-password" required>' +
      '<label for="password">Nova senha</label><input id="password" name="password" type="password" minlength="6" autocomplete="new-password" required>' +
      '<button class="button" type="submit">Trocar senha</button></form></section>';

    document.querySelector('#profileForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        currentUser = await api('/auth/me', {
          method: 'PATCH',
          body: JSON.stringify({
            firstName: event.currentTarget.firstName.value,
            lastName: event.currentTarget.lastName.value
          })
        });
        sessionStorage.setItem(keys.user, JSON.stringify(currentUser));
        notice('Perfil atualizado.');
      } catch (error) { notice(error.message, true); }
    });

    document.querySelector('#passwordForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('/auth/me', {
          method: 'PATCH',
          body: JSON.stringify({
            oldPassword: event.currentTarget.oldPassword.value,
            password: event.currentTarget.password.value
          })
        });
        event.currentTarget.reset();
        notice('Senha alterada. As outras sessões foram encerradas.');
      } catch (error) { notice(error.message, true); }
    });
  }

  async function logout() {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    clearSession();
    location.hash = '#/login';
    loginView();
  }

  async function route() {
    nav?.classList.remove('open');
    const hash = location.hash || '#/';
    if (hash === '#/login') return loginView();
    if (hash === '#/register') return registerView();
    if (hash === '#/forgot') return forgotView();

    if (!await requireUser()) {
      location.hash = '#/login';
      return loginView();
    }

    if (hash === '#/users') return usersView();
    if (hash === '#/profile') return profileView();
    return dashboardView();
  }

  menuButton?.addEventListener('click', () => nav?.classList.toggle('open'));
  logoutButton?.addEventListener('click', logout);
  window.addEventListener('hashchange', route);

  (async () => {
    await loadConfig();
    await route();
  })();
})();
