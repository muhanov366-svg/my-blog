// ⚠️ Вставь сюда URL своего Web App (из Apps Script)
const API_URL = 'https://script.google.com/macros/s/AKfycby8dzAEp1syzBKkEFkn5Bkb-sE17ITESEwQ7TUdl4bu8lFtYHHwh8m0kBZeNpfdmlX6/exec';

let currentUser = null; // {id, login, role, canPost, canComment}
let cachedPosts = [];

// --------- API ---------
async function api(action, data = {}) {
  const res = await fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify({ action, data }),
    // важно: без headers, чтобы не было preflight
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error);
  return json.data;
}

// --------- АВТОРИЗАЦИЯ ---------
async function doLogin() {
  const login = document.getElementById('loginInput').value.trim();
  const password = document.getElementById('passInput').value;
  try {
    const user = await api('login', { login, password });
    currentUser = user;
    localStorage.setItem('blogUser', JSON.stringify(user));
    afterLogin();
    document.getElementById('authMsg').textContent = 'Успешный вход!';
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
  document.getElementById('authBox').innerHTML =
    `${currentUser.login} (${currentUser.role}) <button onclick="logout()">Выйти</button>`;

  if (currentUser.role === 'admin') {
    document.getElementById('adminSection').style.display = 'block';
    loadAdmin();
  }
  renderPosts();
}

// --------- ПОСТЫ ---------
async function loadPosts() {
  cachedPosts = await api('getPosts', { viewerRole: currentUser ? currentUser.role : 'guest' });
}

async function renderPosts() {
  await loadPosts();
  const sort = document.getElementById('sortSelect').value;
  let posts = [...cachedPosts];

  if (sort === 'new') posts.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (sort === 'old') posts.sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
  if (sort === 'title') posts.sort((a,b) => a.title.localeCompare(b.title));
  if (sort === 'author') posts.sort((a,b) => a.authorLogin.localeCompare(b.authorLogin));

  const box = document.getElementById('postsBox');
  box.innerHTML = '';
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

  div.innerHTML = `
    <h3>${escapeHtml(p.title)}</h3>
    <div class="tags">Автор: ${escapeHtml(p.authorLogin)} | Теги: ${escapeHtml(p.tags) || '—'} | ${p.visibility === 'tag' ? '🔒 скрытый' : 'публичный'}</div>
    <p>${escapeHtml(p.content)}</p>
    ${canEdit ? `
      <button onclick="editPost(${p.id})">✏️ Редактировать</button>
      <button onclick="removePost(${p.id})">🗑 Удалить</button>
    ` : ''}
    <h4>Комментарии</h4>
    <div id="comments-${p.id}"></div>
    ${currentUser ? `
      <input id="cInput-${p.id}" placeholder="Ваш комментарий">
      <button onclick="addComment(${p.id})">Отправить</button>
    ` : '<p><i>Войдите, чтобы комментировать</i></p>'}
  `;

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
    el.innerHTML = `<b>${escapeHtml(c.authorLogin)}:</b> ${escapeHtml(c.text)}
      ${canDelC ? `<button onclick="removeComment(${c.id})">🗑</button>` : ''}`;
    cBox.appendChild(el);
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
    const p = await api('getPostByTag', { tag, viewerRole: currentUser ? currentUser.role : 'guest' });
    const box = document.getElementById('postsBox');
    box.innerHTML = '';
    box.appendChild(await renderPost(p));
  } catch (e) { alert('❌ ' + e.message); }
}

// --------- КОММЕНТАРИИ ---------
async function addComment(postId) {
  const input = document.getElementById(`cInput-${postId}`);
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
    box.innerHTML = '<h3>Пользователи</h3>';
    for (const u of users) {
      const row = document.createElement('div');
      row.className = 'admin-row';
      row.innerHTML = `
        <b>${escapeHtml(u.login)}</b> — роль: ${u.role}, статус: ${u.status},
        посты: ${u.canPost}, комменты: ${u.canComment}
        ${u.status === 'pending' ? `<button onclick="adminApprove(${u.id})">✅ Одобрить</button>` : ''}
        <button onclick="adminBlock(${u.id})">🚫 Заблокировать</button>
        <button onclick="adminSetRole(${u.id},'editor')">Сделать редактором</button>
        <button onclick="adminSetRole(${u.id},'user')">Сделать пользователем</button>
        <button onclick="adminToggle(${u.id},'canPost',${u.canPost === 'TRUE' ? 'false' : 'true'})">Переключить посты</button>
        <button onclick="adminToggle(${u.id},'canComment',${u.canComment === 'TRUE' ? 'false' : 'true'})">Переключить комменты</button>
      `;
      box.appendChild(row);
    }
  } catch (e) { alert('❌ ' + e.message); }
}

async function adminApprove(targetId) {
  await api('approveUser', { userId: currentUser.id, targetId });
  loadAdmin();
}
async function adminBlock(targetId) {
  await api('blockUser', { userId: currentUser.id, targetId });
  loadAdmin();
}
async function adminSetRole(targetId, role) {
  await api('setRole', { userId: currentUser.id, targetId, role });
  loadAdmin();
}
async function adminToggle(targetId, field, value) {
  await api('togglePermission', { userId: currentUser.id, targetId, field, value });
  loadAdmin();
}

// --------- УТИЛИТЫ ---------
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, m => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]
  ));
}

// --------- СТАРТ ---------
window.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('blogUser');
  if (saved) {
    currentUser = JSON.parse(saved);
    afterLogin();
  } else {
    renderPosts();
  }
});
