// Background service worker

chrome.runtime.onInstalled.addListener(() => {
  console.log("SFCC Checkout Debugger installed")
})

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "openDevTools") {
    // Open DevTools programmatically
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.debugger.attach({ tabId: tabs[0].id }, "1.0", () => {
          chrome.debugger.sendCommand({ tabId: tabs[0].id }, "Runtime.enable")
        })
      }
    })
  } else if (message.type === "networkCall" || message.type === "error" || message.type === "debugLog") {
    // Forward messages to devtools panel
    chrome.runtime.sendMessage(message)
  }
})

// Handle tab updates to restart monitoring
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    if (
      tab.url.includes("force.com") ||
      tab.url.includes("salesforce.com") ||
      tab.url.includes("experience.salesforce.com")
    ) {
      chrome.tabs.sendMessage(tabId, { action: "startMonitoring" })
    }
  }
})
