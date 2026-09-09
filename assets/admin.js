const config = window.ICHJO_LAB_CONFIG || {};
const db = window.supabase?.createClient(config.supabaseUrl, config.supabasePublishableKey);
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const maxImageSize = 5 * 1024 * 1024;
const escapeHTML = (value = '') => String(value).replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[character]));
const formatDate = value => new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric', month: 'long', day: 'numeric'
}).format(new Date(`${value}T00:00:00`));

function prepareAppCode(raw = '') {
  const code = raw.trim();
  if (!code) return '';
  if (/<!doctype|<html[\s>]|<body[\s>]/i.test(code)) return code;
  if (/<[a-z][\s\S]*>/i.test(code)) return `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,sans-serif;margin:0;padding:24px}</style></head><body>${code}</body></html>`;
  if (/\b(function|const|let|var|document\.|window\.|addEventListener|=>)\b/.test(code)) return `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,sans-serif;margin:0;padding:24px}</style></head><body><main id="app"></main><script>${code}<\/script></body></html>`;
  return `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${code}</style></head><body><main id="app">アプリのHTMLを追加してください。</main></body></html>`;
}

function createStoragePath(file) {
  const extension = (file.name.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
}

async function render() {
  const [{data: apps = [], error: appsError}, {data: posts = [], error: postsError}, {data: messages = [], error: messagesError}] = await Promise.all([
    db.from('apps').select('*').order('created_at', {ascending: false}),
    db.from('posts').select('*').order('published_on', {ascending: false}),
    db.from('messages').select('*').order('created_at', {ascending: false})
  ]);
  if (appsError || postsError || messagesError) {
    document.querySelector('#panel-overview .card').innerHTML = '<h3>データを読み込めませんでした</h3><p>Supabaseの設定と管理者メールアドレスをご確認ください。</p>';
    return;
  }
  document.querySelector('#app-count').textContent = apps.length;
  document.querySelector('#post-count').textContent = posts.length;
  document.querySelector('#message-count').textContent = messages.length;
  document.querySelector('#admin-app-list').innerHTML = apps.length ? apps.map(app => `
    <article><div><small>${escapeHTML(app.category)}${app.code ? ' · CODE READY' : ''}</small><h3>${escapeHTML(app.title)}</h3><p>${escapeHTML(app.description)}</p>${app.code ? `<a href="runner.html?id=${encodeURIComponent(app.id)}" target="_blank">プレビューを開く ↗</a>` : ''}</div><button class="delete" data-delete-app="${app.id}">削除</button></article>
  `).join('') : '<p class="empty">アプリはありません。</p>';
  document.querySelector('#admin-post-list').innerHTML = posts.length ? posts.map(post => `
    <article>${post.image_url ? `<img class="post-thumb" src="${escapeHTML(post.image_url)}" alt="">` : ''}<div><small>${escapeHTML(formatDate(post.published_on))}</small><h3>${escapeHTML(post.title)}</h3><p>${escapeHTML(post.excerpt)}</p></div><button class="delete" data-delete-post="${post.id}" data-image-path="${escapeHTML(post.image_path || '')}">削除</button></article>
  `).join('') : '<p class="empty">記事はありません。</p>';
  document.querySelector('#admin-message-list').innerHTML = messages.length ? messages.map(message => `
    <article><div><small>${escapeHTML(message.kind)} · ${escapeHTML(new Date(message.created_at).toLocaleString('ja-JP'))}</small><h3>${escapeHTML(message.name)}</h3><p><a href="mailto:${escapeHTML(message.email)}">${escapeHTML(message.email)}</a>${message.organization ? ` · ${escapeHTML(message.organization)}` : ''}</p><p>${escapeHTML(message.message)}</p></div><button class="delete" data-delete-message="${message.id}">削除</button></article>
  `).join('') : '<p class="empty">受信内容はありません。</p>';
}

async function initAdmin() {
  const shell = document.querySelector('.shell');
  if (!shell || !db) return;
  const screen = document.querySelector('#login-screen');
  const loginForm = document.querySelector('#login-form');
  const loginStatus = document.querySelector('#login-status');
  const resetForm = document.querySelector('#reset-form');
  const resetStatus = document.querySelector('#reset-status');
  let recoveryMode = location.hash.includes('type=recovery');
  const show = async session => {
    const signedIn = Boolean(session);
    const resetting = signedIn && recoveryMode;
    screen.hidden = signedIn && !resetting;
    loginForm.hidden = resetting;
    resetForm.hidden = !resetting;
    shell.hidden = !signedIn || resetting;
    document.querySelector('.header').classList.toggle('signed-in', signedIn && !resetting);
    document.querySelector('#admin-email').textContent = session?.user?.email || '';
    if (signedIn && !resetting) await render();
  };
  const {data: {session}} = await db.auth.getSession();
  await show(session);
  db.auth.onAuthStateChange((authEvent, currentSession) => {
    if (authEvent === 'PASSWORD_RECOVERY') recoveryMode = true;
    setTimeout(() => show(currentSession), 0);
  });

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    loginStatus.textContent = '確認しています…';
    const password = new FormData(loginForm).get('password');
    const {error} = await db.auth.signInWithPassword({email: config.adminEmail, password});
    loginStatus.textContent = error ? 'パスワードが正しくありません。' : '';
  });
  document.querySelector('#forgot-password').addEventListener('click', async () => {
    loginStatus.textContent = '再設定メールを送信しています…';
    const {error} = await db.auth.resetPasswordForEmail(config.adminEmail, {redirectTo: config.adminUrl});
    loginStatus.textContent = error ? `送信できませんでした：${error.message}` : '再設定メールを送りました。メール内のリンクを開いてください。';
  });
  resetForm.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(resetForm));
    if (values.password !== values.confirmation) {
      resetStatus.textContent = '2つのパスワードが一致していません。';
      return;
    }
    resetStatus.textContent = 'パスワードを変更しています…';
    const {error} = await db.auth.updateUser({password: values.password});
    if (error) {
      resetStatus.textContent = `変更できませんでした：${error.message}`;
      return;
    }
    recoveryMode = false;
    history.replaceState(null, '', location.pathname);
    resetForm.reset();
    const {data: {session: currentSession}} = await db.auth.getSession();
    await show(currentSession);
  });
  document.querySelector('#logout-button').addEventListener('click', () => db.auth.signOut());
  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(item => item.classList.toggle('active', item === tab));
    document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('active', panel.id === `panel-${tab.dataset.tab}`));
  }));
  document.querySelector('#app-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const {error} = await db.from('apps').insert({
      title: values.title, category: values.category, description: values.description,
      url: values.url || '', code: prepareAppCode(values.code),
      accent: ['pink', 'cyan', 'yellow', 'purple'][Math.floor(Math.random() * 4)]
    });
    if (error) return alert(`追加できませんでした：${error.message}`);
    form.reset();
    await render();
  });
  document.querySelector('#post-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const file = form.elements.image.files[0];
    const status = document.querySelector('#post-status');
    const button = form.querySelector('button[type="submit"]');
    let imagePath = '';
    let imageUrl = '';
    if (file && !imageTypes.has(file.type)) {
      status.textContent = 'JPG・PNG・WebP・GIFの画像を選んでください。';
      return;
    }
    if (file && file.size > maxImageSize) {
      status.textContent = '画像は5MB以下にしてください。';
      return;
    }
    button.disabled = true;
    status.textContent = file ? '画像をアップロードしています…' : '記事を保存しています…';
    try {
      if (file) {
        imagePath = createStoragePath(file);
        const {error: uploadError} = await db.storage.from('blog-images').upload(imagePath, file, {
          cacheControl: '3600', upsert: false, contentType: file.type
        });
        if (uploadError) throw uploadError;
        imageUrl = db.storage.from('blog-images').getPublicUrl(imagePath).data.publicUrl;
      }
      const {error} = await db.from('posts').insert({
        title: values.title, published_on: values.date, excerpt: values.excerpt,
        image_url: imageUrl, image_path: imagePath
      });
      if (error) throw error;
      form.reset();
      status.textContent = '記事を追加しました。';
      await render();
    } catch (error) {
      if (imagePath) await db.storage.from('blog-images').remove([imagePath]);
      status.textContent = `追加できませんでした：${error.message}`;
    } finally {
      button.disabled = false;
    }
  });
  document.addEventListener('click', async event => {
    const appId = event.target.dataset?.deleteApp;
    const postId = event.target.dataset?.deletePost;
    const messageId = event.target.dataset?.deleteMessage;
    if (appId) {
      await db.from('apps').delete().eq('id', appId);
      await render();
    }
    if (postId) {
      if (!confirm('この記事を削除しますか？')) return;
      const imagePath = event.target.dataset.imagePath || '';
      const {error} = await db.from('posts').delete().eq('id', postId);
      if (error) return alert(`削除できませんでした：${error.message}`);
      if (imagePath) await db.storage.from('blog-images').remove([imagePath]);
      await render();
    }
    if (messageId) {
      await db.from('messages').delete().eq('id', messageId);
      await render();
    }
  });
  document.querySelector('#clear-messages').addEventListener('click', async () => {
    if (!confirm('受信内容をすべて削除しますか？')) return;
    const {data} = await db.from('messages').select('id');
    for (const message of data || []) await db.from('messages').delete().eq('id', message.id);
    await render();
  });
}

async function initRunner() {
  const frame = document.querySelector('#app-frame');
  if (!frame || !db) return;
  const id = new URLSearchParams(location.search).get('id');
  const {data: app} = await db.from('apps').select('*').eq('id', id).maybeSingle();
  const error = document.querySelector('#runner-error');
  if (!app?.code) {
    error.hidden = false;
    error.textContent = 'アプリコードが見つかりません。';
    frame.hidden = true;
    return;
  }
  document.title = `${app.title} | Ichijo AI Lab`;
  document.querySelector('#runner-title').textContent = app.title;
  frame.srcdoc = app.code;
}

initAdmin();
initRunner();
