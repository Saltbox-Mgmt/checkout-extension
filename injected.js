// Injected script to monitor page-level events and console logs
;(() => {
  // Monitor console errors
  const originalConsoleError = console.error
  console.error = (...args) => {
    // Send error to content script
    window.postMessage(
      {
        type: "SFCC_DEBUG_ERROR",
        data: {
          message: args.join(" "),
          stack: new Error().stack,
        },
      },
      "*",
    )

    return originalConsoleError.apply(console, arguments)
  }

  // Monitor SFCC-specific events
  const originalDispatchEvent = EventTarget.prototype.dispatchEvent
  EventTarget.prototype.dispatchEvent = function (event) {
    if (event.type && event.type.includes("checkout")) {
      window.postMessage(
        {
          type: "SFCC_DEBUG_EVENT",
          data: {
            eventType: event.type,
            target: event.target.tagName,
            detail: event.detail,
          },
        },
        "*",
      )
    }

    return originalDispatchEvent.call(this, event)
  }

  // Listen for messages from content script
  window.addEventListener("message", (event) => {
    if (event.source !== window) return

    if (event.data.type === "SFCC_DEBUG_ERROR") {
      // Forward to content script
      document.dispatchEvent(
        new CustomEvent("sfccDebugError", {
          detail: event.data.data,
        }),
      )
    } else if (event.data.type === "SFCC_DEBUG_EVENT") {
      document.dispatchEvent(
        new CustomEvent("sfccDebugEvent", {
          detail: event.data.data,
        }),
      )
    }
  })

  console.log("SFCC Debug injected script loaded")
})()
