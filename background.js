const MIN_DELAY_SECONDS = 241;
const MAX_DELAY_SECONDS = 599;
const MIN_SEPARATION_MS = 60_000;
const SESSION_KEY = "sessions";
const SCHEDULE_KEY = "activeSchedules";
const URL_KEY = "activeUrls";
const LAST_RELOAD_KEY = "lastReloadAt";
const ALARM_PREFIX = "alarm_tab_";
let stateUpdates = Promise.resolve();
let alarmRuns = Promise.resolve();

function alarmName(tabId) {
  return `${ALARM_PREFIX}${tabId}`;
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

function getRandomDelay(previousDelaySeconds) {
  const minimumDifference = previousDelaySeconds === null
    ? 0
    : Math.floor(Math.random() * 16) + 15;
  const choices = [];

  for (let seconds = MIN_DELAY_SECONDS; seconds <= MAX_DELAY_SECONDS; seconds += 1) {
    if (previousDelaySeconds === null ||
        Math.abs(seconds - previousDelaySeconds) >= minimumDifference) {
      choices.push(seconds);
    }
  }

  return {
    seconds: choices[Math.floor(Math.random() * choices.length)],
    minimumDifference
  };
}

function conflicts(timestamp, schedules, excludedTabId) {
  return Object.entries(schedules).some(([key, schedule]) => {
    return Number(key) !== excludedTabId &&
      Number.isFinite(schedule && schedule.targetTimestamp) &&
      Math.abs(timestamp - schedule.targetTimestamp) < MIN_SEPARATION_MS;
  });
}

function firstOpenTimestamp(timestamp, schedules, excludedTabId) {
  const otherTargets = Object.entries(schedules)
    .filter(([key, schedule]) =>
      Number(key) !== excludedTabId && Number.isFinite(schedule && schedule.targetTimestamp))
    .map(([, schedule]) => schedule.targetTimestamp)
    .sort((a, b) => a - b);

  for (const otherTarget of otherTargets) {
    if (Math.abs(timestamp - otherTarget) < MIN_SEPARATION_MS) {
      timestamp = otherTarget + MIN_SEPARATION_MS;
    }
  }
  return timestamp;
}

function findNextSchedule(baseTimestamp, previousDelaySeconds, schedules, tabId) {
  const { seconds: preferredDelay, minimumDifference } = getRandomDelay(previousDelaySeconds);
  const eligibleDelays = [];

  for (let seconds = MIN_DELAY_SECONDS; seconds <= MAX_DELAY_SECONDS; seconds += 1) {
    if (previousDelaySeconds === null ||
        Math.abs(seconds - previousDelaySeconds) >= minimumDifference) {
      eligibleDelays.push(seconds);
    }
  }

  for (let index = eligibleDelays.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [eligibleDelays[index], eligibleDelays[swapIndex]] =
      [eligibleDelays[swapIndex], eligibleDelays[index]];
  }

  for (const interval of eligibleDelays) {
    const targetTimestamp = baseTimestamp + interval * 1000;
    if (!conflicts(targetTimestamp, schedules, tabId)) {
      return { targetTimestamp, interval, deferred: false };
    }
  }

  let targetTimestamp = baseTimestamp + (MAX_DELAY_SECONDS + 1) * 1000;
  if (previousDelaySeconds !== null) {
    targetTimestamp = Math.max(
      targetTimestamp,
      baseTimestamp + (previousDelaySeconds + minimumDifference) * 1000
    );
  }
  targetTimestamp = firstOpenTimestamp(targetTimestamp, schedules, tabId);

  return { targetTimestamp, interval: preferredDelay, deferred: true };
}

async function readState() {
  const stored = await chrome.storage.local.get([SESSION_KEY, SCHEDULE_KEY, URL_KEY, LAST_RELOAD_KEY]);
  return {
    sessions: stored[SESSION_KEY] || {},
    activeSchedules: stored[SCHEDULE_KEY] || {},
    activeUrls: stored[URL_KEY] || {},
    lastReloadAt: Number.isFinite(stored[LAST_RELOAD_KEY]) ? stored[LAST_RELOAD_KEY] : 0
  };
}

function updateState(update) {
  const operation = stateUpdates.then(async () => {
    const state = await readState();
    const result = await update(state);
    await chrome.storage.local.set({
      [SESSION_KEY]: state.sessions,
      [SCHEDULE_KEY]: state.activeSchedules,
      [URL_KEY]: state.activeUrls,
      [LAST_RELOAD_KEY]: state.lastReloadAt
    });
    return result;
  });
  stateUpdates = operation.catch(() => {});
  return operation;
}

async function removeSession(tabId) {
  return updateState(async ({ sessions, activeSchedules, activeUrls }) => {
    const session = sessions[tabId];
    delete sessions[tabId];
    delete activeSchedules[tabId];
    if (session && session.urlKey && Number(activeUrls[session.urlKey]) === tabId) {
      delete activeUrls[session.urlKey];
    }
    for (const [urlKey, ownerTabId] of Object.entries(activeUrls)) {
      if (Number(ownerTabId) === tabId) delete activeUrls[urlKey];
    }
    await chrome.alarms.clear(alarmName(tabId));
  });
}

async function startSession(tabId) {
  return updateState(async ({ sessions, activeSchedules, activeUrls }) => {
    const tab = await chrome.tabs.get(tabId);
    const urlKey = normalizeUrl(tab.url);
    if (!urlKey) throw new Error("TabPulse can only refresh regular HTTP or HTTPS pages.");

    const registeredTabId = Number(activeUrls[urlKey]);
    if (Number.isInteger(registeredTabId) && registeredTabId !== tabId) {
      const registeredSession = sessions[registeredTabId];
      let registeredTab = null;
      try {
        registeredTab = await chrome.tabs.get(registeredTabId);
      } catch {
        registeredTab = null;
      }

      if (registeredTab && registeredSession &&
          registeredSession.urlKey === urlKey &&
          normalizeUrl(registeredTab.url) === urlKey) {
        const error = new Error(
          `Duplicate URL Detected: This page is already active on Tab #${registeredTabId}. Simultaneous sessions on identical pages are blocked.`
        );
        error.duplicateTabId = registeredTabId;
        throw error;
      }

      delete activeUrls[urlKey];
      delete sessions[registeredTabId];
      delete activeSchedules[registeredTabId];
      for (const [registeredUrl, ownerTabId] of Object.entries(activeUrls)) {
        if (Number(ownerTabId) === registeredTabId) delete activeUrls[registeredUrl];
      }
      await chrome.alarms.clear(alarmName(registeredTabId));
    }

    const previousSession = sessions[tabId];
    if (previousSession && previousSession.urlKey && previousSession.urlKey !== urlKey &&
        Number(activeUrls[previousSession.urlKey]) === tabId) {
      delete activeUrls[previousSession.urlKey];
    }

    const schedule = findNextSchedule(Date.now(), null, activeSchedules, tabId);
    const session = {
      tabId,
      url: tab.url,
      urlKey,
      title: tab.title || "",
      refreshCount: 0,
      failureCount: 0,
      lastRefreshedAt: null,
      lastError: null,
      lastIntervalSeconds: schedule.interval,
      inFlight: false
    };

    sessions[tabId] = session;
    activeSchedules[tabId] = schedule;
    activeUrls[urlKey] = tabId;
    await chrome.alarms.create(alarmName(tabId), { when: schedule.targetTimestamp });
    return { session, schedule };
  });
}

async function restoreSessions() {
  await updateState(async ({ sessions, activeSchedules, activeUrls }) => {
    const originalSchedules = { ...activeSchedules };
    const repairedSchedules = {};
    const repairedUrls = {};

    for (const [key, session] of Object.entries(sessions)) {
      const tabId = Number(key);
      if (!Number.isInteger(tabId) || !session || session.tabId !== tabId) {
        delete sessions[key];
        await chrome.alarms.clear(alarmName(tabId));
        continue;
      }

      let tab;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch (error) {
        console.error(`TabPulse could not restore tab ${tabId}:`, error);
        delete sessions[key];
        delete activeSchedules[key];
        await chrome.alarms.clear(alarmName(tabId));
        continue;
      }

      const urlKey = normalizeUrl(tab.url);
      if (!urlKey || (repairedUrls[urlKey] !== undefined && repairedUrls[urlKey] !== tabId)) {
        delete sessions[key];
        delete activeSchedules[key];
        await chrome.alarms.clear(alarmName(tabId));
        continue;
      }
      session.url = tab.url;
      session.urlKey = urlKey;
      session.title = tab.title || session.title || "";
      repairedUrls[urlKey] = tabId;

      let schedule = activeSchedules[key];
      if (!schedule && Number.isFinite(session.targetTimestamp)) {
        schedule = {
          targetTimestamp: session.targetTimestamp,
          interval: session.previousDelaySeconds || session.lastIntervalSeconds || MIN_DELAY_SECONDS,
          deferred: false
        };
      }

      if (session.inFlight || !schedule ||
          !Number.isFinite(schedule.targetTimestamp) ||
          !Number.isInteger(schedule.interval) ||
          schedule.interval < MIN_DELAY_SECONDS ||
          schedule.interval > MAX_DELAY_SECONDS) {
        schedule = findNextSchedule(
          Date.now(),
          Number.isInteger(session.lastIntervalSeconds) ? session.lastIntervalSeconds : null,
          repairedSchedules,
          tabId
        );
        session.lastIntervalSeconds = schedule.interval;
        session.inFlight = false;
      } else if (conflicts(schedule.targetTimestamp, repairedSchedules, tabId)) {
        schedule = findNextSchedule(
          Date.now(),
          Number.isInteger(session.lastIntervalSeconds) ? session.lastIntervalSeconds : schedule.interval,
          repairedSchedules,
          tabId
        );
        session.lastIntervalSeconds = schedule.interval;
      }

      sessions[tabId] = session;
      repairedSchedules[tabId] = schedule;
      await chrome.alarms.create(alarmName(tabId), {
        when: Math.max(Date.now(), schedule.targetTimestamp)
      });
    }

    for (const key of Object.keys(originalSchedules)) {
      if (!sessions[key]) await chrome.alarms.clear(alarmName(Number(key)));
    }

    for (const key of Object.keys(activeSchedules)) delete activeSchedules[key];
    Object.assign(activeSchedules, repairedSchedules);
    for (const key of Object.keys(activeUrls)) delete activeUrls[key];
    Object.assign(activeUrls, repairedUrls);
  });
}

async function handleTabUrlUpdated(tabId, changeInfo, tab) {
  if (!changeInfo.url) return;
  await updateState(async ({ sessions, activeSchedules, activeUrls }) => {
    const session = sessions[tabId];
    if (!session) return;

    const urlKey = normalizeUrl(tab.url || changeInfo.url);
    if (!urlKey || urlKey !== session.urlKey) {
      delete sessions[tabId];
      delete activeSchedules[tabId];
      if (Number(activeUrls[session.urlKey]) === tabId) delete activeUrls[session.urlKey];
      await chrome.alarms.clear(alarmName(tabId));
      return;
    }

    session.url = tab.url || changeInfo.url;
    session.title = tab.title || session.title || "";
  });
}

async function claimDueSchedule(tabId, alarm) {
  return updateState(async (state) => {
    const { sessions, activeSchedules, lastReloadAt } = state;
    const session = sessions[tabId];
    const schedule = activeSchedules[tabId];
    if (!session || !schedule) {
      await chrome.alarms.clear(alarm.name);
      return null;
    }
    if (session.inFlight) return null;
    if (Date.now() < schedule.targetTimestamp) {
      await chrome.alarms.create(alarm.name, { when: schedule.targetTimestamp });
      return null;
    }

    const now = Date.now();
    const earliestAllowed = Math.max(now, lastReloadAt + MIN_SEPARATION_MS);
    const safeTimestamp = firstOpenTimestamp(earliestAllowed, activeSchedules, tabId);
    if (safeTimestamp > now) {
      activeSchedules[tabId] = { ...schedule, targetTimestamp: safeTimestamp, deferred: true };
      await chrome.alarms.create(alarm.name, { when: safeTimestamp });
      return null;
    }

    session.inFlight = true;
    // Persist the actual execution slot before invoking reload; alarm runs are serialized below.
    state.lastReloadAt = now;
    await chrome.alarms.clear(alarm.name);
    return { ...session, schedule: { ...schedule } };
  });
}

async function finishRefresh(tabId, claimedSession, error) {
  await updateState(async ({ sessions, activeSchedules }) => {
    const session = sessions[tabId];
    const currentSchedule = activeSchedules[tabId];
    if (!session || !session.inFlight || !currentSchedule ||
        currentSchedule.targetTimestamp !== claimedSession.schedule.targetTimestamp) return;

    delete activeSchedules[tabId];
    if (error) {
      session.failureCount = (session.failureCount || 0) + 1;
      session.lastError = error.message || "The browser could not reload this tab.";
    } else {
      session.refreshCount = (session.refreshCount || 0) + 1;
      session.lastRefreshedAt = Date.now();
      session.lastError = null;
    }

    const nextSchedule = findNextSchedule(
      Date.now(),
      session.lastIntervalSeconds,
      activeSchedules,
      tabId
    );
    session.lastIntervalSeconds = nextSchedule.interval;
    session.inFlight = false;
    activeSchedules[tabId] = nextSchedule;
    await chrome.alarms.create(alarmName(tabId), { when: nextSchedule.targetTimestamp });
  });
}

async function handleAlarm(alarm) {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;

  const tabId = Number(alarm.name.slice(ALARM_PREFIX.length));
  if (!Number.isInteger(tabId)) return;

  const claimedSession = await claimDueSchedule(tabId, alarm);
  if (!claimedSession) return;

  try {
    await chrome.tabs.get(tabId);
  } catch {
    await removeSession(tabId);
    return;
  }

  try {
    await chrome.tabs.reload(tabId, { bypassCache: false });
    await finishRefresh(tabId, claimedSession, null);
  } catch (error) {
    console.error(`TabPulse could not reload tab ${tabId}:`, error);
    await finishRefresh(tabId, claimedSession, error);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !["start", "stop"].includes(message.type) || !Number.isInteger(message.tabId)) {
    sendResponse({ ok: false, error: "Invalid TabPulse command." });
    return false;
  }

  const operation = message.type === "start"
    ? startSession(message.tabId)
    : removeSession(message.tabId).then(() => null);

  operation.then(
    (result) => sendResponse({
      ok: true,
      session: result && result.session || null,
      schedule: result && result.schedule || null
    }),
    (error) => {
      console.error(`TabPulse ${message.type} failed for tab ${message.tabId}:`, error);
      sendResponse({
        ok: false,
        error: error.message || "The command failed.",
        duplicateTabId: error.duplicateTabId || null
      });
    }
  );
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  removeSession(tabId).catch((error) => console.error(`TabPulse cleanup failed for tab ${tabId}:`, error));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  handleTabUrlUpdated(tabId, changeInfo, tab)
    .catch((error) => console.error(`TabPulse navigation cleanup failed for tab ${tabId}:`, error));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  const operation = alarmRuns.then(() => handleAlarm(alarm));
  alarmRuns = operation.catch((error) => console.error("TabPulse alarm handling failed:", error));
});

chrome.runtime.onStartup.addListener(() => {
  restoreSessions().catch((error) => console.error("TabPulse session restore failed:", error));
});

chrome.runtime.onInstalled.addListener(() => {
  restoreSessions().catch((error) => console.error("TabPulse session restore failed:", error));
});

restoreSessions().catch((error) => console.error("TabPulse session restore failed:", error));
