// ================================================================
//  STACKR — Main Application
//  The developer social platform
//  No synthetic data — everything comes from Supabase
// ================================================================

// ── CONFIG ───────────────────────────────────────────────────
const CONFIG = {
  SUPABASE_URL:  'https://ubfdzrhrbomeqjkyvhlv.supabase.co',
  SUPABASE_ANON: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InViZmR6cmhyYm9tZXFqa3l2aGx2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDY0NDUsImV4cCI6MjA4OTkyMjQ0NX0.vgBvEYNMj_KTiVgSgOSKDoHuxZ5jC_N-NBptQyrtkPQ',
  // Claude API key lives in Supabase Edge Function — never here
  // GitHub OAuth secret lives in Supabase dashboard — never here
};

// ── SUPABASE CLIENT ──────────────────────────────────────────
const { createClient } = supabase;
const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON);

// ── APP STATE ────────────────────────────────────────────────
const App = {
  user:          null,   // Supabase auth user
  profile:       null,   // profiles row
  isGuest:       false,
  page:          'feed',
  feedTab:       'for-you',
  feedCursor:    null,
  chatPartner:   null,
  viewingProfile: null,  // profile being viewed
  viewingWorkspace: null,
  _pendingUpload: null,
  _pendingPoll:   null,
  _pendingWorkflow: null,
  _pendingRepo:   null,
  _postTags:      [],
  _realtimeSubs:  [],    // active realtime subscriptions
};

// ── DOM HELPERS ───────────────────────────────────────────────
const $  = (s, ctx = document) => ctx.querySelector(s);
const $$ = (s, ctx = document) => [...ctx.querySelectorAll(s)];

// ── TOAST ────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3500) {
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span>${escapeHtml(msg)}</span>`;
  $('#toast-container').appendChild(el);
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ── UTILITIES ────────────────────────────────────────────────
function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60)     return 'just now';
  if (diff < 3600)   return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400)  return `${Math.floor(diff/3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff/86400)}d ago`;
  return d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
}

function formatNumber(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n/1000000).toFixed(1).replace('.0','') + 'M';
  if (n >= 1000)    return (n/1000).toFixed(1).replace('.0','') + 'k';
  return String(n);
}

function getInitials(name = '') {
  return (name || '').split(' ').filter(Boolean).map(w => w[0]).join('').substring(0,2).toUpperCase() || '?';
}

function formatBody(text = '') {
  return escapeHtml(text)
    .replace(/(#[\w]+)/g, '<span class="hashtag" onclick="vibeSearch(\'$1\'.slice(1))">$1</span>')
    .replace(/@([\w\-]+)/g, '<span class="mention" onclick="openProfile(\'$1\')">@$1</span>')
    .replace(/\n/g, '<br>');
}

function avatarHTML(profile, size = 'md') {
  const init = getInitials(profile?.full_name || profile?.username || '');
  const src  = profile?.avatar_url;
  const color = profile?.avatar_color || '#6366f1';
  return `<div class="avatar avatar-${size}" style="background:${color}20;color:${color}">
    ${src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(init)}" loading="lazy" onerror="this.style.display='none'">` : init}
  </div>`;
}

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 240) + 'px';
}

function updateCharCount(el) {
  const max = parseInt(el.maxLength) || 2000;
  const left = max - el.value.length;
  const counter = $('#char-count');
  if (!counter) return;
  counter.textContent = left;
  counter.className = 'char-count' + (left < 50 ? ' danger' : left < 200 ? ' warning' : '');
}

function debounce(fn, delay = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

function slugify(s = '') {
  return s.toLowerCase().replace(/[^a-z0-9\-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g,'');
}

function extractYouTubeId(url = '') {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) { const m = url.match(p); if (m) return m[1]; }
  return null;
}

function isGitHubRepoUrl(url = '') {
  return /^https?:\/\/github\.com\/[\w\-\.]+\/[\w\-\.]+\/?$/.test(url.trim());
}

// ── PAGE ROUTER ───────────────────────────────────────────────
function showSection(name) {
  $$('.section-panel').forEach(p => p.classList.add('hidden'));
  const el = $(`#section-${name}`);
  if (el) el.classList.remove('hidden');
  App.page = name;
  window.scrollTo(0,0);
}

function sNav(name) {
  // Map nav names to section names
  const sectionMap = {
    'feed':           'feed',
    'explore':        'explore',
    'notifications':  'notifications',
    'messages':       'messages',
    'workspaces':     'workspaces',
    'discussions':    'discussions',
    'bookmarks':      'bookmarks',
    'profile-self':   'profile',
    'admin':          'admin',
  };
  const section = sectionMap[name] || name;
  showSection(section);

  // Update sidebar active
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === name));
  $$('.mobile-nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === name));
}

function goBack() {
  sNav('feed');
  loadFeed();
}

// ── AUTH INIT ────────────────────────────────────────────────
async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    App.user = session.user;
    await loadProfile();
    enterApp();
  } else {
    showPage('landing');
  }

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      App.user = session.user;
      await loadProfile();
      closeModal('modal-auth');
      enterApp();
    } else if (event === 'SIGNED_OUT') {
      App.user = null; App.profile = null; App.isGuest = false;
      cleanupRealtime();
      showPage('landing');
    }
  });
}

function showPage(name) {
  $$('.page').forEach(p => p.classList.remove('active'));
  const el = $(`#page-${name}`);
  if (el) el.classList.add('active');
}

// ── PROFILE LOAD ──────────────────────────────────────────────
async function loadProfile() {
  const { data, error } = await sb
    .from('profiles').select('*').eq('id', App.user.id).single();

  if (data) {
    App.profile = data;
    // Auto-grant admin to owner email
    if (data.email === 'kuteesajoshua200@gmail.com' && !data.is_admin) {
      await sb.from('profiles').update({ is_admin: true }).eq('id', App.user.id);
      App.profile.is_admin = true;
    }
  } else if (error?.code === 'PGRST116') {
    // Profile missing — shouldn't happen with trigger but handle gracefully
    const meta = App.user.user_metadata || {};
    const base = meta.user_name || meta.preferred_username ||
                 (App.user.email || '').split('@')[0] || 'dev';
    const username = base.toLowerCase().replace(/[^a-z0-9_\-]/g,'').substring(0,20) || 'dev';
    const { data: np } = await sb.from('profiles').insert({
      id:             App.user.id,
      username:       username + Math.floor(Math.random()*1000),
      full_name:      meta.full_name || meta.name || username,
      email:          App.user.email,
      avatar_url:     meta.avatar_url || null,
      github_username: meta.user_name || null,
      github_id:      meta.provider_id || null,
      ref_code:       username.toUpperCase().substring(0,6) + Math.floor(Math.random()*9000+1000),
    }).select().single();
    App.profile = np;
  }
}

// ── ENTER APP ─────────────────────────────────────────────────
function enterApp() {
  App.isGuest = false;
  showPage('feed');
  updateSidebarProfile();
  loadFeed();
  loadUnreadCounts();
  loadRightPanel();
  subscribeRealtime();
  setInterval(loadUnreadCounts, 30000);

  // Show onboarding if first time
  if (App.profile && !App.profile.onboarding_done) {
    setTimeout(() => openOnboarding(), 800);
  }

  // Reveal admin nav if admin
  if (App.profile?.is_admin) {
    $('#nav-admin-section')?.classList.remove('hidden');
    $('#nav-admin-item')?.classList.remove('hidden');
  }

  // Sync GitHub repos if logged in via GitHub and not recently synced
  if (App.profile?.github_username) {
    const lastSync = App.profile.github_synced_at;
    const hourAgo  = Date.now() - 3600000;
    if (!lastSync || new Date(lastSync) < hourAgo) {
      syncGitHubRepos();
    }
  }
}

// ── GUEST MODE ────────────────────────────────────────────────
function enterGuest() {
  App.isGuest = true;
  showPage('feed');
  updateSidebarProfile();
  loadFeed();
  loadRightPanel();
  $('#guest-banner')?.classList.remove('hidden');
  $$('.member-only-nav').forEach(el => el.classList.add('hidden'));
  $$('.member-only-btn').forEach(el => el.classList.add('hidden'));
  $('#signout-btn')?.classList.add('hidden');
}

// ── SIGN OUT ──────────────────────────────────────────────────
async function signOut() {
  await sb.auth.signOut();
  App.isGuest = false;
  toast('Signed out', 'info');
}

// ── SIDEBAR ───────────────────────────────────────────────────
function updateSidebarProfile() {
  const p = App.profile;
  const name = App.isGuest ? 'Guest' : (p?.full_name || p?.username || 'Developer');
  const role = App.isGuest ? 'browsing only' :
    (p?.is_admin ? '👑 Admin' : (p?.role || 'Developer'));

  $('#sidebar-avatar').innerHTML = App.isGuest
    ? `<div class="avatar avatar-sm" style="background:var(--bg3);color:var(--text3)">?</div>`
    : avatarHTML(p, 'sm');
  $('#sidebar-name').textContent = name;
  $('#sidebar-role').textContent = role;

  // Composer avatar
  const ca = $('#composer-avatar');
  if (ca) ca.innerHTML = App.isGuest
    ? `<div class="avatar avatar-md" style="background:var(--bg3);color:var(--text3)">?</div>`
    : avatarHTML(p, 'md');

  const ca2 = $('#comment-composer-avatar');
  if (ca2) ca2.innerHTML = avatarHTML(p, 'sm');
}

// ── AUTH FLOWS ────────────────────────────────────────────────
function openAuthModal(tab = 'signup') {
  openModal('modal-auth');
  switchAuthTab(tab);
}

function switchAuthTab(tab) {
  const isSignup = tab === 'signup';
  $('#auth-tab-signup').classList.toggle('active', isSignup);
  $('#auth-tab-login').classList.toggle('active', !isSignup);
  $('#auth-signup-form').classList.toggle('hidden', !isSignup);
  $('#auth-login-form').classList.toggle('hidden', isSignup);
}

async function signInWithGitHub() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: window.location.origin }
  });
  if (error) toast(error.message, 'error');
}

async function signInWithGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
  if (error) toast(error.message, 'error');
}

async function signUpWithEmail() {
  const name  = $('#signup-name')?.value.trim();
  const email = $('#signup-email')?.value.trim();
  const pass  = $('#signup-password')?.value;

  if (!name)  { toast('Enter your name', 'error'); return; }
  if (!email) { toast('Enter your email', 'error'); return; }
  if (!pass || pass.length < 8) { toast('Password must be at least 8 characters', 'error'); return; }

  const btn = $('#signup-btn');
  btn.disabled = true; btn.textContent = 'Creating account…';

  const { error } = await sb.auth.signUp({
    email, password: pass,
    options: { data: { full_name: name } }
  });

  btn.disabled = false; btn.textContent = 'Create account';
  if (error) { toast(error.message, 'error'); return; }
  toast('Check your email to confirm your account!', 'success', 6000);
}

async function signInWithEmail() {
  const email = $('#login-email')?.value.trim();
  const pass  = $('#login-password')?.value;
  if (!email || !pass) { toast('Fill in all fields', 'error'); return; }

  const btn = $('#login-btn');
  btn.disabled = true; btn.textContent = 'Signing in…';

  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  btn.disabled = false; btn.textContent = 'Sign in';
  if (error) { toast(error.message, 'error'); return; }
}

async function sendPasswordReset() {
  const email = $('#login-email')?.value.trim();
  if (!email) { toast('Enter your email first', 'error'); return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '?reset=1'
  });
  if (error) { toast(error.message, 'error'); return; }
  toast('Password reset email sent!', 'success');
}

// ── GITHUB REPO SYNC ──────────────────────────────────────────
async function syncGitHubRepos() {
  if (!App.profile?.github_username) return;
  try {
    const res = await fetch(
      `https://api.github.com/users/${App.profile.github_username}/repos?sort=updated&per_page=6`
    );
    if (!res.ok) return;
    const repos = await res.json();
    const pinned = repos.slice(0, 6).map(r => ({
      name:        r.name,
      full_name:   r.full_name,
      description: r.description || '',
      url:         r.html_url,
      stars:       r.stargazers_count,
      forks:       r.forks_count,
      language:    r.language,
      updated_at:  r.updated_at,
      topics:      r.topics || [],
    }));
    await sb.from('profiles').update({
      pinned_repos:     pinned,
      github_synced_at: new Date().toISOString(),
    }).eq('id', App.user.id);
    App.profile.pinned_repos = pinned;
  } catch {}
}

// Fetch a single GitHub repo by URL
async function fetchGitHubRepo(url = '') {
  const match = url.trim().match(/github\.com\/([\w\-\.]+)\/([\w\-\.]+)/);
  if (!match) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${match[1]}/${match[2]}`);
    if (!res.ok) return null;
    const r = await res.json();
    return {
      name:        r.name,
      full_name:   r.full_name,
      description: r.description || '',
      url:         r.html_url,
      stars:       r.stargazers_count,
      forks:       r.forks_count,
      language:    r.language,
      updated_at:  r.updated_at,
      topics:      r.topics || [],
      license:     r.license?.spdx_id || null,
    };
  } catch { return null; }
}

// ── REALTIME SUBSCRIPTIONS ────────────────────────────────────
function subscribeRealtime() {
  if (!App.user) return;
  cleanupRealtime();

  // Notifications
  const notifSub = sb.channel('notifs')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${App.user.id}`
    }, () => loadUnreadCounts())
    .subscribe();

  // Messages
  const msgSub = sb.channel('msgs')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `receiver_id=eq.${App.user.id}`
    }, (payload) => {
      loadUnreadCounts();
      if (App.chatPartner?.id === payload.new.sender_id) {
        appendChatBubble(payload.new, false);
        markMessagesRead(payload.new.sender_id);
      }
    })
    .subscribe();

  App._realtimeSubs = [notifSub, msgSub];
}

function cleanupRealtime() {
  App._realtimeSubs.forEach(s => sb.removeChannel(s));
  App._realtimeSubs = [];
}

// ── UNREAD COUNTS ─────────────────────────────────────────────
async function loadUnreadCounts() {
  if (!App.user || App.isGuest) return;
  try {
    const [n, m] = await Promise.all([
      sb.from('notifications').select('id', { count:'exact', head:true })
        .eq('user_id', App.user.id).eq('is_read', false),
      sb.from('messages').select('id', { count:'exact', head:true })
        .eq('receiver_id', App.user.id).eq('is_read', false),
    ]);
    const nc = n.count || 0, mc = m.count || 0;
    setbadge('notif-badge', nc);
    setbadge('msg-badge', mc);
    setMobileBadge('mob-notif-badge', nc);
  } catch {}
}

function setBadge(id, count) {
  const el = $(`#${id}`);
  if (!el) return;
  el.textContent = count;
  el.classList.toggle('hidden', count === 0);
}
const setbadge = setBadge; // alias

function setMobileBadge(id, count) {
  const el = $(`#${id}`);
  if (!el) return;
  el.textContent = count;
  el.classList.toggle('hidden', count === 0);
}

// ── RIGHT PANEL ───────────────────────────────────────────────
async function loadRightPanel() {
  loadTrendingTags();
  loadSuggestedPeople();
}

async function loadTrendingTags() {
  const el = $('#trending-tags-list');
  if (!el) return;
  // Get most used tags from recent posts
  const { data } = await sb.from('posts')
    .select('tags').eq('is_deleted', false)
    .order('created_at', { ascending: false }).limit(100);

  const counts = {};
  (data || []).forEach(p => (p.tags || []).forEach(t => {
    counts[t] = (counts[t] || 0) + 1;
  }));
  const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0,8);

  if (!sorted.length) { el.innerHTML = '<p style="font-size:.78rem;color:var(--text3);padding:.5rem 0">No trending tags yet.</p>'; return; }
  el.innerHTML = sorted.map(([tag, count]) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:.45rem 0;cursor:pointer"
      onclick="sNav('explore'); initExplore(); vibeSearch('${escapeHtml(tag)}')">
      <span style="font-family:var(--font-mono);font-size:.8rem;color:var(--accent2)">#${escapeHtml(tag)}</span>
      <span style="font-family:var(--font-mono);font-size:.7rem;color:var(--text3)">${formatNumber(count)} posts</span>
    </div>`).join('');
}

async function loadSuggestedPeople() {
  const el = $('#suggested-people-list');
  if (!el || App.isGuest) return;

  let query = sb.from('profiles')
    .select('id, username, full_name, avatar_url, avatar_color, is_verified, role, followers_count')
    .eq('status', 'active').eq('is_bot', false)
    .order('followers_count', { ascending: false }).limit(5);

  if (App.user) query = query.neq('id', App.user.id);

  const { data } = await query;
  if (!data?.length) { el.innerHTML = ''; return; }

  el.innerHTML = (data || []).map(p => `
    <div class="person-item" onclick="openProfile('${p.username}')">
      ${avatarHTML(p, 'sm')}
      <div class="person-info">
        <div class="person-name">
          ${escapeHtml(p.full_name || p.username)}
          ${p.is_verified ? '<span class="verified-badge"></span>' : ''}
        </div>
        <div class="person-handle">@${escapeHtml(p.username)}</div>
      </div>
      ${App.user ? `<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();toggleFollow('${p.id}',this)">Follow</button>` : ''}
    </div>`).join('');
}

// ── FEED ──────────────────────────────────────────────────────
async function loadFeed(tab = 'for-you', tabEl = null, append = false) {
  App.feedTab = tab;

  // Update tab UI
  if (tabEl) {
    $$('.feed-tabs .feed-tab').forEach(t => t.classList.remove('active'));
    tabEl.classList.add('active');
  }

  const container = $('#feed-posts');
  if (!container) return;
  if (!append) {
    container.innerHTML = skeletonPosts(4);
    App.feedCursor = null;
  }

  try {
    let query = sb.from('posts').select(`
      id, body, post_type, media_url, media_name, yt_url, yt_thumbnail,
      link_url, link_preview, repo_data, workflow_data, poll_data,
      tags, likes_count, comments_count, saves_count,
      is_bot_post, bot_source, created_at,
      profiles:user_id (id, username, full_name, avatar_url, avatar_color, is_verified, is_bot, role)
    `)
    .eq('is_deleted', false)
    .eq('is_flagged', false)
    .order('created_at', { ascending: false })
    .limit(20);

    // Filter by type
    if (tab === 'repos')     query = query.eq('post_type', 'repo');
    if (tab === 'workflows') query = query.eq('post_type', 'workflow');

    // Following tab
    if (tab === 'following' && App.user) {
      const { data: follows } = await sb.from('follows')
        .select('following_id').eq('follower_id', App.user.id);
      const ids = (follows || []).map(f => f.following_id);
      if (!ids.length) {
        container.innerHTML = `<div class="empty-state">
          <div class="empty-state-icon">👥</div>
          <h3>Nobody followed yet</h3>
          <p>Follow developers to see their posts here.</p>
          <button class="btn btn-primary" onclick="sNav('explore'); initExplore()">Explore developers</button>
        </div>`;
        return;
      }
      query = query.in('user_id', ids);
    }

    // Cursor pagination
    if (append && App.feedCursor) {
      query = query.lt('created_at', App.feedCursor);
    }

    const { data: posts, error } = await query;
    if (error) throw error;

    if (!append) container.innerHTML = '';

    if (!posts?.length && !append) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <h3>Nothing here yet</h3>
        <p>Be the first to share something with the community!</p>
      </div>`;
      $('#load-more-wrap')?.classList.add('hidden');
      return;
    }

    // Get user's reactions for these posts
    let myReactions = {};
    let mySaved = new Set();
    if (App.user && posts?.length) {
      const [rxnRes, savedRes] = await Promise.all([
        sb.from('post_reactions').select('post_id, reaction_type')
          .eq('user_id', App.user.id).in('post_id', posts.map(p => p.id)),
        sb.from('saved_posts').select('post_id')
          .eq('user_id', App.user.id).in('post_id', posts.map(p => p.id)),
      ]);
      (rxnRes.data || []).forEach(r => {
        if (!myReactions[r.post_id]) myReactions[r.post_id] = new Set();
        myReactions[r.post_id].add(r.reaction_type);
      });
      (savedRes.data || []).forEach(s => mySaved.add(s.post_id));
    }

    posts.forEach(post => {
      container.insertAdjacentHTML('beforeend',
        renderPost(post, myReactions[post.id] || new Set(), mySaved.has(post.id))
      );
    });

    if (posts.length) App.feedCursor = posts[posts.length - 1].created_at;
    $('#load-more-wrap')?.classList.toggle('hidden', posts.length < 20);

  } catch (err) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">⚠️</div>
      <h3>Could not load posts</h3>
      <p>${escapeHtml(err.message)}</p>
    </div>`;
  }
}

// ── SKELETON ──────────────────────────────────────────────────
function skeletonPosts(n = 3) {
  return Array(n).fill('').map(() => `
    <div class="post-card">
      <div class="flex gap-3 mb-3">
        <div class="skeleton sk-avatar" style="width:44px;height:44px"></div>
        <div style="flex:1">
          <div class="skeleton sk-line w-40"></div>
          <div class="skeleton sk-line w-20 mt-1"></div>
        </div>
      </div>
      <div class="skeleton sk-line w-full"></div>
      <div class="skeleton sk-line w-full mt-1"></div>
      <div class="skeleton sk-line w-60 mt-1"></div>
    </div>`).join('');
}

// ── RENDER POST ───────────────────────────────────────────────
function renderPost(post, myRxns = new Set(), isSaved = false) {
  const p        = post.profiles || {};
  const isLiked  = myRxns.has('like');
  const body     = formatBody(post.body || '');
  const isOwn    = App.user?.id === p.id;

  // Media
  let mediaHTML = '';
  if (post.yt_url) {
    const vid = extractYouTubeId(post.yt_url);
    if (vid) {
      const thumb = post.yt_thumbnail || `https://img.youtube.com/vi/${vid}/hqdefault.jpg`;
      mediaHTML = `<div class="post-media">
        <div class="yt-thumb" onclick="playYouTube('${vid}',this)">
          <img src="${escapeHtml(thumb)}" alt="Video" loading="lazy">
          <div class="yt-play-btn">
            <svg viewBox="0 0 68 48"><rect width="68" height="48" rx="12" fill="#FF0000" opacity=".9"/><path d="M28 15L45 24L28 33V15Z" fill="white"/></svg>
          </div>
        </div>
      </div>`;
    }
  } else if (post.post_type === 'repo' && post.repo_data) {
    mediaHTML = renderRepoCard(post.repo_data);
  } else if (post.post_type === 'workflow' && post.workflow_data) {
    mediaHTML = renderWorkflowCard(post.workflow_data);
  } else if (post.post_type === 'link' && post.link_preview) {
    mediaHTML = renderLinkCard(post.link_preview, post.link_url);
  } else if (post.media_url) {
    if (post.post_type === 'image') {
      mediaHTML = `<div class="post-media"><img src="${escapeHtml(post.media_url)}" alt="Post image" loading="lazy"></div>`;
    } else if (post.post_type === 'video') {
      mediaHTML = `<div class="post-media">
        <video controls preload="metadata" style="width:100%;max-height:450px;border-radius:var(--radius)">
          <source src="${escapeHtml(post.media_url)}">
        </video>
      </div>`;
    }
  }

  // Poll
  let pollHTML = '';
  if (post.post_type === 'poll' && post.poll_data) {
    pollHTML = renderPollBlock(post.id, post.poll_data);
  }

  // Tags
  const tagsHTML = (post.tags || []).length
    ? `<div class="post-tags">${(post.tags).map(t =>
        `<span class="post-tag" onclick="sNav('explore');initExplore();vibeSearch('${escapeHtml(t)}')">#${escapeHtml(t)}</span>`
      ).join('')}</div>`
    : '';

  // Bot badge
  const botBadge = post.is_bot_post
    ? `<span class="badge badge-bot" style="font-size:.6rem;margin-left:.5rem">BOT</span>`
    : '';

  return `
  <article class="post-card animate-fade-in" data-post-id="${post.id}">
    <div class="post-header">
      <div onclick="openProfile('${escapeHtml(p.username)}')" style="cursor:pointer;flex-shrink:0">
        ${avatarHTML(p, 'md')}
      </div>
      <div class="post-author">
        <div class="post-author-name" onclick="openProfile('${escapeHtml(p.username)}')">
          ${escapeHtml(p.full_name || p.username || 'Unknown')}
          ${p.is_verified ? '<span class="verified-badge"></span>' : ''}
          ${botBadge}
        </div>
        <div class="post-author-meta">
          @${escapeHtml(p.username || '?')}
          <span>·</span>
          ${formatTime(post.created_at)}
          ${p.role ? `<span>· ${escapeHtml(p.role)}</span>` : ''}
        </div>
      </div>
      <div class="post-menu">
        <div class="dropdown">
          <button class="btn btn-icon sm" onclick="toggleDropdown('post-menu-${post.id}')">⋯</button>
          <div class="dropdown-menu" id="post-menu-${post.id}">
            <div class="dropdown-item" onclick="sharePost('${post.id}')">🔗 Copy link</div>
            <div class="dropdown-item" onclick="shareToWhatsApp('${post.id}','${escapeHtml((post.body||'').substring(0,80))}')">📲 Share</div>
            ${App.user ? `<div class="dropdown-item" onclick="savePost('${post.id}',this)">${isSaved ? '🔖 Unsave' : '🔖 Save'}</div>` : ''}
            ${!post.is_bot_post ? `<div class="dropdown-divider"></div><div class="dropdown-item danger" onclick="openReportModal('post','${post.id}')">🚨 Report</div>` : ''}
            ${isOwn ? `<div class="dropdown-item danger" onclick="deletePost('${post.id}')">🗑️ Delete</div>` : ''}
          </div>
        </div>
      </div>
    </div>

    ${post.body ? `<div class="post-body">${body}</div>` : ''}
    ${tagsHTML}
    ${mediaHTML}
    ${pollHTML}

    <div class="reactions">
      <button class="rxn-btn${isLiked ? ' active' : ''}" onclick="reactPost('${post.id}','like',this)">
        ❤️ <span>${formatNumber(post.likes_count)}</span>
      </button>
      <button class="rxn-btn${myRxns.has('insightful') ? ' active' : ''}" onclick="reactPost('${post.id}','insightful',this)">
        💡 Insightful
      </button>
      <button class="rxn-btn${myRxns.has('fire') ? ' active' : ''}" onclick="reactPost('${post.id}','fire',this)">
        🔥 Fire
      </button>
      <button class="rxn-btn${myRxns.has('collab') ? ' active' : ''}" onclick="reactPost('${post.id}','collab',this)">
        🤝 Collab
      </button>
    </div>

    <div class="post-actions">
      <button class="post-action-btn${isLiked ? ' liked' : ''}" onclick="reactPost('${post.id}','like',this)">
        ${isLiked ? '❤️' : '🤍'} <span>${formatNumber(post.likes_count)}</span>
      </button>
      <button class="post-action-btn" onclick="openComments('${post.id}')">
        💬 <span>${formatNumber(post.comments_count)}</span>
      </button>
      <button class="post-action-btn ml-auto" onclick="savePost('${post.id}',this)">
        ${isSaved ? '🔖' : '🏷️'}
      </button>
    </div>
  </article>`;
}

// Render repo card
function renderRepoCard(repo) {
  if (!repo) return '';
  const langColors = {
    JavaScript:'#f1e05a',TypeScript:'#3178c6',Python:'#3572A5',
    Go:'#00ADD8',Rust:'#dea584',Java:'#b07219',Ruby:'#701516',
    'C++':'#f34b7d',C:'#555555',CSS:'#563d7c',HTML:'#e34c26',
    Shell:'#89e051',Kotlin:'#A97BFF',Swift:'#ffac45',Dart:'#00B4AB',
  };
  const color = langColors[repo.language] || '#8b8b8b';
  return `
  <a href="${escapeHtml(repo.url)}" target="_blank" rel="noopener noreferrer" class="repo-card">
    <div class="repo-card-header">
      <svg class="repo-card-icon" viewBox="0 0 16 16" fill="currentColor">
        <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 010-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8zM5 12.25v3.25a.25.25 0 00.4.2l1.45-1.087a.25.25 0 01.3 0L8.6 15.7a.25.25 0 00.4-.2v-3.25a.25.25 0 00-.25-.25h-3.5a.25.25 0 00-.25.25z"/>
      </svg>
      <span class="repo-card-name">${escapeHtml(repo.full_name || repo.name)}</span>
    </div>
    ${repo.description ? `<div class="repo-card-desc">${escapeHtml(repo.description)}</div>` : ''}
    <div class="repo-card-meta">
      ${repo.language ? `<span class="repo-card-stat"><span class="repo-lang-dot" style="background:${color}"></span>${escapeHtml(repo.language)}</span>` : ''}
      <span class="repo-card-stat">⭐ ${formatNumber(repo.stars || 0)}</span>
      <span class="repo-card-stat">🍴 ${formatNumber(repo.forks || 0)}</span>
      ${repo.updated_at ? `<span class="repo-card-stat">Updated ${formatTime(repo.updated_at)}</span>` : ''}
    </div>
  </a>`;
}

// Render workflow card
function renderWorkflowCard(wf) {
  if (!wf) return '';
  const steps = (wf.steps || []).slice(0, 5);
  return `
  <div class="workflow-card">
    <div class="workflow-card-header">
      <div class="workflow-card-badge">⚙️ Workflow</div>
      <div class="workflow-card-title">${escapeHtml(wf.project_name || 'Project Workflow')}</div>
      ${wf.tagline ? `<div class="workflow-card-tagline">${escapeHtml(wf.tagline)}</div>` : ''}
    </div>
    <div class="workflow-card-body">
      ${(wf.stack || []).length ? `
        <div class="workflow-stack">
          ${(wf.stack).map(t => `<span class="post-tag">#${escapeHtml(t)}</span>`).join('')}
        </div>` : ''}
      ${steps.map((s, i) => `
        <div class="workflow-step">
          <div class="workflow-step-num">${i+1}</div>
          <div class="workflow-step-text">${escapeHtml(s)}</div>
        </div>`).join('')}
      ${(wf.steps||[]).length > 5 ? `<p style="font-size:.78rem;color:var(--text3);padding:.5rem 0">+${wf.steps.length-5} more steps</p>` : ''}
    </div>
    <div class="workflow-card-footer">
      <span class="workflow-tools">${wf.tools ? '🛠️ ' + escapeHtml(wf.tools) : ''}</span>
      <span class="workflow-time">${wf.time_taken ? '⏱️ ' + escapeHtml(wf.time_taken) : ''}</span>
    </div>
  </div>`;
}

// Render link preview card
function renderLinkCard(preview, url) {
  if (!preview) return '';
  return `
  <a href="${escapeHtml(url || preview.url || '#')}" target="_blank" rel="noopener noreferrer" class="link-card">
    ${preview.image ? `<img class="link-card-thumb" src="${escapeHtml(preview.image)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
    <div class="link-card-info">
      <div class="link-card-site">${escapeHtml(preview.site_name || new URL(url||'https://x.com').hostname)}</div>
      <div class="link-card-title">${escapeHtml(preview.title || url)}</div>
      ${preview.description ? `<div class="link-card-desc">${escapeHtml(preview.description)}</div>` : ''}
    </div>
  </a>`;
}

// Render poll block
function renderPollBlock(postId, poll) {
  if (!poll) return '';
  const total = (poll.votes || []).reduce((a,b) => a+b, 0);
  const myVote = poll.my_vote_index;
  return `
  <div class="poll-box">
    <div class="poll-question">${escapeHtml(poll.question)}</div>
    ${(poll.options || []).map((opt, i) => {
      const pct   = total > 0 ? Math.round((poll.votes[i]||0)/total*100) : 0;
      const voted = myVote !== undefined;
      const winner = voted && (poll.votes[i] === Math.max(...poll.votes));
      return `<div class="poll-option${voted ? ' voted' : ''}${winner ? ' winner' : ''}"
        onclick="votePoll('${postId}', ${i})">
        <div class="poll-fill" style="width:${voted ? pct : 0}%"></div>
        <div class="poll-label">
          <span>${escapeHtml(opt)}</span>
          ${voted ? `<span class="poll-pct">${pct}%</span>` : ''}
        </div>
      </div>`;
    }).join('')}
    <div style="font-size:.75rem;color:var(--text3);font-family:var(--font-mono);margin-top:.5rem">
      ${formatNumber(total)} votes${myVote === undefined ? ' · tap to vote' : ''}
    </div>
  </div>`;
}

// ── YOUTUBE ───────────────────────────────────────────────────
function playYouTube(videoId, thumbEl) {
  thumbEl.outerHTML = `<div class="yt-embed">
    <iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowfullscreen loading="lazy"></iframe>
  </div>`;
}

// ── REACTIONS ─────────────────────────────────────────────────
async function reactPost(postId, type, btn) {
  if (!App.user) { openAuthModal(); return; }
  if (App.isGuest) { openAuthModal('signup'); return; }
  try {
    const { data: existing } = await sb.from('post_reactions')
      .select('id').eq('post_id', postId).eq('user_id', App.user.id)
      .eq('reaction_type', type).single();

    if (existing) {
      await sb.from('post_reactions').delete().eq('id', existing.id);
      btn.classList.remove('active','liked');
    } else {
      await sb.from('post_reactions').insert({ post_id:postId, user_id:App.user.id, reaction_type:type });
      btn.classList.add('active');
      if (type === 'like') btn.classList.add('liked');
    }
  } catch {}
}

// ── POLL VOTE ─────────────────────────────────────────────────
async function votePoll(postId, optionIndex) {
  if (!App.user) { openAuthModal(); return; }
  if (App.isGuest) { openAuthModal('signup'); return; }

  // Check already voted
  const { data: existing } = await sb.from('poll_votes')
    .select('id').eq('post_id', postId).eq('user_id', App.user.id).single();
  if (existing) { toast('Already voted!', 'info'); return; }

  const { error } = await sb.from('poll_votes')
    .insert({ post_id: postId, user_id: App.user.id, option_index: optionIndex });
  if (error) { toast('Could not vote', 'error'); return; }

  // Re-fetch and re-render poll
  const { data: post } = await sb.from('posts').select('poll_data').eq('id', postId).single();
  if (!post?.poll_data) return;

  // Get all votes
  const { data: allVotes } = await sb.from('poll_votes').select('option_index').eq('post_id', postId);
  const votes = new Array((post.poll_data.options||[]).length).fill(0);
  (allVotes||[]).forEach(v => { if (votes[v.option_index] !== undefined) votes[v.option_index]++; });

  const postEl = $(`[data-post-id="${postId}"] .poll-box`);
  if (postEl) {
    const updated = { ...post.poll_data, votes, my_vote_index: optionIndex };
    postEl.outerHTML = renderPollBlock(postId, updated);
  }
}

// ── SAVE POST ─────────────────────────────────────────────────
async function savePost(postId, btn) {
  if (!App.user || App.isGuest) { openAuthModal(); return; }
  const { data: existing } = await sb.from('saved_posts')
    .select('id').eq('post_id', postId).eq('user_id', App.user.id).single();

  if (existing) {
    await sb.from('saved_posts').delete().eq('id', existing.id);
    if (btn) btn.textContent = '🏷️';
    toast('Removed from bookmarks', 'info');
  } else {
    await sb.from('saved_posts').insert({ post_id: postId, user_id: App.user.id });
    if (btn) btn.textContent = '🔖';
    toast('Saved to bookmarks', 'success');
  }
}

// ── DELETE POST ───────────────────────────────────────────────
async function deletePost(postId) {
  if (!confirm('Delete this post?')) return;
  const { error } = await sb.from('posts').update({ is_deleted: true }).eq('id', postId);
  if (error) { toast(error.message, 'error'); return; }
  $(`[data-post-id="${postId}"]`)?.remove();
  toast('Post deleted', 'success');
}

// ── SHARE ────────────────────────────────────────────────────
function sharePost(postId) {
  const url = `${window.location.origin}?post=${postId}`;
  navigator.clipboard?.writeText(url).then(() => toast('Link copied!', 'success'));
}

function shareToWhatsApp(postId, preview) {
  const url = encodeURIComponent(`${window.location.origin}?post=${postId}`);
  const text = encodeURIComponent(preview + '\n\nvia Stackr\n');
  window.open(`https://wa.me/?text=${text}${url}`, '_blank');
}

// ── COMPOSER ─────────────────────────────────────────────────
function focusComposer() {
  sNav('feed');
  $('#composer-text')?.focus();
}

// Tag input
function toggleTagInput() {
  const area = $('#tag-input-area');
  if (!area) return;
  const isHidden = area.style.display === 'none' || !area.style.display;
  area.style.display = isHidden ? 'flex' : 'none';
  if (isHidden) $('#tag-input')?.focus();
  $('#tag-chip-btn')?.classList.toggle('active', isHidden);
}

function handleTagInput(e) {
  if ((e.key === 'Enter' || e.key === ',') && e.target.value.trim()) {
    e.preventDefault();
    const tag = e.target.value.trim().replace(/^#/, '').replace(/[^a-z0-9_]/gi, '').toLowerCase();
    if (tag && !App._postTags.includes(tag) && App._postTags.length < 5) {
      App._postTags.push(tag);
      renderTagChips();
    }
    e.target.value = '';
  } else if (e.key === 'Backspace' && !e.target.value && App._postTags.length) {
    App._postTags.pop();
    renderTagChips();
  }
}

function renderTagChips() {
  const el = $('#tag-chips');
  if (!el) return;
  el.innerHTML = App._postTags.map((t, i) =>
    `<span class="tag-chip">#${escapeHtml(t)}<span class="tag-chip-remove" onclick="removeTag(${i})">×</span></span>`
  ).join('');
}

function removeTag(i) { App._postTags.splice(i, 1); renderTagChips(); }

// File upload
function triggerFileUpload(type) {
  const input = $('#file-input');
  if (!input) return;
  if (type === 'image') input.accept = 'image/*';
  input.click();
}

async function handleFileSelect(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (!App.user) { openAuthModal(); return; }
  if (file.size > 50 * 1024 * 1024) { toast('File too large (max 50MB)', 'error'); return; }

  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');

  const wrap = $('#upload-preview'), content = $('#upload-preview-content');
  wrap?.classList.remove('hidden');
  content.innerHTML = `<div style="padding:1rem;text-align:center;color:var(--text3)"><span class="animate-spin" style="display:inline-block">⟳</span> Uploading…</div>`;

  try {
    const result = await uploadFile(file, 'uploads');
    App._pendingUpload = {
      url:  result.url,
      name: file.name,
      type: isImage ? 'image' : isVideo ? 'video' : 'resource',
    };
    if (isImage) {
      content.innerHTML = `<img src="${escapeHtml(result.url)}" style="width:100%;max-height:240px;object-fit:cover;border-radius:var(--radius)">`;
    } else {
      content.innerHTML = `<div style="padding:1rem;display:flex;align-items:center;gap:.75rem">
        <span style="font-size:1.5rem">📁</span>
        <span style="font-size:.85rem;color:var(--text2)">${escapeHtml(file.name)}</span>
      </div>`;
    }
    toast('File ready', 'success');
  } catch (err) {
    wrap?.classList.add('hidden');
    toast('Upload failed: ' + err.message, 'error');
  }
}

async function uploadFile(file, bucket = 'uploads') {
  const ext  = file.name.split('.').pop();
  const path = `${App.user.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await sb.storage.from(bucket).upload(path, file, { cacheControl:'3600', upsert:false });
  if (error) throw error;
  const { data: { publicUrl } } = sb.storage.from(bucket).getPublicUrl(path);
  return { url: publicUrl, name: file.name, path };
}

function clearUpload() {
  App._pendingUpload = null;
  $('#upload-preview')?.classList.add('hidden');
  $('#file-input').value = '';
}

function clearLinkPreview() {
  App._pendingLink = null;
  $('#link-preview-wrap')?.classList.add('hidden');
}

function clearWorkflow() {
  App._pendingWorkflow = null;
  $('#workflow-preview')?.classList.add('hidden');
}

function clearPoll() {
  App._pendingPoll = null;
  $('#poll-preview')?.classList.add('hidden');
}

// Auto link detection in composer
const detectLink = debounce(async (text) => {
  const urlMatch = text.match(/https?:\/\/[^\s]+/);
  if (!urlMatch) return;
  const url = urlMatch[0];

  // GitHub repo?
  if (isGitHubRepoUrl(url)) {
    const repo = await fetchGitHubRepo(url);
    if (repo) {
      App._pendingRepo = repo;
      const wrap = $('#link-preview-wrap'), content = $('#link-preview-content');
      if (wrap && content) {
        wrap.classList.remove('hidden');
        content.innerHTML = renderRepoCard(repo);
      }
      return;
    }
  }

  // YouTube?
  const ytId = extractYouTubeId(url);
  if (ytId) {
    const wrap = $('#link-preview-wrap'), content = $('#link-preview-content');
    if (wrap && content) {
      wrap.classList.remove('hidden');
      content.innerHTML = `<div class="yt-thumb" style="pointer-events:none">
        <img src="https://img.youtube.com/vi/${ytId}/hqdefault.jpg" style="width:100%">
      </div>`;
      App._pendingLink = { url, type:'youtube', yt_url:url, yt_thumbnail:`https://img.youtube.com/vi/${ytId}/hqdefault.jpg` };
    }
    return;
  }

  // Generic OG preview — fetch via Supabase Edge Function or fallback
  fetchLinkPreview(url);
}, 800);

async function fetchLinkPreview(url) {
  // Check cache first
  const { data: cached } = await sb.from('link_previews')
    .select('preview_data').eq('url', url).single();
  if (cached) {
    showLinkPreview(cached.preview_data, url);
    App._pendingLink = { url, preview: cached.preview_data, type:'link' };
    return;
  }

  // Fetch via Supabase Edge Function (safe, no CORS issues)
  try {
    const { data, error } = await sb.functions.invoke('fetch-link-preview', { body: { url } });
    if (!error && data?.preview) {
      showLinkPreview(data.preview, url);
      App._pendingLink = { url, preview: data.preview, type:'link' };
      // Cache it
      await sb.from('link_previews').upsert({ url, preview_data: data.preview }).catch(() => {});
    }
  } catch {}
}

function showLinkPreview(preview, url) {
  const wrap = $('#link-preview-wrap'), content = $('#link-preview-content');
  if (!wrap || !content) return;
  wrap.classList.remove('hidden');
  content.innerHTML = renderLinkCard(preview, url);
}

// ── SUBMIT POST ───────────────────────────────────────────────
async function submitPost() {
  if (!App.user || App.isGuest) { openAuthModal(); return; }

  const textarea = $('#composer-text');
  const body     = textarea?.value.trim();
  if (!body && !App._pendingUpload && !App._pendingWorkflow && !App._pendingPoll && !App._pendingRepo) {
    toast('Write something first!', 'error'); return;
  }

  const btn = $('#post-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="animate-spin">⟳</span> Posting…';

  try {
    // AI moderation check
    if (body) {
      const modResult = await moderateContent(body);
      if (modResult.result === 'block') {
        toast(`Post blocked: ${modResult.reason}`, 'error', 6000);
        btn.disabled = false; btn.textContent = 'Post';
        return;
      }
      if (modResult.result === 'review') {
        // Will post but flag for admin review
      }
    }

    // Build post data
    const postData = {
      user_id:   App.user.id,
      body:      body || '',
      post_type: 'text',
      tags:      App._postTags || [],
    };

    // YouTube in body
    const ytId = extractYouTubeId(body || '');
    if (ytId) {
      postData.post_type    = 'video';
      postData.yt_url       = `https://youtube.com/watch?v=${ytId}`;
      postData.yt_thumbnail = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
    }

    // Pending upload
    if (App._pendingUpload) {
      postData.media_url  = App._pendingUpload.url;
      postData.media_name = App._pendingUpload.name;
      postData.post_type  = App._pendingUpload.type;
    }

    // Pending workflow
    if (App._pendingWorkflow) {
      postData.workflow_data = App._pendingWorkflow;
      postData.post_type     = 'workflow';
      // Merge workflow stack into tags
      const wfTags = (App._pendingWorkflow.stack || []).slice(0, 5);
      postData.tags = [...new Set([...postData.tags, ...wfTags])].slice(0, 10);
    }

    // Pending poll
    if (App._pendingPoll) {
      postData.poll_data = App._pendingPoll;
      postData.post_type = 'poll';
    }

    // Pending repo
    if (App._pendingRepo) {
      postData.repo_data = App._pendingRepo;
      postData.post_type = 'repo';
      // Add repo topics as tags
      const repoTags = (App._pendingRepo.topics || []).slice(0, 5);
      postData.tags = [...new Set([...postData.tags, ...repoTags])].slice(0, 10);
    }

    // Pending link
    if (App._pendingLink && postData.post_type === 'text') {
      postData.link_url     = App._pendingLink.url;
      postData.link_preview = App._pendingLink.preview || null;
      postData.yt_url       = App._pendingLink.yt_url || null;
      postData.yt_thumbnail = App._pendingLink.yt_thumbnail || null;
      postData.post_type    = App._pendingLink.type === 'youtube' ? 'video' : 'link';
    }

    const { data, error } = await sb.from('posts').insert(postData).select(`
      id, body, post_type, media_url, media_name, yt_url, yt_thumbnail,
      link_url, link_preview, repo_data, workflow_data, poll_data,
      tags, likes_count, comments_count, saves_count,
      is_bot_post, created_at,
      profiles:user_id (id, username, full_name, avatar_url, avatar_color, is_verified, is_bot, role)
    `).single();

    if (error) throw error;

    // Reset composer
    textarea.value = '';
    textarea.style.height = '';
    App._pendingUpload = App._pendingWorkflow = App._pendingPoll = App._pendingRepo = App._pendingLink = null;
    App._postTags = [];
    clearUpload(); clearLinkPreview(); clearWorkflow(); clearPoll();
    $('#tag-chips').innerHTML = '';
    $('#tag-input-area').style.display = 'none';
    $('#tag-chip-btn')?.classList.remove('active');

    // Prepend to feed
    const container = $('#feed-posts');
    container?.insertAdjacentHTML('afterbegin', renderPost(data, new Set(), false));

    // Points
    await sb.from('profiles').update({ points: (App.profile.points||0)+10 }).eq('id', App.user.id);

    toast('Posted! 🚀', 'success');
  } catch (err) {
    toast('Failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Post';
  }
}

// ── AI MODERATION ─────────────────────────────────────────────
// Calls Supabase Edge Function which holds the Claude API key
async function moderateContent(text) {
  try {
    const { data, error } = await sb.functions.invoke('moderate-content', {
      body: { text, context: 'developer_platform' }
    });
    if (error || !data) return { result: 'clean' }; // fail open — don't block if function unavailable
    return data;
  } catch {
    return { result: 'clean' }; // fail open
  }
}

// ── AI WRITING ASSISTANT ──────────────────────────────────────
function openAiAssist() {
  if (!App.user) { openAuthModal(); return; }
  openModal('modal-ai-assist');
  $('#ai-assist-result')?.classList.add('hidden');
  $('#ai-assist-regen').style.display = 'none';
  $('#ai-assist-use').style.display = 'none';
  $('#ai-assist-btn').style.display = '';
  // Pre-fill prompt with current composer text
  const current = $('#composer-text')?.value.trim();
  if (current) $('#ai-assist-prompt').value = `Help me improve this post: "${current}"`;
}

async function runAiAssist() {
  if (!checkAiRateLimit()) return;
  const prompt = $('#ai-assist-prompt')?.value.trim();
  if (!prompt) { toast('Describe what you want to write', 'error'); return; }

  const btn = $('#ai-assist-btn');
  const regen = $('#ai-assist-regen');
  btn.disabled = true; btn.innerHTML = '<span class="animate-spin">⟳</span> Writing…';

  try {
    const { data, error } = await sb.functions.invoke('ai-writing-assist', {
      body: { prompt, context: 'developer_social_post' }
    });

    if (error || !data?.suggestion) throw new Error('AI assist unavailable');

    const resultEl = $('#ai-assist-result');
    resultEl.textContent = data.suggestion;
    resultEl.classList.remove('hidden');
    regen.style.display = '';
    $('#ai-assist-use').style.display = '';
    btn.style.display = 'none';

  } catch (err) {
    toast('AI assist not available yet — add your Claude API key to Supabase Edge Functions', 'info', 5000);
  } finally {
    btn.disabled = false; btn.innerHTML = 'Generate';
  }
}

function useAiSuggestion() {
  const suggestion = $('#ai-assist-result')?.textContent;
  if (suggestion) {
    const ta = $('#composer-text');
    if (ta) { ta.value = suggestion; autoResizeTextarea(ta); updateCharCount(ta); }
  }
  closeModal('modal-ai-assist');
}

// ── WORKFLOW MODAL ────────────────────────────────────────────
let _wfSteps = [], _wfStack = [];

function openWorkflowModal() {
  if (!App.user) { openAuthModal(); return; }
  _wfSteps = [''];
  _wfStack = [];
  renderWfSteps();
  $('#wf-stack-chips').innerHTML = '';
  openModal('modal-workflow');
}

function renderWfSteps() {
  const el = $('#wf-steps-list');
  if (!el) return;
  el.innerHTML = _wfSteps.map((s, i) => `
    <div class="workflow-step-row">
      <div class="workflow-step-num-input">${i+1}</div>
      <input class="form-control" value="${escapeHtml(s)}"
        placeholder="Step ${i+1}…" maxlength="200"
        oninput="_wfSteps[${i}]=this.value"
        style="flex:1">
      ${_wfSteps.length > 1 ? `<button class="btn btn-icon sm" onclick="removeWfStep(${i})">×</button>` : ''}
    </div>`).join('');
}

function addWorkflowStep()  { _wfSteps.push(''); renderWfSteps(); }
function removeWfStep(i)    { _wfSteps.splice(i,1); renderWfSteps(); }

function handleWfStackInput(e) {
  if ((e.key === 'Enter' || e.key === ',') && e.target.value.trim()) {
    e.preventDefault();
    const tag = e.target.value.trim().replace(/^#/,'').replace(/[^a-z0-9_]/gi,'').toLowerCase();
    if (tag && !_wfStack.includes(tag) && _wfStack.length < 10) {
      _wfStack.push(tag);
      renderWfStackChips();
    }
    e.target.value = '';
  }
}

function renderWfStackChips() {
  const el = $('#wf-stack-chips');
  if (!el) return;
  el.innerHTML = _wfStack.map((t,i) =>
    `<span class="tag-chip">#${escapeHtml(t)}<span class="tag-chip-remove" onclick="_wfStack.splice(${i},1);renderWfStackChips()">×</span></span>`
  ).join('');
}

function confirmWorkflow() {
  const name    = $('#wf-name')?.value.trim();
  const tagline = $('#wf-tagline')?.value.trim();
  if (!name) { toast('Project name is required', 'error'); return; }

  const steps = _wfSteps.filter(s => s.trim());
  if (!steps.length) { toast('Add at least one step', 'error'); return; }

  App._pendingWorkflow = {
    project_name: name,
    tagline:      tagline,
    stack:        [..._wfStack],
    steps,
    tools:        $('#wf-tools')?.value.trim() || '',
    repo_url:     $('#wf-repo')?.value.trim() || '',
    lessons:      $('#wf-lessons')?.value.trim() || '',
    time_taken:   $('#wf-time')?.value.trim() || '',
  };

  // Show preview in composer
  const wrap = $('#workflow-preview'), content = $('#workflow-preview-content');
  if (wrap && content) {
    wrap.classList.remove('hidden');
    content.innerHTML = renderWorkflowCard(App._pendingWorkflow);
  }

  closeModal('modal-workflow');
  toast('Workflow added to post', 'success');
}

// ── POLL MODAL ────────────────────────────────────────────────
function openPollModal() {
  if (!App.user) { openAuthModal(); return; }
  openModal('modal-poll');
}

function addPollOption() {
  const list = $('#poll-options-list');
  const count = list.querySelectorAll('.poll-opt').length + 1;
  if (count > 5) { toast('Maximum 5 options', 'info'); return; }
  const inp = document.createElement('input');
  inp.className = 'form-control mb-2 poll-opt';
  inp.placeholder = `Option ${count}`;
  inp.maxLength = 80;
  list.appendChild(inp);
}

function confirmPoll() {
  const question = $('#poll-question')?.value.trim();
  if (!question) { toast('Enter a question', 'error'); return; }
  const opts = $$('.poll-opt').map(i => i.value.trim()).filter(Boolean);
  if (opts.length < 2) { toast('Add at least 2 options', 'error'); return; }

  App._pendingPoll = {
    question,
    options: opts,
    votes:   new Array(opts.length).fill(0),
  };

  const wrap = $('#poll-preview'), content = $('#poll-preview-content');
  if (wrap && content) {
    wrap.classList.remove('hidden');
    content.innerHTML = renderPollBlock('preview', App._pendingPoll);
  }

  closeModal('modal-poll');
  toast('Poll added to post', 'success');
}

// ── GITHUB REPO MODAL ─────────────────────────────────────────
const debounceRepoFetch = debounce(async (url) => {
  const preview = $('#repo-fetch-preview');
  const btn     = $('#repo-confirm-btn');
  if (!preview || !btn) return;

  if (!isGitHubRepoUrl(url)) {
    preview.innerHTML = '';
    btn.disabled = true;
    return;
  }

  preview.innerHTML = `<p style="font-size:.82rem;color:var(--text3);padding:.5rem 0"><span class="animate-spin" style="display:inline-block">⟳</span> Fetching repo…</p>`;
  btn.disabled = true;

  const repo = await fetchGitHubRepo(url);
  if (repo) {
    preview.innerHTML = renderRepoCard(repo);
    btn.disabled = false;
    App._pendingRepo = repo;
  } else {
    preview.innerHTML = `<p style="font-size:.82rem;color:var(--red)">Could not fetch repo. Check the URL.</p>`;
  }
}, 600);

function openGitHubRepoModal() {
  if (!App.user) { openAuthModal(); return; }
  $('#repo-url-input').value = '';
  $('#repo-fetch-preview').innerHTML = '';
  $('#repo-confirm-btn').disabled = true;
  App._pendingRepo = null;
  openModal('modal-repo');
}

function confirmRepo() {
  if (!App._pendingRepo) return;
  const wrap = $('#link-preview-wrap'), content = $('#link-preview-content');
  if (wrap && content) {
    wrap.classList.remove('hidden');
    content.innerHTML = renderRepoCard(App._pendingRepo);
  }
  closeModal('modal-repo');
  toast('Repo added to post', 'success');
}

// ── COMMENTS ──────────────────────────────────────────────────
async function openComments(postId) {
  openModal('modal-comments');
  $('#comments-post-id').value = postId;
  const list = $('#comments-list');
  list.innerHTML = skeletonPosts(2);

  const { data, error } = await sb.from('comments').select(`
    id, body, created_at,
    profiles:user_id (id, username, full_name, avatar_url, avatar_color, is_verified)
  `).eq('post_id', postId).eq('is_deleted', false)
    .order('created_at', { ascending: true }).limit(50);

  if (error || !data?.length) {
    list.innerHTML = `<div class="empty-state" style="padding:2rem">
      <div class="empty-state-icon">💬</div>
      <p>No comments yet. Be first!</p>
    </div>`;
    return;
  }

  list.innerHTML = data.map(c => `
    <div class="flex gap-3 mb-3">
      ${avatarHTML(c.profiles, 'sm')}
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.2rem">
          <span style="font-weight:600;font-size:.85rem;cursor:pointer" onclick="openProfile('${escapeHtml(c.profiles?.username)}')">
            ${escapeHtml(c.profiles?.full_name || c.profiles?.username || 'User')}
          </span>
          <span style="font-size:.72rem;color:var(--text3);font-family:var(--font-mono)">${formatTime(c.created_at)}</span>
        </div>
        <div style="font-size:.88rem;color:var(--text2);line-height:1.55">${formatBody(c.body)}</div>
      </div>
    </div>`).join('');
}

async function submitComment() {
  if (!App.user || App.isGuest) { openAuthModal(); return; }
  const postId = $('#comments-post-id')?.value;
  const body   = $('#comment-input')?.value.trim();
  if (!body || !postId) return;

  // Moderate
  const mod = await moderateContent(body);
  if (mod.result === 'block') { toast(`Comment blocked: ${mod.reason}`, 'error', 5000); return; }

  const { error } = await sb.from('comments').insert({
    post_id: postId, user_id: App.user.id, body
  });

  if (error) { toast(error.message, 'error'); return; }
  $('#comment-input').value = '';
  openComments(postId); // refresh
  toast('Comment posted', 'success');
}

// ── NOTIFICATIONS ─────────────────────────────────────────────
async function loadNotifications(type = 'all', tabEl = null) {
  if (!App.user || App.isGuest) { openAuthModal(); return; }

  if (tabEl) {
    $$('#section-notifications .feed-tab').forEach(t => t.classList.remove('active'));
    tabEl.classList.add('active');
  }

  const list = $('#notif-list');
  list.innerHTML = skeletonPosts(3);

  let query = sb.from('notifications').select(`
    id, notif_type, title, body, is_read, actor_count, created_at,
    actor:actor_id (username, full_name, avatar_url, avatar_color)
  `).eq('user_id', App.user.id).order('created_at', { ascending: false }).limit(50);

  const typeMap = {
    mention:   ['mention'],
    follow:    ['follow'],
    workspace: ['workspace_post','workspace_join'],
  };
  if (type !== 'all' && typeMap[type]) query = query.in('notif_type', typeMap[type]);

  const { data, error } = await query;

  if (error || !data?.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔔</div><h3>All caught up</h3><p>No notifications yet.</p></div>`;
    return;
  }

  list.innerHTML = data.map(n => {
    const icons = {
      like:'❤️', comment:'💬', follow:'👤', mention:'@', reply:'↩️',
      workspace_post:'🏢', workspace_join:'🏢', message:'💬',
      report_outcome:'🛡️', warning:'⚠️', system:'📢'
    };
    return `<div class="notif-item${n.is_read ? '' : ' unread'}" onclick="markNotifRead('${n.id}')">
      <div class="notif-icon">${icons[n.notif_type] || '🔔'}</div>
      <div class="notif-content">
        <div class="notif-text">${escapeHtml(n.title)}</div>
        ${n.body ? `<div class="notif-text text-faint">${escapeHtml(n.body)}</div>` : ''}
        <div class="notif-time">${formatTime(n.created_at)}</div>
      </div>
    </div>`;
  }).join('');

  // Mark all as read in DB
  await sb.from('notifications').update({ is_read: true })
    .eq('user_id', App.user.id).eq('is_read', false);
  setbadge('notif-badge', 0);
}

async function markNotifRead(id) {
  await sb.from('notifications').update({ is_read: true }).eq('id', id);
}

async function markAllNotifsRead() {
  if (!App.user) return;
  await sb.from('notifications').update({ is_read: true }).eq('user_id', App.user.id);
  $$('.notif-item.unread').forEach(el => el.classList.remove('unread'));
  setbadge('notif-badge', 0);
  toast('All marked as read', 'success');
}

// ── MESSAGES ──────────────────────────────────────────────────
async function loadMessages() {
  if (!App.user || App.isGuest) { openAuthModal(); return; }
  const list = $('#conversations-list');
  if (!list) return;

  // Get distinct conversations
  const { data: sent }     = await sb.from('messages').select('receiver_id, body, created_at, is_read')
    .eq('sender_id', App.user.id).order('created_at', { ascending: false });
  const { data: received } = await sb.from('messages').select('sender_id, body, created_at, is_read')
    .eq('receiver_id', App.user.id).order('created_at', { ascending: false });

  // Build unique partner IDs
  const partnerIds = new Set([
    ...(sent     || []).map(m => m.receiver_id),
    ...(received || []).map(m => m.sender_id),
  ]);

  if (!partnerIds.size) {
    list.innerHTML = `<div class="empty-state" style="padding:2rem">
      <div class="empty-state-icon">💬</div>
      <p>No conversations yet.</p>
    </div>`;
    return;
  }

  const { data: partners } = await sb.from('profiles')
    .select('id, username, full_name, avatar_url, avatar_color, is_verified')
    .in('id', [...partnerIds]);

  list.innerHTML = (partners || []).map(partner => {
    const lastMsg = [...(sent||[]), ...(received||[])]
      .filter(m => m.receiver_id === partner.id || m.sender_id === partner.id)
      .sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0];
    return `
    <div class="message-thread-item" onclick="openChat('${partner.id}')">
      ${avatarHTML(partner, 'sm')}
      <div class="message-thread-info">
        <div class="message-thread-name">
          <span>${escapeHtml(partner.full_name || partner.username)}</span>
          ${lastMsg ? `<span style="font-family:var(--font-mono);font-size:.68rem;color:var(--text3)">${formatTime(lastMsg.created_at)}</span>` : ''}
        </div>
        ${lastMsg ? `<div class="message-thread-preview">${escapeHtml((lastMsg.body||'').substring(0,60))}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function openChat(partnerId) {
  if (!App.user) return;

  const { data: partner } = await sb.from('profiles')
    .select('id, username, full_name, avatar_url, avatar_color, is_verified')
    .eq('id', partnerId).single();

  if (!partner) return;
  App.chatPartner = partner;

  // Verify mutual follow
  const { data: mutual } = await sb.rpc('are_mutual_follows', {
    user_a: App.user.id, user_b: partnerId
  });
  if (!mutual) {
    toast('You both need to follow each other to message', 'info', 4000);
    return;
  }

  // Show chat view
  $('#chat-empty')?.classList.add('hidden');
  const cv = $('#chat-view');
  cv?.classList.remove('hidden');
  cv.style.display = 'flex';

  // Header
  $('#chat-header').innerHTML = `
    ${avatarHTML(partner, 'sm')}
    <div style="flex:1">
      <div style="font-weight:700;font-size:.9rem">${escapeHtml(partner.full_name || partner.username)}</div>
      <div style="font-family:var(--font-mono);font-size:.72rem;color:var(--text3)">@${escapeHtml(partner.username)}</div>
    </div>
    <button class="btn btn-ghost btn-sm" onclick="openProfile('${escapeHtml(partner.username)}')">View profile</button>
  `;

  // Load messages
  await loadChatMessages(partnerId);
  markMessagesRead(partnerId);

  // Mark conversation active
  $$('.message-thread-item').forEach(el => el.classList.remove('active'));
}

async function loadChatMessages(partnerId) {
  const container = $('#chat-messages');
  if (!container) return;

  const { data } = await sb.from('messages').select('*')
    .or(`and(sender_id.eq.${App.user.id},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${App.user.id})`)
    .order('created_at', { ascending: true }).limit(100);

  container.innerHTML = (data || []).map(m => messageBubbleHTML(m)).join('');
  container.scrollTop = container.scrollHeight;
}

function messageBubbleHTML(msg) {
  const isMine = msg.sender_id === App.user?.id;
  return `<div style="display:flex;flex-direction:column;align-items:${isMine ? 'flex-end' : 'flex-start'}">
    <div class="chat-bubble ${isMine ? 'mine' : 'theirs'}">${escapeHtml(msg.body)}</div>
    <div class="chat-time">${formatTime(msg.created_at)}</div>
  </div>`;
}

function appendChatBubble(msg, isMine) {
  const container = $('#chat-messages');
  if (!container) return;
  container.insertAdjacentHTML('beforeend', messageBubbleHTML(msg));
  container.scrollTop = container.scrollHeight;
}

async function sendMessage() {
  if (!App.user || !App.chatPartner) return;
  const input = $('#chat-input');
  const body  = input?.value.trim();
  if (!body) return;

  input.value = '';
  input.style.height = '';

  // Moderate
  const mod = await moderateContent(body);
  if (mod.result === 'block') { toast(`Message blocked: ${mod.reason}`, 'error', 5000); return; }

  const { data, error } = await sb.from('messages').insert({
    sender_id:   App.user.id,
    receiver_id: App.chatPartner.id,
    body,
  }).select().single();

  if (error) { toast(error.message, 'error'); return; }
  appendChatBubble(data, true);
}

function handleChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

async function markMessagesRead(senderId) {
  if (!App.user) return;
  await sb.from('messages').update({ is_read: true })
    .eq('sender_id', senderId).eq('receiver_id', App.user.id).eq('is_read', false);
  loadUnreadCounts();
}

function openNewMessageModal() {
  if (!App.user || App.isGuest) { openAuthModal(); return; }
  $('#new-msg-search').value = '';
  $('#mutual-follows-list').innerHTML = '';
  openModal('modal-new-message');
}

async function searchMutualFollows(query) {
  const el = $('#mutual-follows-list');
  if (!el || !App.user) return;

  const { data: follows } = await sb.from('follows')
    .select('following_id').eq('follower_id', App.user.id);
  const myFollowing = (follows || []).map(f => f.following_id);
  if (!myFollowing.length) { el.innerHTML = '<p style="padding:.75rem;font-size:.82rem;color:var(--text3)">You\'re not following anyone yet.</p>'; return; }

  // Find who also follows me back
  const { data: mutuals } = await sb.from('follows')
    .select('follower_id').eq('following_id', App.user.id).in('follower_id', myFollowing);
  const mutualIds = (mutuals || []).map(f => f.follower_id);
  if (!mutualIds.length) { el.innerHTML = '<p style="padding:.75rem;font-size:.82rem;color:var(--text3)">No mutual follows yet.</p>'; return; }

  let q = sb.from('profiles').select('id,username,full_name,avatar_url,avatar_color').in('id', mutualIds);
  if (query) q = q.ilike('full_name', `%${query}%`);
  const { data: people } = await q.limit(10);

  el.innerHTML = (people || []).map(p => `
    <div class="person-item" onclick="closeModal('modal-new-message'); openChat('${p.id}')">
      ${avatarHTML(p, 'sm')}
      <div class="person-info">
        <div class="person-name">${escapeHtml(p.full_name || p.username)}</div>
        <div class="person-handle">@${escapeHtml(p.username)}</div>
      </div>
    </div>`).join('');
}

function filterConversations(q) {
  $$('.message-thread-item').forEach(item => {
    const name = item.textContent.toLowerCase();
    item.style.display = name.includes(q.toLowerCase()) ? '' : 'none';
  });
}

// ── FOLLOW / UNFOLLOW ─────────────────────────────────────────
async function toggleFollow(userId, btn) {
  if (!App.user || App.isGuest) { openAuthModal(); return; }

  const { data: existing } = await sb.from('follows')
    .select('id').eq('follower_id', App.user.id).eq('following_id', userId).single();

  if (existing) {
    await sb.from('follows').delete().eq('id', existing.id);
    if (btn) { btn.textContent = 'Follow'; btn.className = 'btn btn-outline btn-sm'; }
    toast('Unfollowed', 'info');
  } else {
    await sb.from('follows').insert({ follower_id: App.user.id, following_id: userId });
    if (btn) { btn.textContent = 'Following'; btn.className = 'btn btn-secondary btn-sm'; }
    toast('Following!', 'success');

    // Create notification
    await sb.from('notifications').insert({
      user_id:    userId,
      actor_id:   App.user.id,
      notif_type: 'follow',
      title:      `${App.profile?.full_name || 'Someone'} started following you`,
    }).catch(() => {});
  }
}

// ── EXPLORE / VIBE SEARCH ─────────────────────────────────────
function initExplore() {
  vibeSearch('');
}

const debounceSearch = debounce((q) => vibeSearch(q), 300);

async function vibeSearch(query = '', tagEl = null) {
  const q = query.replace(/^#/, '').trim();

  // Update tag UI
  if (tagEl) {
    $$('.vibe-tag').forEach(t => t.classList.remove('active'));
    tagEl.classList.add('active');
  }

  const [pList, wList, postList] = [
    $('#vibe-people-list'),
    $('#vibe-workspaces-list'),
    $('#vibe-posts-list'),
  ];
  if (pList) pList.innerHTML = skeletonPosts(2);
  if (wList) wList.innerHTML = skeletonPosts(2);
  if (postList) postList.innerHTML = skeletonPosts(2);

  const searchClear = $('#search-clear');
  if (searchClear) searchClear.style.display = q ? '' : 'none';

  try {
    const [people, spaces, posts] = await Promise.all([
      searchPeople(q),
      searchWorkspaces(q),
      searchPosts(q),
    ]);

    renderVibeColumn(pList, people, renderPersonItem);
    renderVibeColumn(wList, spaces, renderWorkspaceItem);
    renderVibeColumn(postList, posts, p => renderPost(p, new Set(), false));
  } catch {}
}

function renderVibeColumn(container, items, renderFn) {
  if (!container) return;
  if (!items?.length) {
    container.innerHTML = `<div style="padding:2rem 1.1rem;text-align:center;color:var(--text3);font-size:.82rem">Nothing found</div>`;
    return;
  }
  container.innerHTML = items.map(renderFn).join('');
}

async function searchPeople(q) {
  let query = sb.from('profiles').select(
    'id, username, full_name, bio, role, avatar_url, avatar_color, is_verified, followers_count, tech_stack'
  ).eq('status','active').eq('is_bot', false).limit(8);

  if (q) {
    query = query.or(`username.ilike.%${q}%,full_name.ilike.%${q}%,bio.ilike.%${q}%,role.ilike.%${q}%`);
  } else {
    query = query.order('followers_count', { ascending: false });
  }
  const { data } = await query;
  return data || [];
}

async function searchWorkspaces(q) {
  let query = sb.from('workspaces').select(
    'id, name, slug, description, tags, member_count, is_private'
  ).eq('is_deleted', false).limit(8);

  if (q) {
    query = query.or(`name.ilike.%${q}%,description.ilike.%${q}%`);
  } else {
    query = query.order('member_count', { ascending: false });
  }
  const { data } = await query;
  return (data || []).filter(w => !w.is_private);
}

async function searchPosts(q) {
  let query = sb.from('posts').select(`
    id, body, post_type, repo_data, workflow_data, tags, likes_count, comments_count,
    created_at, is_bot_post,
    profiles:user_id (id, username, full_name, avatar_url, avatar_color, is_verified, is_bot, role)
  `).eq('is_deleted', false).eq('is_flagged', false).limit(10);

  if (q) {
    query = query.or(`body.ilike.%${q}%,tags.cs.{${q}}`);
  } else {
    query = query.order('created_at', { ascending: false });
  }
  const { data } = await query;
  return data || [];
}

function clearSearch() {
  const inp = $('#explore-search');
  if (inp) inp.value = '';
  vibeSearch('');
  $$('.vibe-tag').forEach(t => t.classList.remove('active'));
  $('.vibe-tag')?.classList.add('active');
}

function renderPersonItem(p) {
  return `<div class="person-item" onclick="openProfile('${escapeHtml(p.username)}')">
    ${avatarHTML(p, 'sm')}
    <div class="person-info">
      <div class="person-name">
        ${escapeHtml(p.full_name || p.username)}
        ${p.is_verified ? '<span class="verified-badge"></span>' : ''}
      </div>
      <div class="person-handle">@${escapeHtml(p.username)} · ${formatNumber(p.followers_count||0)} followers</div>
      ${p.bio ? `<div class="person-bio">${escapeHtml(p.bio)}</div>` : ''}
      ${(p.tech_stack||[]).length ? `<div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.3rem">${(p.tech_stack).slice(0,4).map(t=>`<span class="post-tag">#${escapeHtml(t)}</span>`).join('')}</div>` : ''}
    </div>
    ${App.user && p.id !== App.user.id ? `<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();toggleFollow('${p.id}',this)">Follow</button>` : ''}
  </div>`;
}

function renderWorkspaceItem(w) {
  return `<div class="workspace-card" onclick="openWorkspace('${w.id}')">
    <div class="workspace-icon">🏢</div>
    <div class="workspace-info">
      <div class="workspace-name">
        ${escapeHtml(w.name)}
        ${w.is_private ? '<span class="badge badge-neutral">Private</span>' : ''}
      </div>
      <div class="workspace-desc">${escapeHtml(w.description || '')}</div>
      <div class="workspace-meta">
        <span>👥 ${formatNumber(w.member_count)} members</span>
        ${(w.tags||[]).slice(0,3).map(t => `<span>#${escapeHtml(t)}</span>`).join('')}
      </div>
    </div>
  </div>`;
}

// ── PROFILE ───────────────────────────────────────────────────
function goToOwnProfile() {
  if (!App.user || App.isGuest) { openAuthModal(); return; }
  openProfileById(App.user.id);
}

async function openProfile(username) {
  if (!username) return;
  const { data } = await sb.from('profiles').select('id').eq('username', username).single();
  if (data) openProfileById(data.id);
}

async function openProfileById(userId) {
  sNav('profile');
  const content = $('#profile-tab-content');
  content.innerHTML = skeletonPosts(3);

  const { data: p } = await sb.from('profiles').select('*').eq('id', userId).single();
  if (!p) { content.innerHTML = `<div class="empty-state"><h3>User not found</h3></div>`; return; }

  App.viewingProfile = p;
  const isOwn = App.user?.id === p.id;

  $('#profile-topnav-name').textContent = p.full_name || p.username;

  // Cover gradient based on avatar color
  $('#profile-cover').style.background = `linear-gradient(135deg, var(--bg3) 0%, ${(p.avatar_color||'#6366f1')}22 100%)`;

  // Avatar
  $('#profile-avatar-large').innerHTML = avatarHTML(p, 'xl');

  // Name, username, bio, meta
  $('#profile-name').innerHTML = `
    ${escapeHtml(p.full_name || p.username)}
    ${p.is_verified ? '<span class="verified-badge" style="width:18px;height:18px"></span>' : ''}
    ${p.is_admin ? '<span class="badge badge-accent">Admin</span>' : ''}
    ${p.is_bot ? '<span class="badge badge-bot">Bot</span>' : ''}`;

  $('#profile-username').textContent = `@${p.username}`;
  $('#profile-bio').textContent = p.bio || '';

  const metaParts = [];
  if (p.location) metaParts.push(`📍 ${p.location}`);
  if (p.website)  metaParts.push(`🔗 <a href="${escapeHtml(p.website)}" target="_blank" style="color:var(--accent2)">${escapeHtml(p.website.replace(/^https?:\/\//,''))}</a>`);
  if (p.github_username) metaParts.push(`🐙 <a href="https://github.com/${escapeHtml(p.github_username)}" target="_blank" style="color:var(--accent2)">@${escapeHtml(p.github_username)}</a>`);
  if (p.created_at) metaParts.push(`📅 Joined ${new Date(p.created_at).toLocaleDateString('en-GB',{month:'short',year:'numeric'})}`);
  $('#profile-meta').innerHTML = metaParts.map(m => `<span>${m}</span>`).join('');

  // Stack
  $('#profile-stack').innerHTML = (p.tech_stack||[]).map(t =>
    `<span class="post-tag" onclick="sNav('explore');initExplore();vibeSearch('${escapeHtml(t)}')">#${escapeHtml(t)}</span>`
  ).join('');

  // Stats
  $('#profile-followers').textContent  = formatNumber(p.followers_count||0);
  $('#profile-following').textContent  = formatNumber(p.following_count||0);
  $('#profile-posts-count').textContent = formatNumber(p.posts_count||0);

  // Action buttons
  const actionBtns = $('#profile-action-btns');
  if (isOwn) {
    actionBtns.innerHTML = `<button class="btn btn-secondary" onclick="openEditProfileModal()">Edit profile</button>`;
  } else if (App.user) {
    // Check follow status
    const { data: followData } = await sb.from('follows')
      .select('id').eq('follower_id', App.user.id).eq('following_id', p.id).single();
    const isFollowing = !!followData;

    actionBtns.innerHTML = `
      <button class="btn ${isFollowing ? 'btn-secondary' : 'btn-primary'}" id="profile-follow-btn"
        onclick="toggleFollow('${p.id}', this)">
        ${isFollowing ? 'Following' : 'Follow'}
      </button>
      <button class="btn btn-secondary" onclick="openChat('${p.id}')">Message</button>`;
  }

  // Load posts tab by default
  loadProfileTab('posts');
}

async function loadProfileTab(tab, tabEl = null) {
  if (tabEl) {
    $$('.profile-tabs .feed-tab').forEach(t => t.classList.remove('active'));
    tabEl.classList.add('active');
  }

  const p = App.viewingProfile;
  const content = $('#profile-tab-content');
  if (!p || !content) return;

  if (tab === 'posts') {
    content.innerHTML = skeletonPosts(3);
    const { data: posts } = await sb.from('posts').select(`
      id, body, post_type, media_url, yt_url, yt_thumbnail, link_url, link_preview,
      repo_data, workflow_data, poll_data, tags, likes_count, comments_count, created_at, is_bot_post,
      profiles:user_id (id, username, full_name, avatar_url, avatar_color, is_verified, is_bot, role)
    `).eq('user_id', p.id).eq('is_deleted', false).order('created_at', { ascending: false }).limit(20);

    if (!posts?.length) {
      content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📝</div><h3>No posts yet</h3></div>`;
      return;
    }
    content.innerHTML = posts.map(post => renderPost(post, new Set(), false)).join('');

  } else if (tab === 'repos') {
    const repos = p.pinned_repos || [];
    if (!repos.length) {
      content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🐙</div><h3>No repos synced</h3>
        ${p.id === App.user?.id ? '<p>Connect GitHub to show your repos.</p>' : ''}</div>`;
      return;
    }
    content.innerHTML = `<div style="padding:1.25rem">${repos.map(r => renderRepoCard(r)).join('')}</div>`;

  } else if (tab === 'workspaces') {
    const { data: memberships } = await sb.from('workspace_members')
      .select('workspaces(id, name, slug, description, tags, member_count, is_private)')
      .eq('user_id', p.id).limit(10);
    const spaces = (memberships || []).map(m => m.workspaces).filter(Boolean);
    if (!spaces.length) {
      content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🏢</div><h3>No workspaces yet</h3></div>`;
      return;
    }
    content.innerHTML = spaces.map(w => renderWorkspaceItem(w)).join('');

  } else if (tab === 'about') {
    content.innerHTML = `<div style="padding:1.5rem;max-width:560px">
      ${p.bio ? `<div style="margin-bottom:1.5rem"><div class="label mb-2">Bio</div><p style="color:var(--text2)">${escapeHtml(p.bio)}</p></div>` : ''}
      ${(p.tech_stack||[]).length ? `<div style="margin-bottom:1.5rem"><div class="label mb-2">Stack</div><div style="display:flex;flex-wrap:wrap;gap:.4rem">${p.tech_stack.map(t=>`<span class="post-tag">#${escapeHtml(t)}</span>`).join('')}</div></div>` : ''}
      ${p.role ? `<div style="margin-bottom:1rem"><div class="label mb-1">Role</div><p style="color:var(--text2)">${escapeHtml(p.role)}</p></div>` : ''}
      ${p.location ? `<div style="margin-bottom:1rem"><div class="label mb-1">Location</div><p style="color:var(--text2)">📍 ${escapeHtml(p.location)}</p></div>` : ''}
    </div>`;
  }
}

// ── EDIT PROFILE MODAL ────────────────────────────────────────
let _editStack = [];

function openEditProfileModal() {
  const p = App.profile;
  if (!p) return;
  $('#edit-name').value     = p.full_name || '';
  $('#edit-bio').value      = p.bio || '';
  $('#edit-location').value = p.location || '';
  $('#edit-website').value  = p.website || '';
  $('#edit-role').value     = p.role || '';
  $('#edit-github').value   = p.github_username || '';
  $('#edit-avatar').value   = p.avatar_url || '';
  _editStack = [...(p.tech_stack || [])];
  renderEditStackChips();
  openModal('modal-edit-profile');
}

function handleEditStackInput(e) {
  if ((e.key === 'Enter' || e.key === ',') && e.target.value.trim()) {
    e.preventDefault();
    const tag = e.target.value.trim().replace(/^#/,'').replace(/[^a-z0-9_]/gi,'').toLowerCase();
    if (tag && !_editStack.includes(tag) && _editStack.length < 15) {
      _editStack.push(tag);
      renderEditStackChips();
    }
    e.target.value = '';
  }
}

function renderEditStackChips() {
  const el = $('#edit-stack-chips');
  if (!el) return;
  el.innerHTML = _editStack.map((t,i) =>
    `<span class="tag-chip">#${escapeHtml(t)}<span class="tag-chip-remove" onclick="_editStack.splice(${i},1);renderEditStackChips()">×</span></span>`
  ).join('');
}

async function saveProfile() {
  if (!App.user) return;

  const name = $('#edit-name')?.value.trim();
  if (!name) { toast('Name is required', 'error'); return; }

  // Moderate bio
  const bio = $('#edit-bio')?.value.trim();
  if (bio) {
    const mod = await moderateContent(bio);
    if (mod.result === 'block') { toast(`Bio blocked: ${mod.reason}`, 'error', 5000); return; }
  }

  const updates = {
    full_name:       name,
    bio,
    location:        $('#edit-location')?.value.trim() || '',
    website:         $('#edit-website')?.value.trim() || '',
    role:            $('#edit-role')?.value.trim() || '',
    github_username: $('#edit-github')?.value.trim() || null,
    avatar_url:      $('#edit-avatar')?.value.trim() || null,
    tech_stack:      _editStack,
  };

  const { error } = await sb.from('profiles').update(updates).eq('id', App.user.id);
  if (error) { toast(error.message, 'error'); return; }

  App.profile = { ...App.profile, ...updates };
  updateSidebarProfile();
  closeModal('modal-edit-profile');
  openProfileById(App.user.id);
  toast('Profile updated!', 'success');

  // Re-sync GitHub if username changed
  if (updates.github_username) syncGitHubRepos();
}

// ── FOLLOWERS MODAL ───────────────────────────────────────────
async function openFollowersModal(type) {
  const p = App.viewingProfile || App.profile;
  if (!p) return;
  $('#followers-modal-title').textContent = type === 'followers' ? 'Followers' : 'Following';
  openModal('modal-followers');

  const list = $('#followers-list');
  list.innerHTML = skeletonPosts(3);

  let query;
  if (type === 'followers') {
    query = sb.from('follows').select('profiles:follower_id(id, username, full_name, avatar_url, avatar_color, is_verified, role)')
      .eq('following_id', p.id);
  } else {
    query = sb.from('follows').select('profiles:following_id(id, username, full_name, avatar_url, avatar_color, is_verified, role)')
      .eq('follower_id', p.id);
  }

  const { data } = await query.limit(50);
  const people = (data || []).map(d => d.profiles).filter(Boolean);

  if (!people.length) {
    list.innerHTML = `<div class="empty-state" style="padding:2rem"><p>Nobody here yet.</p></div>`;
    return;
  }
  list.innerHTML = people.map(person => renderPersonItem(person)).join('');
}

// ── WORKSPACES ────────────────────────────────────────────────
async function loadWorkspaces(tab = 'discover', tabEl = null) {
  if (tabEl) {
    $$('#section-workspaces .feed-tabs .feed-tab').forEach(t => t.classList.remove('active'));
    tabEl.classList.add('active');
  }

  // Hide workspace inner view
  $('#workspace-view')?.classList.add('hidden');
  $('#workspaces-list')?.classList.remove('hidden');

  const list = $('#workspaces-list');
  list.innerHTML = skeletonPosts(3);

  let data;
  if (tab === 'mine' && App.user) {
    const { data: memberships } = await sb.from('workspace_members')
      .select('workspaces(*)')
      .eq('user_id', App.user.id).limit(20);
    data = (memberships || []).map(m => m.workspaces).filter(Boolean);
  } else {
    const res = await sb.from('workspaces')
      .select('*').eq('is_deleted', false).eq('is_private', false)
      .order('member_count', { ascending: false }).limit(20);
    data = res.data || [];
  }

  if (!data?.length) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">🏢</div>
      <h3>${tab === 'mine' ? 'No workspaces yet' : 'No public workspaces'}</h3>
      <p>Create the first workspace!</p>
      ${App.user ? `<button class="btn btn-primary" onclick="openCreateWorkspaceModal()">Create workspace</button>` : ''}
    </div>`;
    return;
  }

  list.innerHTML = data.map(w => renderWorkspaceItem(w)).join('');
}

async function openWorkspace(workspaceId) {
  const { data: ws } = await sb.from('workspaces').select('*').eq('id', workspaceId).single();
  if (!ws) return;
  App.viewingWorkspace = ws;

  $('#workspaces-list')?.classList.add('hidden');
  const view = $('#workspace-view');
  view?.classList.remove('hidden');

  // Check membership
  let isMember = false, userRole = null;
  if (App.user) {
    const { data: mem } = await sb.from('workspace_members')
      .select('role').eq('workspace_id', ws.id).eq('user_id', App.user.id).single();
    isMember = !!mem;
    userRole = mem?.role || null;
  }

  // Header
  $('#workspace-view-header').innerHTML = `
    <div class="workspace-header-top">
      <div class="workspace-header-icon">🏢</div>
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:.5rem">
          <h2 style="color:var(--text)">${escapeHtml(ws.name)}</h2>
          ${ws.is_private ? '<span class="badge badge-neutral">Private</span>' : ''}
        </div>
        <div style="font-size:.82rem;color:var(--text3);font-family:var(--font-mono)">
          👥 ${formatNumber(ws.member_count)} members
          ${(ws.tags||[]).slice(0,3).map(t=>`· #${escapeHtml(t)}`).join('')}
        </div>
      </div>
      ${App.user ? `
        ${isMember
          ? `<button class="btn btn-secondary btn-sm" onclick="leaveWorkspace('${ws.id}')">Leave</button>`
          : `<button class="btn btn-primary btn-sm" onclick="joinWorkspace('${ws.id}', this)">Join</button>`
        }` : ''}
    </div>
    ${ws.description ? `<p style="font-size:.85rem;color:var(--text2)">${escapeHtml(ws.description)}</p>` : ''}`;

  loadWorkspaceTab('posts');
}

async function loadWorkspaceTab(tab, tabEl = null) {
  if (tabEl) {
    $$('#workspace-inner-tabs .feed-tab').forEach(t => t.classList.remove('active'));
    tabEl.classList.add('active');
  }

  const ws = App.viewingWorkspace;
  const content = $('#workspace-tab-content');
  if (!ws || !content) return;

  if (tab === 'posts') {
    content.innerHTML = skeletonPosts(3);
    const { data: posts } = await sb.from('posts').select(`
      id, body, post_type, media_url, yt_url, yt_thumbnail, link_url, link_preview,
      repo_data, workflow_data, poll_data, tags, likes_count, comments_count, created_at, is_bot_post,
      profiles:user_id (id, username, full_name, avatar_url, avatar_color, is_verified, is_bot, role)
    `).eq('workspace_id', ws.id).eq('is_deleted', false)
      .order('created_at', { ascending: false }).limit(20);

    if (!posts?.length) {
      content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📭</div><h3>No posts yet</h3></div>`;
      return;
    }
    content.innerHTML = posts.map(p => renderPost(p, new Set(), false)).join('');

  } else if (tab === 'discussions') {
    const { data: threads } = await sb.from('threads')
      .select('*, profiles:user_id(username, full_name, avatar_url)')
      .eq('workspace_id', ws.id).eq('is_deleted', false)
      .order('created_at', { ascending: false }).limit(20);
    content.innerHTML = renderThreadList(threads || []);

  } else if (tab === 'resources') {
    const { data: resources } = await sb.from('workspace_resources')
      .select('*, profiles:user_id(username, full_name)')
      .eq('workspace_id', ws.id).order('created_at', { ascending: false }).limit(30);
    content.innerHTML = renderResourceList(resources || [], ws.id);

  } else if (tab === 'members') {
    const { data: members } = await sb.from('workspace_members')
      .select('role, joined_at, profiles:user_id(id, username, full_name, avatar_url, avatar_color, is_verified)')
      .eq('workspace_id', ws.id).order('joined_at', { ascending: true }).limit(50);
    content.innerHTML = (members || []).map(m => `
      <div class="person-item">
        ${avatarHTML(m.profiles, 'sm')}
        <div class="person-info" onclick="openProfile('${escapeHtml(m.profiles?.username)}')">
          <div class="person-name">${escapeHtml(m.profiles?.full_name || m.profiles?.username || '')}</div>
          <div class="person-handle">@${escapeHtml(m.profiles?.username || '')} · ${m.role}</div>
        </div>
      </div>`).join('') || `<div class="empty-state"><p>No members found.</p></div>`;
  }
}

function renderResourceList(resources, wsId) {
  if (!resources.length) {
    return `<div class="empty-state"><div class="empty-state-icon">📁</div><h3>No resources yet</h3>
      ${App.user ? `<button class="btn btn-primary" onclick="openAddResourceModal('${wsId}')">Add resource</button>` : ''}
    </div>`;
  }
  const header = App.user ? `<div style="padding:1rem 1.5rem;border-bottom:1px solid var(--border)">
    <button class="btn btn-primary btn-sm" onclick="openAddResourceModal('${wsId}')">+ Add resource</button>
  </div>` : '';
  return header + resources.map(r => `
    <div style="display:flex;align-items:center;gap:.85rem;padding:1rem 1.5rem;border-bottom:1px solid var(--border)">
      <span style="font-size:1.4rem">${r.resource_type === 'file' ? '📁' : r.resource_type === 'video' ? '🎬' : '🔗'}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:.88rem">${escapeHtml(r.title)}</div>
        ${r.description ? `<div style="font-size:.78rem;color:var(--text2)">${escapeHtml(r.description)}</div>` : ''}
        <div style="font-size:.72rem;color:var(--text3);font-family:var(--font-mono)">${escapeHtml(r.profiles?.username||'')} · ${formatTime(r.created_at)}</div>
      </div>
      ${r.url || r.file_url ? `<a href="${escapeHtml(r.url||r.file_url)}" target="_blank" class="btn btn-secondary btn-sm">Open</a>` : ''}
    </div>`).join('');
}

async function joinWorkspace(wsId, btn) {
  if (!App.user || App.isGuest) { openAuthModal(); return; }
  const { error } = await sb.from('workspace_members').insert({ workspace_id: wsId, user_id: App.user.id });
  if (error) { toast(error.message, 'error'); return; }
  if (btn) { btn.textContent = 'Leave'; btn.className = 'btn btn-secondary btn-sm'; btn.onclick = () => leaveWorkspace(wsId); }
  toast('Joined workspace!', 'success');
}

async function leaveWorkspace(wsId) {
  if (!App.user) return;
  await sb.from('workspace_members').delete().eq('workspace_id', wsId).eq('user_id', App.user.id);
  loadWorkspaces();
  toast('Left workspace', 'info');
}

// ── CREATE WORKSPACE ──────────────────────────────────────────
let _wsTags = [];

function openCreateWorkspaceModal() {
  if (!App.user || App.isGuest) { openAuthModal(); return; }
  _wsTags = [];
  $('#ws-tag-chips').innerHTML = '';
  openModal('modal-create-workspace');
}

function autoSlug(name) {
  const slugEl = $('#ws-slug');
  if (slugEl && !slugEl.dataset.manualEdit) {
    slugEl.value = slugify(name).substring(0, 40);
  }
}

function sanitizeSlug(input) {
  input.value = slugify(input.value);
  input.dataset.manualEdit = '1';
}

function handleWsTagInput(e) {
  if ((e.key === 'Enter' || e.key === ',') && e.target.value.trim()) {
    e.preventDefault();
    const tag = e.target.value.trim().replace(/^#/,'').replace(/[^a-z0-9_]/gi,'').toLowerCase();
    if (tag && !_wsTags.includes(tag) && _wsTags.length < 8) {
      _wsTags.push(tag);
      const chips = $('#ws-tag-chips');
      if (chips) chips.innerHTML = _wsTags.map((t,i) =>
        `<span class="tag-chip">#${escapeHtml(t)}<span class="tag-chip-remove" onclick="_wsTags.splice(${i},1);$('#ws-tag-chips').innerHTML=_wsTags.map((t,i)=>'').join('')">×</span></span>`
      ).join('');
    }
    e.target.value = '';
  }
}

async function createWorkspace() {
  const name = $('#ws-name')?.value.trim();
  const slug = $('#ws-slug')?.value.trim();
  if (!name || !slug) { toast('Name and slug are required', 'error'); return; }

  const isPrivate = $('input[name="ws-visibility"]:checked')?.value === 'private';
  const inviteCode = isPrivate ? Math.random().toString(36).substring(2,10).toUpperCase() : null;

  const { data, error } = await sb.from('workspaces').insert({
    owner_id:    App.user.id,
    name,
    slug,
    description: $('#ws-desc')?.value.trim() || '',
    tags:        _wsTags,
    is_private:  isPrivate,
    invite_code: inviteCode,
  }).select().single();

  if (error) { toast(error.message, 'error'); return; }

  // Auto-join as owner
  await sb.from('workspace_members').insert({
    workspace_id: data.id, user_id: App.user.id, role: 'owner'
  });

  closeModal('modal-create-workspace');
  toast('Workspace created! 🏢', 'success');
  openWorkspace(data.id);
}

// ── DISCUSSIONS ───────────────────────────────────────────────
async function loadDiscussions(category = 'all', tabEl = null) {
  if (tabEl) {
    $$('#thread-categories .vibe-tag').forEach(t => t.classList.remove('active'));
    tabEl.classList.add('active');
  }

  const list = $('#threads-list');
  list.innerHTML = skeletonPosts(4);

  let query = sb.from('threads').select(`
    id, title, body, category, tags, upvotes_count, replies_count, views_count,
    is_pinned, is_solved, created_at,
    profiles:user_id (id, username, full_name, avatar_url, avatar_color)
  `).eq('is_deleted', false).is('workspace_id', null);

  if (category !== 'all') query = query.eq('category', category);
  query = query.order('is_pinned', { ascending: false }).order('created_at', { ascending: false }).limit(30);

  const { data, error } = await query;

  if (error || !data?.length) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">🧵</div>
      <h3>No discussions yet</h3>
      <p>Start the first conversation!</p>
    </div>`;
    return;
  }

  list.innerHTML = renderThreadList(data);
}

function renderThreadList(threads) {
  if (!threads.length) return `<div class="empty-state"><div class="empty-state-icon">🧵</div><h3>No threads yet</h3></div>`;
  return threads.map(t => `
    <div class="thread-item" onclick="openThread('${t.id}')">
      <div style="display:flex;align-items:flex-start;gap:.85rem">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:.35rem">
            ${t.is_pinned ? '<span class="badge badge-accent">📌 Pinned</span>' : ''}
            ${t.is_solved ? '<span class="badge badge-green">✓ Solved</span>' : ''}
            <span class="badge badge-neutral">${escapeHtml(t.category)}</span>
          </div>
          <div style="font-weight:700;font-size:.92rem;margin-bottom:.3rem;color:var(--text)">${escapeHtml(t.title)}</div>
          <div style="font-size:.8rem;color:var(--text2);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;margin-bottom:.5rem">${escapeHtml(t.body)}</div>
          <div style="display:flex;align-items:center;gap:1rem;font-family:var(--font-mono);font-size:.72rem;color:var(--text3)">
            <span>by @${escapeHtml(t.profiles?.username||'?')}</span>
            <span>↑ ${formatNumber(t.upvotes_count||0)}</span>
            <span>💬 ${formatNumber(t.replies_count||0)}</span>
            <span>${formatTime(t.created_at)}</span>
          </div>
        </div>
      </div>
    </div>`).join('');
}

async function openThread(threadId) {
  openModal('modal-thread-view');
  $('#thread-view-id').value = threadId;
  const body = $('#thread-view-body');
  body.innerHTML = skeletonPosts(2);

  const [{ data: thread }, { data: replies }] = await Promise.all([
    sb.from('threads').select('*, profiles:user_id(id, username, full_name, avatar_url, avatar_color)').eq('id', threadId).single(),
    sb.from('thread_replies').select('*, profiles:user_id(id, username, full_name, avatar_url, avatar_color)')
      .eq('thread_id', threadId).eq('is_deleted', false).order('created_at', { ascending: true }).limit(50),
  ]);

  if (!thread) { body.innerHTML = '<p>Thread not found.</p>'; return; }
  $('#thread-view-title').textContent = thread.title;

  // Increment views
  await sb.from('threads').update({ views_count: (thread.views_count||0)+1 }).eq('id', threadId);

  body.innerHTML = `
    <div style="padding:1rem;border-bottom:1px solid var(--border);margin-bottom:1rem">
      <div style="display:flex;gap:.75rem;margin-bottom:.75rem">
        ${avatarHTML(thread.profiles, 'sm')}
        <div>
          <span style="font-weight:600;font-size:.88rem">${escapeHtml(thread.profiles?.full_name||thread.profiles?.username||'')}</span>
          <span style="font-family:var(--font-mono);font-size:.72rem;color:var(--text3);margin-left:.4rem">${formatTime(thread.created_at)}</span>
        </div>
      </div>
      <p style="font-size:.9rem;color:var(--text2);line-height:1.65">${escapeHtml(thread.body)}</p>
    </div>
    ${(replies||[]).map(r => `
      <div style="display:flex;gap:.75rem;padding:.75rem 1rem;border-bottom:1px solid var(--border)">
        ${avatarHTML(r.profiles, 'sm')}
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.2rem">
            <span style="font-weight:600;font-size:.82rem">${escapeHtml(r.profiles?.full_name||r.profiles?.username||'')}</span>
            ${r.is_accepted ? '<span class="badge badge-green">✓ Solution</span>' : ''}
            <span style="font-family:var(--font-mono);font-size:.7rem;color:var(--text3)">${formatTime(r.created_at)}</span>
          </div>
          <p style="font-size:.85rem;color:var(--text2);line-height:1.55">${escapeHtml(r.body)}</p>
        </div>
      </div>`).join('')}
  `;
}

async function submitThread() {
  if (!App.user || App.isGuest) { openAuthModal(); return; }
  const title    = $('#thread-title')?.value.trim();
  const category = $('#thread-category')?.value;
  const body     = $('#thread-body')?.value.trim();
  if (!title || !body) { toast('Title and description are required', 'error'); return; }

  const mod = await moderateContent(title + ' ' + body);
  if (mod.result === 'block') { toast(`Blocked: ${mod.reason}`, 'error', 5000); return; }

  const tagsRaw  = $('#thread-tags-input')?.value || '';
  const tags     = tagsRaw.match(/#[\w]+/g)?.map(t => t.slice(1).toLowerCase()) || [];

  const { error } = await sb.from('threads').insert({
    user_id: App.user.id, title, body, category, tags
  });

  if (error) { toast(error.message, 'error'); return; }
  closeModal('modal-new-thread');
  toast('Thread posted!', 'success');
  loadDiscussions();
}

async function submitThreadReply() {
  if (!App.user || App.isGuest) { openAuthModal(); return; }
  const threadId = $('#thread-view-id')?.value;
  const body     = $('#thread-reply-input')?.value.trim();
  if (!body || !threadId) return;

  const mod = await moderateContent(body);
  if (mod.result === 'block') { toast(`Blocked: ${mod.reason}`, 'error', 5000); return; }

  const { error } = await sb.from('thread_replies').insert({
    thread_id: threadId, user_id: App.user.id, body
  });

  if (error) { toast(error.message, 'error'); return; }
  $('#thread-reply-input').value = '';
  openThread(threadId);
  toast('Reply posted!', 'success');
}

function openNewThreadModal() {
  if (!App.user || App.isGuest) { openAuthModal(); return; }
  openModal('modal-new-thread');
}

// ── BOOKMARKS ─────────────────────────────────────────────────
async function loadBookmarks() {
  if (!App.user || App.isGuest) { openAuthModal(); return; }
  const list = $('#bookmarks-list');
  list.innerHTML = skeletonPosts(3);

  const { data, error } = await sb.from('saved_posts').select(`
    post_id,
    posts:post_id (
      id, body, post_type, media_url, yt_url, yt_thumbnail, link_url, link_preview,
      repo_data, workflow_data, poll_data, tags, likes_count, comments_count,
      created_at, is_bot_post,
      profiles:user_id (id, username, full_name, avatar_url, avatar_color, is_verified, is_bot, role)
    )
  `).eq('user_id', App.user.id).order('created_at', { ascending: false }).limit(30);

  if (error || !data?.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔖</div><h3>No bookmarks yet</h3><p>Save posts to read them later.</p></div>`;
    return;
  }

  list.innerHTML = data.map(d => d.posts ? renderPost(d.posts, new Set(), true) : '').join('');
}

// ── REPORT ────────────────────────────────────────────────────
function openReportModal(targetType, targetId) {
  if (!App.user || App.isGuest) { openAuthModal(); return; }
  $('#report-target-id').value   = targetId;
  $('#report-target-type').value = targetType;
  $('#report-desc').value        = '';
  $$('input[name="report-type"]').forEach(r => r.checked = false);
  openModal('modal-report');
}

function reportUser() {
  const p = App.viewingProfile;
  if (p) openReportModal('user', p.id);
}

async function submitReport() {
  const targetId   = $('#report-target-id')?.value;
  const targetType = $('#report-target-type')?.value;
  const type       = $('input[name="report-type"]:checked')?.value;
  if (!type) { toast('Select a reason', 'error'); return; }

  const reportData = {
    reporter_id: App.user.id,
    report_type: type,
    description: $('#report-desc')?.value.trim() || '',
  };

  if (targetType === 'post')    reportData.reported_post_id    = targetId;
  if (targetType === 'user')    reportData.reported_user_id    = targetId;
  if (targetType === 'comment') reportData.reported_comment_id = targetId;

  const { error } = await sb.from('reports').insert(reportData);
  if (error) { toast(error.message, 'error'); return; }
  closeModal('modal-report');
  toast('Report submitted. Our team will review it.', 'success');
}

// ── ADMIN DASHBOARD ───────────────────────────────────────────
async function loadAdminDashboard() {
  if (!App.profile?.is_admin) return;

  const [users, posts, reports, workspaces] = await Promise.all([
    sb.from('profiles').select('id', { count:'exact', head:true }),
    sb.from('posts').select('id', { count:'exact', head:true }).eq('is_deleted', false),
    sb.from('reports').select('id', { count:'exact', head:true }).eq('status', 'pending'),
    sb.from('workspaces').select('id', { count:'exact', head:true }).eq('is_deleted', false),
  ]);

  // New users last 7 days
  const weekAgo = new Date(Date.now() - 7*86400000).toISOString();
  const { count: newUsers } = await sb.from('profiles').select('id', { count:'exact', head:true })
    .gte('created_at', weekAgo);

  $('#admin-stats').innerHTML = `
    <div class="admin-stat-card">
      <div class="admin-stat-num" style="color:var(--accent)">${formatNumber(users.count||0)}</div>
      <div class="admin-stat-label">Total members</div>
    </div>
    <div class="admin-stat-card">
      <div class="admin-stat-num">${formatNumber(posts.count||0)}</div>
      <div class="admin-stat-label">Posts</div>
    </div>
    <div class="admin-stat-card">
      <div class="admin-stat-num" style="color:var(--red)">${formatNumber(reports.count||0)}</div>
      <div class="admin-stat-label">Pending reports</div>
    </div>
    <div class="admin-stat-card">
      <div class="admin-stat-num" style="color:var(--green)">${formatNumber(workspaces.count||0)}</div>
      <div class="admin-stat-label">Workspaces</div>
    </div>
    <div class="admin-stat-card">
      <div class="admin-stat-num" style="color:var(--amber)">${formatNumber(newUsers||0)}</div>
      <div class="admin-stat-label">New this week</div>
    </div>`;

  loadAdminTab('reports');
}

async function loadAdminTab(tab) {
  const content = $('#admin-content');
  content.innerHTML = skeletonPosts(3);

  if (tab === 'users') {
    const { data } = await sb.from('profiles')
      .select('id, username, full_name, email, status, is_admin, followers_count, posts_count, created_at')
      .order('created_at', { ascending: false }).limit(50);

    content.innerHTML = `<h3 style="margin-bottom:1rem">All Members (${data?.length||0})</h3>` +
      (data||[]).map(u => `
        <div style="display:flex;align-items:center;gap:.85rem;padding:.85rem;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:.5rem">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:.88rem">${escapeHtml(u.full_name||'')} <span style="color:var(--text3);font-family:var(--font-mono)">@${escapeHtml(u.username||'')}</span></div>
            <div style="font-size:.75rem;color:var(--text3)">${escapeHtml(u.email||'')} · ${formatNumber(u.followers_count||0)} followers · ${formatNumber(u.posts_count||0)} posts</div>
          </div>
          <span class="badge ${u.status === 'active' ? 'badge-green' : 'badge-red'}">${u.status||'active'}</span>
          ${u.is_admin ? '<span class="badge badge-accent">Admin</span>' : ''}
          <div class="flex gap-1">
            ${u.status !== 'suspended' ? `<button class="btn btn-secondary btn-sm" onclick="adminAction('suspend','${u.id}')">Suspend</button>` : `<button class="btn btn-green btn-sm" onclick="adminAction('reinstate','${u.id}')">Reinstate</button>`}
            <button class="btn btn-danger btn-sm" onclick="adminAction('ban','${u.id}')">Ban</button>
          </div>
        </div>`).join('');

  } else if (tab === 'reports') {
    const { data } = await sb.from('reports')
      .select('*, reporter:reporter_id(username), post:reported_post_id(body), user:reported_user_id(username)')
      .eq('status', 'pending').order('created_at', { ascending: false }).limit(30);

    if (!data?.length) {
      content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">✅</div><h3>No pending reports</h3></div>`;
      return;
    }

    content.innerHTML = `<h3 style="margin-bottom:1rem">Pending Reports (${data.length})</h3>` +
      data.map(r => `
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:1rem;margin-bottom:.75rem">
          <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem;flex-wrap:wrap">
            <span class="badge badge-red">${escapeHtml(r.report_type)}</span>
            <span style="font-size:.75rem;color:var(--text3)">by @${escapeHtml(r.reporter?.username||'?')} · ${formatTime(r.created_at)}</span>
            ${r.reported_user_id ? `<span style="font-size:.75rem;color:var(--amber)">User: @${escapeHtml(r.user?.username||'?')}</span>` : ''}
          </div>
          ${r.post ? `<div style="font-size:.82rem;color:var(--text2);background:var(--bg3);padding:.6rem;border-radius:var(--radius);margin-bottom:.6rem">"${escapeHtml((r.post.body||'').substring(0,120))}…"</div>` : ''}
          ${r.description ? `<div style="font-size:.78rem;color:var(--text3);margin-bottom:.6rem">Note: ${escapeHtml(r.description)}</div>` : ''}
          <div class="flex gap-2">
            ${r.reported_post_id ? `<button class="btn btn-danger btn-sm" onclick="adminRemovePost('${r.reported_post_id}','${r.id}')">Remove post</button>` : ''}
            ${r.reported_user_id ? `<button class="btn btn-danger btn-sm" onclick="adminAction('suspend','${r.reported_user_id}')">Suspend user</button>` : ''}
            <button class="btn btn-secondary btn-sm" onclick="adminResolveReport('${r.id}')">Dismiss</button>
          </div>
        </div>`).join('');

  } else if (tab === 'workspaces') {
    const { data } = await sb.from('workspaces')
      .select('id, name, slug, member_count, is_private, is_deleted, created_at')
      .order('created_at', { ascending: false }).limit(30);

    content.innerHTML = `<h3 style="margin-bottom:1rem">All Workspaces</h3>` +
      (data||[]).map(w => `
        <div style="display:flex;align-items:center;gap:.85rem;padding:.85rem;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:.5rem">
          <div style="flex:1">
            <div style="font-weight:700;font-size:.88rem">${escapeHtml(w.name)}</div>
            <div style="font-size:.75rem;color:var(--text3)">/${escapeHtml(w.slug)} · ${formatNumber(w.member_count||0)} members · ${w.is_private?'Private':'Public'}</div>
          </div>
          <button class="btn btn-danger btn-sm" onclick="adminDeleteWorkspace('${w.id}')">Delete</button>
        </div>`).join('');

  } else if (tab === 'bot') {
    const { data: botPosts } = await sb.from('bot_posts_log')
      .select('*').order('posted_at', { ascending: false }).limit(20);

    content.innerHTML = `
      <div style="margin-bottom:1.25rem">
        <h3 style="margin-bottom:.5rem">DevPulse Bot</h3>
        <p style="font-size:.85rem;color:var(--text2)">The bot account auto-posts trending content from Hacker News, GitHub Trending, and dev.to. Add your Claude API key to the Supabase Edge Function <code style="font-family:var(--font-mono);background:var(--bg3);padding:.1rem .35rem;border-radius:4px">devpulse-post</code> to activate it.</p>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:1rem;margin-bottom:1rem">
        <div class="label mb-2">Recent bot posts log</div>
        ${(botPosts||[]).length ? botPosts.map(bp => `
          <div style="padding:.5rem 0;border-bottom:1px solid var(--border);font-size:.8rem;font-family:var(--font-mono)">
            <span class="badge badge-neutral">${escapeHtml(bp.source)}</span>
            <span style="color:var(--text3);margin-left:.5rem">${formatTime(bp.posted_at)}</span>
          </div>`).join('')
          : '<p style="font-size:.82rem;color:var(--text3)">No bot posts yet.</p>'}
      </div>`;
  }
}

async function adminAction(action, userId) {
  if (!App.profile?.is_admin) return;
  const labels = { suspend:'Suspend', reinstate:'Reinstate', ban:'Permanently ban' };
  if (!confirm(`${labels[action]} this user?`)) return;
  const statusMap = { suspend:'suspended', reinstate:'active', ban:'banned' };
  await sb.from('profiles').update({ status: statusMap[action] }).eq('id', userId);
  toast(`User ${action}d`, 'success');
  loadAdminTab('users');
}

async function adminRemovePost(postId, reportId) {
  await sb.from('posts').update({ is_deleted: true }).eq('id', postId);
  await adminResolveReport(reportId);
  toast('Post removed', 'success');
}

async function adminResolveReport(reportId) {
  await sb.from('reports').update({
    status: 'resolved', resolved_by: App.user.id, resolved_at: new Date().toISOString()
  }).eq('id', reportId);
  toast('Report resolved', 'success');
  loadAdminTab('reports');
}

async function adminDeleteWorkspace(wsId) {
  if (!confirm('Delete this workspace?')) return;
  await sb.from('workspaces').update({ is_deleted: true }).eq('id', wsId);
  toast('Workspace deleted', 'success');
  loadAdminTab('workspaces');
}

// ── ONBOARDING ────────────────────────────────────────────────
let _obStep = 1;

async function openOnboarding() {
  _obStep = 1;
  renderObStep();
  openModal('modal-onboarding');
}

function renderObStep() {
  const steps = $$('.onboarding-step');
  steps.forEach((s, i) => {
    s.className = 'onboarding-step' + (i+1 < _obStep ? ' done' : i+1 === _obStep ? ' active' : '');
  });

  const content = $('#onboarding-content');
  if (_obStep === 1) {
    content.innerHTML = `
      <h2 style="margin-bottom:.5rem">Welcome to Stackr 👋</h2>
      <p style="margin-bottom:1.5rem">Tell us what you work with so we can personalise your feed.</p>
      <div class="form-group">
        <label>Your role</label>
        <input id="ob-role" class="form-control" placeholder="e.g. Frontend Developer, ML Engineer…">
      </div>
      <div class="form-group">
        <label>Add your tech stack (press Enter)</label>
        <div class="tag-input-wrapper" style="background:var(--bg2);border:1.5px solid var(--border2);border-radius:var(--radius);padding:.6rem .85rem">
          <div id="ob-stack-chips"></div>
          <input id="ob-stack-input" class="tag-input" placeholder="#react #python #devops…"
            onkeydown="handleObStackInput(event)">
        </div>
      </div>
      <button class="btn btn-primary w-full" onclick="obNext()">Continue →</button>`;
  } else if (_obStep === 2) {
    content.innerHTML = `
      <h2 style="margin-bottom:.5rem">Who to follow 👥</h2>
      <p style="margin-bottom:1.5rem">Follow developers to personalise your feed.</p>
      <div id="ob-suggestions"></div>
      <button class="btn btn-primary w-full mt-3" onclick="obNext()">Continue →</button>`;
    loadObSuggestions();
  } else if (_obStep === 3) {
    content.innerHTML = `
      <h2 style="margin-bottom:.5rem">You're all set! 🚀</h2>
      <p style="margin-bottom:1.5rem">Your Stackr profile is ready. Start sharing what you're building.</p>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:1.1rem;margin-bottom:1.5rem">
        <div class="label mb-2">Quick tips</div>
        <div style="font-size:.85rem;color:var(--text2);display:flex;flex-direction:column;gap:.5rem">
          <div>🐙 <strong>Share a GitHub repo</strong> — paste a GitHub URL in your post</div>
          <div>⚙️ <strong>Post a workflow</strong> — share how you built something</div>
          <div>🔭 <strong>Vibe search</strong> — search "react dev" to find your community</div>
          <div>🏢 <strong>Create a workspace</strong> — for your team or open source project</div>
        </div>
      </div>
      <button class="btn btn-primary w-full" onclick="finishOnboarding()">Start exploring →</button>`;
  }
}

let _obStack = [];

function handleObStackInput(e) {
  if ((e.key === 'Enter' || e.key === ',') && e.target.value.trim()) {
    e.preventDefault();
    const tag = e.target.value.trim().replace(/^#/,'').replace(/[^a-z0-9_]/gi,'').toLowerCase();
    if (tag && !_obStack.includes(tag) && _obStack.length < 10) {
      _obStack.push(tag);
      const chips = $('#ob-stack-chips');
      if (chips) chips.innerHTML = _obStack.map((t,i) =>
        `<span class="tag-chip">#${escapeHtml(t)}</span>`
      ).join('');
    }
    e.target.value = '';
  }
}

async function loadObSuggestions() {
  const el = $('#ob-suggestions');
  if (!el) return;
  const { data } = await sb.from('profiles')
    .select('id, username, full_name, avatar_url, avatar_color, role, followers_count')
    .eq('status','active').eq('is_bot',false).neq('id', App.user.id)
    .order('followers_count', { ascending: false }).limit(5);
  if (!data?.length) { el.innerHTML = '<p style="color:var(--text3);font-size:.85rem">No suggestions yet — be an early member!</p>'; return; }
  el.innerHTML = data.map(p => `
    <div class="person-item">
      ${avatarHTML(p, 'sm')}
      <div class="person-info"><div class="person-name">${escapeHtml(p.full_name||p.username)}</div><div class="person-handle">@${escapeHtml(p.username)}</div></div>
      <button class="btn btn-outline btn-sm" id="ob-follow-${p.id}" onclick="toggleFollow('${p.id}',this)">Follow</button>
    </div>`).join('');
}

async function obNext() {
  if (_obStep === 1) {
    const role  = $('#ob-role')?.value.trim();
    const stack = _obStack;
    if (role || stack.length) {
      await sb.from('profiles').update({ role: role||'', tech_stack: stack }).eq('id', App.user.id);
      App.profile = { ...App.profile, role, tech_stack: stack };
    }
  }
  _obStep++;
  if (_obStep > 3) { finishOnboarding(); return; }
  renderObStep();
}

async function finishOnboarding() {
  await sb.from('profiles').update({ onboarding_done: true }).eq('id', App.user.id);
  App.profile.onboarding_done = true;
  closeModal('modal-onboarding');
  updateSidebarProfile();
  toast('Welcome to Stackr! 🚀', 'success');
}

// ── MODAL HELPERS ─────────────────────────────────────────────
function openModal(id) {
  const el = $(`#${id}`);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  const el = $(`#${id}`);
  if (el) el.classList.remove('open');
}

function closeModalOnBg(e, id) {
  if (e.target === e.currentTarget) closeModal(id);
}

// Close dropdowns on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('.dropdown')) {
    $$('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
  }
});

function toggleDropdown(id) {
  const menu = $(`#${id}`);
  if (!menu) return;
  const wasOpen = menu.classList.contains('open');
  $$('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
  if (!wasOpen) menu.classList.add('open');
}

// ── PROFILE LINK COPY ─────────────────────────────────────────
function copyProfileLink() {
  const p = App.viewingProfile;
  if (!p) return;
  const url = `${window.location.origin}?user=${p.username}`;
  navigator.clipboard?.writeText(url).then(() => toast('Profile link copied!', 'success'));
}

// ── KEYBOARD SHORTCUTS ────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $$('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    $$('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
  }
  // Press N to compose (when not in an input)
  if (e.key === 'n' && !e.ctrlKey && !e.metaKey &&
      !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) {
    focusComposer();
  }
});

// ── COMPOSER TEXT DETECTION ───────────────────────────────────
$('#composer-text')?.addEventListener('input', function() {
  autoResizeTextarea(this);
  updateCharCount(this);
  detectLink(this.value);
});

// ── URL ROUTER — handle deep links ───────────────────────────
function handleUrlParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('post')) {
    // Open post — for now just navigate to feed
  }
  if (params.get('user')) {
    openProfile(params.get('user'));
  }
}


// ── THEME TOGGLE (dark / light mode) ─────────────────────────
function toggleTheme() {
  const isLight = document.body.classList.toggle('light-mode');
  const btn = $('#theme-btn');
  if (btn) btn.textContent = isLight ? '☀️' : '🌙';
  localStorage.setItem('stackr-theme', isLight ? 'light' : 'dark');
}

function initTheme() {
  const saved = localStorage.getItem('stackr-theme');
  if (saved === 'light') {
    document.body.classList.add('light-mode');
    const btn = $('#theme-btn');
    if (btn) btn.textContent = '☀️';
  }
}

// ── DEEPSEEK / AI RATE LIMITER ────────────────────────────────
// Lightweight use only — max 5 AI calls per user per hour
const _aiCallLog = [];
const AI_CALL_LIMIT = 5;

function checkAiRateLimit() {
  const now = Date.now();
  // Remove calls older than 1 hour
  while (_aiCallLog.length && now - _aiCallLog[0] > 3600000) _aiCallLog.shift();
  if (_aiCallLog.length >= AI_CALL_LIMIT) {
    toast(`AI assist limited to ${AI_CALL_LIMIT} uses per hour to keep it free for everyone 🙏`, 'info', 5000);
    return false;
  }
  _aiCallLog.push(now);
  return true;
}

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initAuth();
  handleUrlParams();
});
