const statusPill = document.getElementById("status-pill");
const statusText = document.getElementById("status-text");
const targetDomain = document.getElementById("target-domain");
const targetTabId = document.getElementById("target-tab-id");
const countdown = document.getElementById("countdown");
const countdownLabel = document.getElementById("countdown-label");
const refreshCount = document.getElementById("refresh-count");
const lastRefreshed = document.getElementById("last-refreshed");
const sessionNote = document.getElementById("session-note");
const startButton = document.getElementById("start-button");
const stopButton = document.getElementById("stop-button");
const duplicateWarning = document.getElementById("duplicate-warning");
const errorMessage = document.getElementById("error-message");

let selectedTabId = null;
let selectedSession = null;
let selectedSchedule = null;
let selectedUrlKey = null;
let duplicateTabId = null;
let syncVersion = 0;

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = !message;
}

function displayPage(url) {
  try {
    const page = new URL(url);
    return `${page.host}${page.pathname}${page.search}${page.hash}`;
  } catch {
    return "Current tab";
  }
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function render() {
  const active = Boolean(selectedSession);
  statusPill.dataset.active = String(active);
  statusText.textContent = active ? "ACTIVE" : "STANDBY";
  startButton.disabled = selectedTabId === null || active || Boolean(duplicateTabId) || !selectedUrlKey;
  stopButton.disabled = selectedTabId === null || !active;
  duplicateWarning.hidden = !duplicateTabId;
  duplicateWarning.textContent = duplicateTabId
    ? `Duplicate URL Detected: This page is already active on Tab #${duplicateTabId}. Simultaneous sessions on identical pages are blocked.`
    : !selectedUrlKey && selectedTabId !== null
      ? "TabPulse can only refresh regular HTTP or HTTPS pages."
      : "";

  if (selectedSession && selectedSession.inFlight) {
    countdownLabel.textContent = "REFRESHING THIS TAB";
    countdown.textContent = "NOW";
  } else if (selectedSession && selectedSchedule) {
    countdownLabel.textContent = selectedSchedule.deferred ? "SEPARATION WAIT" : "NEXT REFRESH IN";
    const remaining = Math.max(0, Math.ceil((selectedSchedule.targetTimestamp - Date.now()) / 1000));
    const minutes = Math.floor(remaining / 60).toString().padStart(2, "0");
    const seconds = (remaining % 60).toString().padStart(2, "0");
    countdown.textContent = `${minutes}:${seconds}`;
  } else {
    countdownLabel.textContent = "NEXT REFRESH IN";
    countdown.textContent = "--:--";
  }
  refreshCount.textContent = String(selectedSession && selectedSession.refreshCount || 0);
  lastRefreshed.textContent = selectedSession && selectedSession.lastRefreshedAt
    ? new Date(selectedSession.lastRefreshedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "Not yet";
  const notes = [];
  if (selectedSchedule && selectedSchedule.deferred) {
    notes.push("Delayed to keep at least 60 seconds between tab refreshes.");
  }
  if (selectedSession && selectedSession.lastError) {
    notes.push(`Last attempt failed (${selectedSession.failureCount || 0} total). Will retry: ${selectedSession.lastError}`);
  }
  sessionNote.hidden = notes.length === 0;
  sessionNote.textContent = notes.join(" ");
}

async function syncSelectedTab() {
  const version = ++syncVersion;
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (version !== syncVersion) return;
    selectedTabId = Number.isInteger(tab && tab.id) ? tab.id : null;
    targetDomain.textContent = tab ? displayPage(tab.url || tab.pendingUrl || "") : "No active tab";
    targetDomain.title = tab ? (tab.url || tab.pendingUrl || "") : "";
    selectedUrlKey = normalizeUrl(tab && (tab.url || tab.pendingUrl) || "");
    targetTabId.textContent = selectedTabId === null ? "—" : String(selectedTabId);

    const stored = await chrome.storage.local.get(["sessions", "activeSchedules", "activeUrls"]);
    if (version !== syncVersion) return;
    selectedSession = selectedTabId === null ? null : (stored.sessions || {})[selectedTabId] || null;
    selectedSchedule = selectedTabId === null ? null : (stored.activeSchedules || {})[selectedTabId] || null;
    duplicateTabId = await findDuplicateTab(stored, version);
    if (version !== syncVersion) return;
    showError("");
    render();
  } catch (error) {
    if (version !== syncVersion) return;
    selectedTabId = null;
    selectedSession = null;
    selectedSchedule = null;
    selectedUrlKey = null;
    duplicateTabId = null;
    targetDomain.textContent = "Unable to read active tab";
    targetTabId.textContent = "—";
    showError(error.message || "Unable to connect to TabPulse.");
    render();
  }
}

async function findDuplicateTab(stored, version) {
  if (!selectedUrlKey || selectedTabId === null) return null;
  const ownerTabId = Number((stored.activeUrls || {})[selectedUrlKey]);
  if (!Number.isInteger(ownerTabId) || ownerTabId === selectedTabId) return null;
  const ownerSession = (stored.sessions || {})[ownerTabId];
  if (!ownerSession || ownerSession.urlKey !== selectedUrlKey) return null;

  try {
    const ownerTab = await chrome.tabs.get(ownerTabId);
    if (version !== syncVersion || normalizeUrl(ownerTab.url) !== selectedUrlKey) return null;
    return ownerTabId;
  } catch {
    return null;
  }
}

async function sendCommand(type) {
  if (selectedTabId === null) return;
  showError("");
  startButton.disabled = true;
  stopButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type, tabId: selectedTabId });
    if (!response || !response.ok) {
      if (response && response.duplicateTabId) {
        duplicateTabId = response.duplicateTabId;
        showError("");
        render();
        return;
      }
      throw new Error((response && response.error) || "The command failed.");
    }
    selectedSession = response.session || null;
    selectedSchedule = response.schedule || null;
    duplicateTabId = null;
    render();
  } catch (error) {
    await syncSelectedTab();
    showError(error.message || "Unable to update the refresh session.");
  }
}

startButton.addEventListener("click", () => sendCommand("start"));
stopButton.addEventListener("click", () => sendCommand("stop"));

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || selectedTabId === null ||
      (!changes.sessions && !changes.activeSchedules && !changes.activeUrls)) return;
  if (changes.sessions) {
    selectedSession = (changes.sessions.newValue || {})[selectedTabId] || null;
  }
  if (changes.activeSchedules) {
    selectedSchedule = (changes.activeSchedules.newValue || {})[selectedTabId] || null;
  }
  if (changes.activeUrls || changes.sessions) {
    syncSelectedTab();
  } else {
    render();
  }
});

chrome.tabs.onActivated.addListener(() => syncSelectedTab());
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId === selectedTabId && (changeInfo.url || changeInfo.status === "complete")) {
    const url = tab.url || changeInfo.url || "";
    targetDomain.textContent = displayPage(url);
    targetDomain.title = url;
    if (changeInfo.url) syncSelectedTab();
  }
});

window.setInterval(render, 1000);
syncSelectedTab();
