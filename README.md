<div align="center">

# TabPulse

### A tab-scoped Chrome auto-refresher with randomized intervals and collision-aware scheduling

**Refresh the page you’re on—not the homepage—with Manifest V3 alarms, per-tab sessions, URL duplicate protection, and a live countdown.**

![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285F4?logo=googlechrome&logoColor=white)
![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-34A853?logo=googlechrome&logoColor=white)
![License](https://img.shields.io/badge/license-not%20specified-lightgrey)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)
![Stars](https://img.shields.io/badge/stars-welcome-yellow?logo=github)
![Forks](https://img.shields.io/badge/forks-welcome-blue?logo=github)

[Features](#-features) · [Why TabPulse?](#-why-tabpulse) · [How It Works](#-how-it-works) · [Install](#-quick-start) · [Permissions](#-permissions--privacy) · [Contribute](#-contributing)

</div>

TabPulse is a **Chrome tab auto-refresh extension** for people who need to periodically reload pages while keeping each session isolated, visible, and under their control. Its randomized timing and staggered multi-tab scheduling help avoid synchronized reload bursts; TabPulse is not intended to bypass anti-bot systems or website rate limits.

## ✨ Features

- 🎯 **Isolated tab sessions** — Each refresh loop is bound to the tab ID selected when you start it. Other tabs and windows are not included.
- ⏱️ **Randomized refresh intervals** — Schedules intervals from **241 to 599 seconds**. Consecutive intervals differ by at least 15 seconds, with the required variation selected between 15 and 30 seconds.
- 🧭 **Cross-tab collision prevention** — A shared schedule registry aims to keep refreshes at least **60 seconds apart** across active TabPulse sessions.
- 🔒 **Duplicate URL lockout** — Prevents sessions on URLs that normalize to the same page. URL fragments and trailing path slashes are ignored; query strings remain significant.
- 📍 **Current-page reload** — Uses `chrome.tabs.reload(tabId, { bypassCache: false })` to reload that tab’s current page instead of navigating to a stored homepage URL. A site may still redirect as part of its own response.
- 💤 **Manifest V3 lifecycle support** — Stores session state and target timestamps in `chrome.storage.local`, and schedules work with `chrome.alarms` so a sleeping service worker does not need to remain running between refreshes.
- 🌙 **Dark popup UI** — Shows the selected page, tab ID, session status, refresh countdown, refresh history, and duplicate-URL warning.
- 🧹 **Automatic cleanup** — Stops sessions and releases URL reservations when a tab closes or navigates to a different normalized URL.

> **Scheduling note:** TabPulse prefers intervals in the 241–599 second range. If the 60-second separation rule leaves no available time in that range, it keeps the session active and defers it to the next collision-free slot. In that exceptional case, the wait may exceed 599 seconds.

## 📊 Why TabPulse?

| Capability | Basic auto-refreshers | TabPulse |
|---|---|---|
| Refresh target | May use broad or window-level behavior | Session bound to one `tabId` |
| Timing | Often fixed intervals | Randomized 241–599 second intervals |
| Multiple tabs | Can synchronize reloads | Shared schedule registry with a 60-second separation target |
| Duplicate pages | May allow repeated sessions | Normalized URL lockout with a popup warning |
| Reload destination | May navigate to a configured URL | Reloads the tab’s current URL |
| Manifest V3 lifecycle | May rely on a continuously running background page | Persists schedules with `chrome.storage.local` and `chrome.alarms` |

## 🧠 How It Works

```text
Popup selects active tab
        │
        ▼
Normalize current URL ──► Check active URL registry
        │                         │
        │                         └── Duplicate owner found → reject and show warning
        ▼
Choose randomized interval (241–599 seconds)
        │
        ▼
Find collision-free schedule (≥60 seconds from other sessions)
        │
        ▼
Persist session + URL + target timestamp in chrome.storage.local
        │
        ▼
Create tab-specific chrome.alarms alarm
        │
        ▼
Alarm fires ──► chrome.tabs.reload(tabId, { bypassCache: false })
        │
        ▼
Record result and reserve the next collision-free schedule
```

Each active session has its own tab ID, normalized URL, and target timestamp. Schedule and URL-registry updates are serialized in the service worker to reduce races when several tabs start or alarms fire close together.

### URL normalization

Before comparing pages, TabPulse:

1. Accepts only regular `http:` and `https:` page URLs.
2. Removes the URL fragment, such as `#reviews`.
3. Removes trailing slashes from the path.
4. Keeps the query string, so URLs with different query parameters are treated as different pages.

For example, `https://example.com/item/` and `https://example.com/item#reviews` normalize to the same URL. A page with a different query string remains distinct.

## 🚀 Quick Start

1. **Download or clone** the TabPulse source code to your computer.
2. Open Chrome and visit **`chrome://extensions`**.
3. Turn on **Developer mode** using the toggle in the top-right corner.
4. Select **Load unpacked**.
5. Choose the TabPulse project folder containing `manifest.json`.

To use it, open the page you want to refresh, select the TabPulse extension, and choose **Start Refresh**. The popup shows the session countdown and warns if another tab already has an active session for the same normalized URL.

## 🔐 Permissions & Privacy

| Permission | Why it is declared |
|---|---|
| `storage` | Stores active sessions, normalized URL ownership, schedule timestamps, and refresh status locally. |
| `alarms` | Schedules refresh events without keeping the service worker awake continuously. |
| `tabs` | Identifies the selected tab and reads the tab URL needed for URL comparison and session cleanup. |
| `activeTab` | Declared in the extension manifest. The current tab workflow uses the `tabs` permission; `activeTab` may be removable if it is not needed by future features. |

TabPulse does not inject scripts into pages, read page DOM content, or transmit telemetry. While a session is active, it stores the associated tab ID and page URL (and available title metadata) locally in Chrome storage. The extension uses Chrome’s tab reload API to reload the selected tab.

Use TabPulse only on pages you are authorized to refresh, and follow the site’s terms of service and rate limits. Randomized scheduling and collision prevention are for timing variation and reduced synchronized load—not for concealing automation or evading a site’s protections.

## 🤝 Contributing

Contributions are welcome. To help improve TabPulse:

- **Report a bug:** Include your Chrome version, the steps to reproduce, and any relevant extension error messages. Avoid posting private URLs or other sensitive information.
- **Suggest an improvement:** Describe the user problem and the behavior you would expect.
- **Open a pull request:** Keep changes focused, preserve tab isolation, and include a clear explanation of how you validated the change.

For scheduling or URL-registry changes, please test concurrent starts, duplicate normalized URLs, navigation cleanup, tab closure, and the 60-second separation behavior.

## ⭐ Support the Project

If TabPulse is useful to you, consider starring the repository and contributing a fix, test, or improvement. Stars and forks badges can be linked to repository counters once the project’s GitHub repository URL is established.

---

<div align="center">

**Thanks for checking out TabPulse.**

</div>
