const config = window.ICHJO_LAB_CONFIG || {};
const db = window.supabase?.createClient(config.supabaseUrl, config.supabasePublishableKey);
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const maxImageSize = 5 * 1024 * 1024;
const postContentPrefix = '__ICHJO_POST_V1__:';
const appContentPrefix = '__ICHJO_APP_V1__:';
const escapeHTML = (value = '') => String(value).replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[character]));
const formatDate = value => new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric', month: 'long', day: 'numeric'
}).format(new Date(`${value}T00:00:00`));

function packPostContent(text, image = '', status = 'published') {
  return `${postContentPrefix}${JSON.stringify({text, image, status})}`;
}

function parsePostContent(post) {
  if (post.image_url) return {text: post.excerpt || '', image: post.image_url, status: 'published'};
  if (!String(post.excerpt || '').startsWith(postContentPrefix)) return {text: post.excerpt || '', image: '', status: 'published'};
  try {
    const content = JSON.parse(post.excerpt.slice(postContentPrefix.length));
    return {text: content.text || '', image: content.image || '', status: content.status === 'draft' ? 'draft' : 'published'};
  } catch {
    return {text: post.excerpt || '', image: '', status: 'published'};
  }
}

function packAppDescription(description, status = 'published') {
  return `${appContentPrefix}${JSON.stringify({description, status})}`;
}

function parseAppContent(app) {
  if (!String(app.description || '').startsWith(appContentPrefix)) return {description: app.description || '', status: 'published'};
  try {
    const content = JSON.parse(app.description.slice(appContentPrefix.length));
    return {description: content.description || '', status: content.status === 'draft' ? 'draft' : 'published'};
  } catch {
    return {description: app.description || '', status: 'published'};
  }
}

function makeResponsiveAppDocument(code = '') {
  const responsiveHead = `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style id="ichijo-responsive-app">html,body{max-width:100%;min-width:0;overflow-x:hidden}body{margin:0!important;padding:clamp(8px,3vw,18px)!important}*,*::before,*::after{box-sizing:border-box}img,video,svg,canvas,iframe{max-width:100%!important;height:auto}main,.container,.wrapper,.app,[id*="game"],[class*="game"]{max-width:100%!important}@media(max-width:600px){h1{font-size:clamp(1.5rem,8vw,2.4rem)!important}button,input,select,textarea{max-width:100%;font-size:16px}}</style>`;
  if (/<\/head>/i.test(code)) return code.replace(/<\/head>/i, `${responsiveHead}</head>`);
  if (/<body[\s>]/i.test(code)) return code.replace(/<body([^>]*)>/i, `${responsiveHead}<body$1>`);
  return `${responsiveHead}${code}`;
}

function prepareAppCode(raw = '') {
  const code = raw.trim();
  if (!code) return '';
  if (/<!doctype|<html[\s>]|<body[\s>]/i.test(code)) return code;
  if (/<[a-z][\s\S]*>/i.test(code)) return `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,sans-serif;margin:0;padding:24px}</style></head><body>${code}</body></html>`;
  if (/\b(function|const|let|var|document\.|window\.|addEventListener|=>)\b/.test(code)) return `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,sans-serif;margin:0;padding:24px}</style></head><body><main id="app"></main><script>${code}<\/script></body></html>`;
  return `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${code}</style></head><body><main id="app">アプリのHTMLを追加してください。</main></body></html>`;
}

function readBlobAsDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('画像を読み込めませんでした。'));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}

async function optimiseImage(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('画像を読み込めませんでした。'));
      element.src = objectUrl;
    });
    const maxSide = 1400;
    const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    let width = Math.max(1, Math.round(image.naturalWidth * ratio));
    let height = Math.max(1, Math.round(image.naturalHeight * ratio));
    let quality = 0.82;
    let blob;
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      blob = await canvasToBlob(canvas, quality);
      if (!blob) throw new Error('画像を変換できませんでした。');
      if (blob.size <= 700 * 1024) break;
      if (quality > 0.55) quality -= 0.1;
      else {
        width = Math.max(1, Math.round(width * 0.82));
        height = Math.max(1, Math.round(height * 0.82));
        quality = 0.72;
      }
    }
    if (!blob || blob.size > 900 * 1024) throw new Error('画像を十分に小さくできませんでした。別の画像をお試しください。');
    return readBlobAsDataURL(blob);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
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
  document.querySelector('#app-count').textContent = apps.filter(app => parseAppContent(app).status === 'published').length;
  document.querySelector('#post-count').textContent = posts.filter(post => parsePostContent(post).status === 'published').length;
  document.querySelector('#message-count').textContent = messages.length;
  document.querySelector('#admin-app-list').innerHTML = apps.length ? apps.map(app => {
    const content = parseAppContent(app);
    return `<article><div><small>${escapeHTML(app.category)}${app.code ? ' · CODE READY' : ''} <span class="status-badge ${content.status}">${content.status === 'draft' ? '下書き' : '公開中'}</span></small><h3>${escapeHTML(app.title)}</h3><p>${escapeHTML(content.description)}</p>${app.code ? `<a href="runner.html?id=${encodeURIComponent(app.id)}" target="_blank">プレビューを開く ↗</a>` : ''}</div><div class="item-actions"><button class="edit" data-edit-app="${app.id}">編集</button><button class="delete" data-delete-app="${app.id}">削除</button></div></article>`;
  }).join('') : '<p class="empty">アプリはありません。</p>';
  document.querySelector('#admin-post-list').innerHTML = posts.length ? posts.map(post => {
    const content = parsePostContent(post);
    return `<article>${content.image ? `<img class="post-thumb" src="${escapeHTML(content.image)}" alt="">` : ''}<div><small>${escapeHTML(formatDate(post.published_on))} <span class="status-badge ${content.status}">${content.status === 'draft' ? '下書き' : '公開中'}</span></small><h3>${escapeHTML(post.title)}</h3><p>${escapeHTML(content.text)}</p></div><div class="item-actions"><button class="edit" data-edit-post="${post.id}">編集</button><button class="delete" data-delete-post="${post.id}">削除</button></div></article>`;
  }).join('') : '<p class="empty">記事はありません。</p>';
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
  let editingPostImage = '';
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
    const record = {
      title: values.title, category: values.category, description: packAppDescription(values.description, values.status),
      url: values.url || '', code: prepareAppCode(values.code),
      accent: ['pink', 'cyan', 'yellow', 'purple'][Math.floor(Math.random() * 4)]
    };
    const request = values.id ? db.from('apps').update(record).eq('id', values.id) : db.from('apps').insert(record);
    const {error} = await request;
    if (error) return alert(`保存できませんでした：${error.message}`);
    form.reset();
    form.elements.id.value = '';
    document.querySelector('#app-submit').textContent = '処理してアプリを追加';
    document.querySelector('#app-cancel').hidden = true;
    await render();
  });
  document.querySelector('#post-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const file = form.elements.image.files[0];
    const status = document.querySelector('#post-status');
    const button = form.querySelector('button[type="submit"]');
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
    status.textContent = file ? '画像を最適化しています…' : '記事を保存しています…';
    try {
      if (file) {
        imageUrl = await optimiseImage(file);
        status.textContent = '記事を保存しています…';
      }
      if (values.remove_image === 'on') editingPostImage = '';
      const record = {
        title: values.title, published_on: values.date,
        excerpt: packPostContent(values.excerpt, imageUrl || editingPostImage, values.status)
      };
      const request = values.id ? db.from('posts').update(record).eq('id', values.id) : db.from('posts').insert(record);
      const {error} = await request;
      if (error) throw error;
      const wasEditing = Boolean(values.id);
      form.reset();
      form.elements.id.value = '';
      editingPostImage = '';
      document.querySelector('#post-submit').textContent = '記事を追加';
      document.querySelector('#post-cancel').hidden = true;
      document.querySelector('#existing-image-note').hidden = true;
      status.textContent = wasEditing ? '記事を更新しました。' : '記事を追加しました。';
      await render();
    } catch (error) {
      status.textContent = `追加できませんでした：${error.message}`;
    } finally {
      button.disabled = false;
    }
  });
  document.addEventListener('click', async event => {
    const appId = event.target.dataset?.deleteApp;
    const postId = event.target.dataset?.deletePost;
    const editAppId = event.target.dataset?.editApp;
    const editPostId = event.target.dataset?.editPost;
    const messageId = event.target.dataset?.deleteMessage;
    if (appId) {
      await db.from('apps').delete().eq('id', appId);
      await render();
    }
    if (postId) {
      if (!confirm('この記事を削除しますか？')) return;
      const {error} = await db.from('posts').delete().eq('id', postId);
      if (error) return alert(`削除できませんでした：${error.message}`);
      await render();
    }
    if (messageId) {
      await db.from('messages').delete().eq('id', messageId);
      await render();
    }
    if (editAppId) {
      const {data: app} = await db.from('apps').select('*').eq('id', editAppId).maybeSingle();
      if (!app) return;
      const content = parseAppContent(app);
      const form = document.querySelector('#app-form');
      form.elements.id.value = app.id;
      form.elements.title.value = app.title;
      form.elements.category.value = app.category;
      form.elements.description.value = content.description;
      form.elements.url.value = app.url || '';
      form.elements.code.value = app.code || '';
      form.elements.status.value = content.status;
      document.querySelector('#app-submit').textContent = '変更を保存';
      document.querySelector('#app-cancel').hidden = false;
      form.scrollIntoView({behavior: 'smooth', block: 'start'});
    }
    if (editPostId) {
      const {data: post} = await db.from('posts').select('*').eq('id', editPostId).maybeSingle();
      if (!post) return;
      const content = parsePostContent(post);
      const form = document.querySelector('#post-form');
      form.elements.id.value = post.id;
      form.elements.title.value = post.title;
      form.elements.date.value = post.published_on;
      form.elements.excerpt.value = content.text;
      form.elements.status.value = content.status;
      editingPostImage = content.image;
      document.querySelector('#existing-image-note').hidden = !content.image;
      document.querySelector('#post-submit').textContent = '変更を保存';
      document.querySelector('#post-cancel').hidden = false;
      document.querySelector('#post-status').textContent = '';
      form.scrollIntoView({behavior: 'smooth', block: 'start'});
    }
  });
  document.querySelector('#app-cancel').addEventListener('click', () => {
    const form = document.querySelector('#app-form');
    form.reset(); form.elements.id.value = '';
    document.querySelector('#app-submit').textContent = '処理してアプリを追加';
    document.querySelector('#app-cancel').hidden = true;
  });
  document.querySelector('#post-cancel').addEventListener('click', () => {
    const form = document.querySelector('#post-form');
    form.reset(); form.elements.id.value = ''; editingPostImage = '';
    document.querySelector('#post-submit').textContent = '記事を追加';
    document.querySelector('#post-cancel').hidden = true;
    document.querySelector('#existing-image-note').hidden = true;
    document.querySelector('#post-status').textContent = '';
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
  frame.srcdoc = makeResponsiveAppDocument(app.code);
}

initAdmin();
initRunner();
