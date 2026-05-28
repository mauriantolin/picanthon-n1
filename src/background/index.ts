// Service worker. In Phase 1 the agent runs in the side panel (see
// chat-transport.ts), so the worker no longer brokers the agent loop. It only
// wires the toolbar icon to open the side panel. Future background-only work
// (e.g. chrome.tabs.captureVisibleTab for the sketch canvas) lands here.

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('setPanelBehavior failed', err))
})
