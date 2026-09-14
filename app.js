// ⚠️ Вставь сюда URL своего Web App (из Apps Script)
const API_URL = 'https://script.google.com/macros/s/AKfycbyZNSS5aSBWuanDGo6bSDFawbEwmOS7lymecUglGlaqdF6Mij7Un6Tze2iE3YCpBYL1/exec';

let currentUser = null; // {id, login, role, canPost, canComment}
let cachedPosts = [];

// --------- API ---------
async function api(action, data = {}) {
  const res = await fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify({ action, data }),
    // важно: без headers, чтобы не было preflight (CORS)
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error);
  return json.data;
}

// --------- УТИЛИТЫ ---------
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
  ));
}

function normalizeRole(r) {
  return String(r == null ? '' : r).trim().toLowerCase();
}

function toBool(v) {
  return v === true || String(v).trim().toUpperCase() === 'TRUE';
}

// --------- ЭМОДЗИ ---------
const EMOJI_CATEGORIES = {
  'Смайлы':   ['😀','😄','😂','🤣','😊','😍','😘','😎','🤔','😴','😢','😭','😡','🥳','🤩','😇','🙃','😉','😌','🤗'],
  'Жесты':    ['👍','👎','👏','🙏','🤝','✌️','🤘','👌','💪','🖐️','👋','🤙'],
  'Сердца':   ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💖','💘','💝'],
  'Символы':  ['🔥','⭐','✨','⚡','💯','✅','❌','⚠️','❗','❓','♛','👑','🎉','🎊'],
  'Британия': ['🇬🇧','☕','🍵','🐕','🐈','🦁','🌧️','🌫️','🎩','🚂','🏰','⚽','🎭','🎼'],
  'Природа':  ['🌸','🌹','🌻','🌳','🍀','🌈','☀️','🌙','⛅','🌊','🍁','❄️'],
  'Еда':      ['🍕','🍔','🍟','🍰','🍩','🍪','🍫','🍎','🍓','🍇','🥐','🍷']
};

function insertEmoji(targetId, emoji) {
  const el = document.getElementById(targetId);
  if (!el) return;

  const start = el.selectionStart ?? el.value.length;
  const end   = el.selectionEnd   ?? el.value.length;
  const val   = el.value;

  el.value = val.slice(0, start) + emoji + val.slice(end);

  const pos = start + emoji.length;
  el.focus();
  try { el.setSelectionRange(pos, pos); } catch (_) { /* input[type=text] не всегда поддерживает */ }

  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function toggleEmojiPicker(targetId) {
  const picker = document.getElementById('emojiPicker-' + targetId);
  if (!picker) return;

  const isHidden = picker.style.display === 'none' || !picker.style.display;
  if (!isHidden) { picker.style.display = 'none'; return; }

  if (!picker.dataset.built) {
    let html = '';
    for (const [cat, list] of Object.entries(EMOJI_CATEGORIES)) {
      html += `<div class="emoji-cat">${cat}</div><div class="emoji-grid">`;
      for (const e of list) {
        html += `<button type="button" class="emoji-btn" onclick="insertEmoji('${targetId}','${e}')">${e}</button>`;
      }
      html += `</div>`;
    }
    picker.innerHTML = html;
    picker.dataset.built = '1';
  }

  picker.style.display = 'block';
}

// Закрываем палитру по клику вне её
document.addEventListener('click', (e) => {
  document.querySelectorAll('.emoji-picker').forEach(p => {
    if (p.style.display === 'block' &&
        !p.contains(e.target) &&
        !e.target.closest('.emoji-more')) {
      p.style.display = 'none';
    }
  });
});

// Esc закрывает все палитры
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.emoji-picker').forEach(p => p.style.display = 'none');
  }
});

// --------- АВТОРИЗАЦИЯ ---------
async function doLogin() {
  const login = document.getElementById('loginInput').value.trim();
  const password = document.getElementById('passInput').value;
  try {
    const user = await api('login', { login, password });
    currentUser = user;
    localStorage.setItem('blogUser', JSON.stringify(user));
    afterLogin();
    document.getElementById('authMsg').textContent = '✅ Успешный вход!';
  } catch (e) {
    document.getElementById('authMsg').textContent = '❌ ' + e.message;
  }
}

async function doRegister() {
  const login = document.getElementById('loginInput').value.trim();
  const password = document.getElementById('passInput').value;
  try {
    const r = await api('register', { login, password });
    document.getElementById('authMsg').textContent = '✅ ' + r.message;
  } catch (e) {
    document.getElementById('authMsg').textContent = '❌ ' + e.message;
  }
}

function logout() {
  currentUser = null;
  localStorage.removeItem('blogUser');
  location.reload();
}

function afterLogin() {
  document.getElementById('authSection').style.display = 'none';
  document.getElementById('createSection').style.display = 'block';

  const role = normalizeRole(currentUser && currentUser.role);
  currentUser.role = role;

  document.getElementById('authBox').innerHTML =
    `${escapeHtml(currentUser.login)} (${escapeHtml(role)}) <button onclick="logout()">Выйти</button>`;

  if (role === 'admin') {
    document.getElementById('adminSection').style.display = 'block';
    loadAdmin();
  } else {
    document.getElementById('adminSection').style.display = 'none';
  }
  renderPosts();
}

// --------- ПОСТЫ ---------
async function loadPosts() {
  cachedPosts = await api('getPosts', {
    viewerRole: currentUser ? currentUser.role : 'guest',
    viewerId: currentUser ? currentUser.id : null
  });
}

async function renderPosts() {
  await loadPosts();
  const sort = document.getElementById('sortSelect').value;
  let posts = [...cachedPosts];

  if (sort === 'new') posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (sort === 'old') posts.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  if (sort === 'title') posts.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  if (sort === 'author') posts.sort((a, b) => String(a.authorLogin || '').localeCompare(String(b.authorLogin || '')));

  const box = document.getElementById('postsBox');
  box.innerHTML = '';

  if (!posts.length) {
    box.innerHTML = currentUser
      ? '<p class="muted"><i>Постов пока нет.</i></p>'
      : '<p class="muted"><i>Войдите, чтобы увидеть посты. Незарегистрированным пользователям посты недоступны.</i></p>';
    return;
  }

  for (const p of posts) {
    box.appendChild(await renderPost(p));
  }
}

async function renderPost(p) {
  const div = document.createElement('div');
  div.className = 'post';

  const canEdit = currentUser && (
    currentUser.role === 'admin' ||
    currentUser.role === 'editor' ||
    (currentUser.role === 'user' && p.authorId == currentUser.id)
  );

  const postEmojiId   = `cInput-${p.id}`;
  const postPickerId  = `emojiPicker-${postEmojiId}`;

  div.innerHTML = `
    <h3>${escapeHtml(p.title)}</h3>
    <div class="tags">Автор: ${escapeHtml(p.authorLogin)} | Теги: ${escapeHtml(p.tags) || '—'} | ${String(p.visibility) === 'tag' ? '🔒 скрытый' : 'публичный'}</div>
    <p>${escapeHtml(p.content)}</p>
    ${canEdit ? `
      <button class="btn btn-ghost" onclick="editPost(${p.id})">✏️ Редактировать</button>
      <button class="btn btn-ghost" onclick="removePost(${p.id})">🗑 Удалить</button>
    ` : ''}
    <h4>Комментарии</h4>
    <div id="comments-${p.id}"></div>
    ${currentUser ? `
      <div class="editor-wrap">
        <input id="${postEmojiId}" placeholder="Ваш комментарий">
        <div class="emoji-bar">
          <span class="emoji-bar-label">Смайлы:</span>
          <button type="button" class="emoji-btn" onclick="insertEmoji('${postEmojiId}','😀')">😀</button>
          <button type="button" class="emoji-btn" onclick="insertEmoji('${postEmojiId}','😄')">😄</button>
          <button type="button" class="emoji-btn" onclick="insertEmoji('${postEmojiId}','😂')">😂</button>
          <button type="button" class="emoji-btn" onclick="insertEmoji('${postEmojiId}','😊')">😊</button>
          <button type="button" class="emoji-btn" onclick="insertEmoji('${postEmojiId}','👍')">👍</button>
          <button type="button" class="emoji-btn" onclick="insertEmoji('${postEmojiId}','🔥')">🔥</button>
          <button type="button" class="emoji-btn" onclick="insertEmoji('${postEmojiId}','❤️')">❤️</button>
          <button type="button" class="emoji-btn emoji-more" onclick="toggleEmojiPicker('${postEmojiId}')">😀 ▾</button>
        </div>
        <div id="${postPickerId}" class="emoji-picker" style="display:none"></div>
      </div>
      <div class="btn-row">
        <button class="btn btn-primary" onclick="addComment(${p.id})">Отправить</button>
      </div>
    ` : '<p class="muted"><i>Войдите, чтобы комментировать</i></p>'}
  `;

  // Комментарии грузим отдельно — ошибка не должна валить весь пост
  try {
    const comments = await api('getComments', { postId: p.id });
    const cBox = div.querySelector(`#comments-${p.id}`);
    for (const c of comments) {
      const canDelC = currentUser && (
        currentUser.role === 'admin' ||
        currentUser.role === 'editor' ||
        (currentUser.role === 'user' && c.authorId == currentUser.id)
      );
      const el = document.createElement('div');
      el.className = 'comment';
      el.innerHTML = `<span><b>${escapeHtml(c.authorLogin)}:</b> ${escapeHtml(c.text)}</span>
        ${canDelC ? `<button onclick="removeComment(${c.id})" title="Удалить">🗑</button>` : ''}`;
      cBox.appendChild(el);
    }
  } catch (e) {
    console.error('getComments failed:', e);
  }

  return div;
}

async function createPost() {
  try {
    await api('createPost', {
      userId: currentUser.id,
      title: document.getElementById('pTitle').value,
      content: document.getElementById('pContent').value,
      tags: document.getElementById('pTags').value,
      visibility: document.getElementById('pVisibility').value
    });
    document.getElementById('pTitle').value = '';
    document.getElementById('pContent').value = '';
    document.getElementById('pTags').value = '';
    renderPosts();
  } catch (e) { alert('❌ ' + e.message); }
}

async function editPost(postId) {
  const post = cachedPosts.find(p => p.id == postId);
  if (!post) return;
  const title = prompt('Заголовок:', post.title);
  if (title === null) return;
  const content = prompt('Текст:', post.content);
  if (content === null) return;
  const tags = prompt('Теги:', post.tags);
  if (tags === null) return;
  const visibility = prompt('visibility (public/tag):', post.visibility);
  if (visibility === null) return;
  try {
    await api('updatePost', {
      userId: currentUser.id, postId, title, content, tags, visibility
    });
    renderPosts();
  } catch (e) { alert('❌ ' + e.message); }
}

async function removePost(postId) {
  if (!confirm('Удалить пост?')) return;
  try {
    await api('deletePost', { userId: currentUser.id, postId });
    renderPosts();
  } catch (e) { alert('❌ ' + e.message); }
}

async function findByTag() {
  const tag = document.getElementById('searchTag').value.trim();
  if (!tag) return;
  try {
    const p = await api('getPostByTag', {
      tag,
      viewerRole: currentUser ? currentUser.role : 'guest',
      viewerId: currentUser ? currentUser.id : null
    });
    const box = document.getElementById('postsBox');
    box.innerHTML = '';
    box.appendChild(await renderPost(p));
  } catch (e) { alert('❌ ' + e.message); }
}

// --------- КОММЕНТАРИИ ---------
async function addComment(postId) {
  const input = document.getElementById(`cInput-${postId}`);
  if (!input || !input.value.trim()) return;
  try {
    await api('createComment', {
      userId: currentUser.id, postId, text: input.value
    });
    renderPosts();
  } catch (e) { alert('❌ ' + e.message); }
}

async function removeComment(commentId) {
  if (!confirm('Удалить комментарий?')) return;
  try {
    await api('deleteComment', { userId: currentUser.id, commentId });
    renderPosts();
  } catch (e) { alert('❌ ' + e.message); }
}

// --------- АДМИНКА ---------
async function loadAdmin() {
  try {
    const users = await api('getAllUsers', { userId: currentUser.id });
    const box = document.getElementById('adminBox');
    box.innerHTML = '<h3 style="margin-top:0">Пользователи</h3>';
    for (const u of users) {
      const row = document.createElement('div');
      row.className = 'admin-row';
      const canPost = toBool(u.canPost);
      const canComment = toBool(u.canComment);
      const status = String(u.status || '').trim().toLowerCase();
      row.innerHTML = `
        <b>${escapeHtml(u.login)}</b> — роль: ${escapeHtml(u.role)}, статус: ${escapeHtml(u.status)},
        посты: ${canPost ? 'TRUE' : 'FALSE'}, комменты: ${canComment ? 'TRUE' : 'FALSE'}
        ${status === 'pending' ? `<button onclick="adminApprove(${u.id})">✅ Одобрить</button>` : ''}
        <button onclick="adminBlock(${u.id})">🚫 Заблокировать</button>
        <button onclick="adminSetRole(${u.id},'editor')">Сделать редактором</button>
        <button onclick="adminSetRole(${u.id},'user')">Сделать пользователем</button>
        <button onclick="adminToggle(${u.id},'canPost',${canPost ? 'false' : 'true'})">Переключить посты</button>
        <button onclick="adminToggle(${u.id},'canComment',${canComment ? 'false' : 'true'})">Переключить комменты</button>
      `;
      box.appendChild(row);
    }
  } catch (e) { alert('❌ ' + e.message); }
}

async function adminApprove(targetId) {
  try {
    await api('approveUser', { userId: currentUser.id, targetId });
    loadAdmin();
  } catch (e) { alert('❌ ' + e.message); }
}

async function adminBlock(targetId) {
  try {
    await api('blockUser', { userId: currentUser.id, targetId });
    loadAdmin();
  } catch (e) { alert('❌ ' + e.message); }
}

async function adminSetRole(targetId, role) {
  try {
    await api('setRole', { userId: currentUser.id, targetId, role });
    loadAdmin();
  } catch (e) { alert('❌ ' + e.message); }
}

async function adminToggle(targetId, field, value) {
  try {
    await api('togglePermission', { userId: currentUser.id, targetId, field, value });
    loadAdmin();
  } catch (e) { alert('❌ ' + e.message); }
}

// --------- СТАРТ ---------
window.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('blogUser');
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      afterLogin();
    } catch (e) {
      console.error('Не удалось прочитать сохранённого пользователя:', e);
      localStorage.removeItem('blogUser');
      renderPosts();
    }
  } else {
    renderPosts();
  }
});
