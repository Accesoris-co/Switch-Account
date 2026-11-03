// Cross-browser compatibility API accessor
const extApi = typeof browser !== "undefined" ? browser : chrome;

let currentTab = null;
let currentDomain = "";

// Element references
const currentDomainEl = document.getElementById("current-domain");
const activeSessionNameEl = document.getElementById("active-session-name");
const accountNameInput = document.getElementById("account-name-input");
const saveSessionBtn = document.getElementById("save-session-btn");
const sessionListEl = document.getElementById("session-list");
const sessionCountEl = document.getElementById("session-count");
const clearCookiesBtn = document.getElementById("clear-cookies-btn");

// Helper to get active tab
async function getActiveTab() {
  const tabs = await extApi.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs.length > 0 ? tabs[0] : null;
}

// Extract hostname/domain from URL
function getDomainFromUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    if (!parsed.protocol.startsWith("http")) return "";
    return parsed.hostname;
  } catch (e) {
    return "";
  }
}

// Storage key helper
function getStorageKey(domain) {
  return `switch_account_sessions_${domain}`;
}

// Fetch all cookies for the current tab URL
async function getCookiesForTab(tabUrl) {
  return new Promise((resolve) => {
    extApi.cookies.getAll({ url: tabUrl }, (cookies) => {
      resolve(cookies || []);
    });
  });
}

// Remove all cookies for a domain/URL
async function removeAllCookies(cookies, tabUrl) {
  const promises = cookies.map((cookie) => {
    const protocol = cookie.secure ? "https:" : "http:";
    const cleanDomain = cookie.domain.startsWith(".") ? cookie.domain.substring(1) : cookie.domain;
    const cookieUrl = `${protocol}//${cleanDomain}${cookie.path}`;

    return new Promise((resolve) => {
      extApi.cookies.remove({ url: cookieUrl, name: cookie.name, storeId: cookie.storeId }, () => {
        resolve();
      });
    });
  });

  await Promise.all(promises);
}

// Restore saved cookies
async function restoreCookies(savedCookies) {
  const promises = savedCookies.map((c) => {
    const protocol = c.secure ? "https:" : "http:";
    const cleanDomain = c.domain.startsWith(".") ? c.domain.substring(1) : c.domain;
    const cookieUrl = `${protocol}//${cleanDomain}${c.path}`;

    const cookieDetails = {
      url: cookieUrl,
      name: c.name,
      value: c.value,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      storeId: c.storeId
    };

    if (c.expirationDate) {
      cookieDetails.expirationDate = c.expirationDate;
    }

    return new Promise((resolve) => {
      extApi.cookies.set(cookieDetails, () => resolve());
    });
  });

  await Promise.all(promises);
}

// Load sessions from storage
async function loadSessions() {
  if (!currentDomain) return;

  const key = getStorageKey(currentDomain);
  const data = await extApi.storage.local.get([key, `active_session_${currentDomain}`]);
  const sessions = data[key] || [];
  const activeSession = data[`active_session_${currentDomain}`] || "Default / Belum Disimpan";

  activeSessionNameEl.textContent = activeSession;
  sessionCountEl.textContent = `${sessions.length} sesi`;

  if (sessions.length === 0) {
    sessionListEl.innerHTML = `<li class="empty-state">Belum ada sesi tersimpan untuk ${currentDomain}.</li>`;
    return;
  }

  sessionListEl.innerHTML = "";
  sessions.forEach((session, index) => {
    const li = document.createElement("li");
    li.className = "session-item";

    const isCurrent = session.name === activeSession;

    li.innerHTML = `
      <span class="name">${escapeHtml(session.name)} ${isCurrent ? "✓" : ""}</span>
      <div class="session-actions">
        <button class="btn btn-switch" data-index="${index}">${isCurrent ? "Muat Ulang" : "Ganti"}</button>
        <button class="btn btn-delete" data-index="${index}">Hapus</button>
      </div>
    `;

    li.querySelector(".btn-switch").addEventListener("click", () => switchSession(session));
    li.querySelector(".btn-delete").addEventListener("click", () => deleteSession(index));

    sessionListEl.appendChild(li);
  });
}

// Save current session
async function saveCurrentSession() {
  const name = accountNameInput.value.trim();
  if (!name) {
    alert("Masukkan nama untuk sesi ini.");
    return;
  }

  const cookies = await getCookiesForTab(currentTab.url);
  const key = getStorageKey(currentDomain);
  const data = await extApi.storage.local.get(key);
  let sessions = data[key] || [];

  // Check if session name already exists
  const existingIdx = sessions.findIndex((s) => s.name.toLowerCase() === name.toLowerCase());
  const newSessionData = {
    name,
    savedAt: new Date().toISOString(),
    cookies
  };

  if (existingIdx >= 0) {
    sessions[existingIdx] = newSessionData;
  } else {
    sessions.push(newSessionData);
  }

  await extApi.storage.local.set({
    [key]: sessions,
    [`active_session_${currentDomain}`]: name
  });

  accountNameInput.value = "";
  await loadSessions();
}

// Switch to a saved session
async function switchSession(session) {
  // 1. Remove current cookies for this tab
  const currentCookies = await getCookiesForTab(currentTab.url);
  await removeAllCookies(currentCookies, currentTab.url);

  // 2. Set new cookies
  await restoreCookies(session.cookies);

  // 3. Mark active
  await extApi.storage.local.set({
    [`active_session_${currentDomain}`]: session.name
  });

  // 4. Reload active tab
  await extApi.tabs.reload(currentTab.id);
  window.close();
}

// Delete a session
async function deleteSession(index) {
  const key = getStorageKey(currentDomain);
  const data = await extApi.storage.local.get(key);
  let sessions = data[key] || [];

  const deleted = sessions.splice(index, 1)[0];
  await extApi.storage.local.set({ [key]: sessions });

  // If deleted session was active, reset active label
  const activeKey = `active_session_${currentDomain}`;
  const activeData = await extApi.storage.local.get(activeKey);
  if (activeData[activeKey] === deleted.name) {
    await extApi.storage.local.set({ [activeKey]: "Default / Belum Disimpan" });
  }

  await loadSessions();
}

// Clear cookies (Logout)
async function clearAllCurrentCookies() {
  if (!confirm(`Hapus seluruh cookies untuk domain ${currentDomain}? Ini akan me-logout sesi aktif.`)) {
    return;
  }

  const currentCookies = await getCookiesForTab(currentTab.url);
  await removeAllCookies(currentCookies, currentTab.url);
  await extApi.storage.local.set({ [`active_session_${currentDomain}`]: "Default / Kosong" });

  await extApi.tabs.reload(currentTab.id);
  window.close();
}

// Helper utility
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Initialize popup
async function init() {
  currentTab = await getActiveTab();
  if (!currentTab || !currentTab.url) {
    currentDomainEl.textContent = "Tidak dapat mengakses tab.";
    return;
  }

  currentDomain = getDomainFromUrl(currentTab.url);
  if (!currentDomain) {
    currentDomainEl.textContent = "Halaman browser internal / tidak didukung.";
    saveSessionBtn.disabled = true;
    accountNameInput.disabled = true;
    clearCookiesBtn.disabled = true;
    return;
  }

  currentDomainEl.textContent = currentDomain;

  saveSessionBtn.addEventListener("click", saveCurrentSession);
  accountNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveCurrentSession();
  });
  clearCookiesBtn.addEventListener("click", clearAllCurrentCookies);

  await loadSessions();
}

document.addEventListener("DOMContentLoaded", init);
