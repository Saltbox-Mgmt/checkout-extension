// Network interceptor script - injected into page context
;(() => {
    console.log("SFCC Network Interceptor injected")
  
    // Store original functions
    const originalXHR = window.XMLHttpRequest
    const originalFetch = window.fetch
  
    // Helper function to check if URL is SFCC checkout related
    function isSFCCCheckoutCall(url) {
      const patterns = [
        "/webruntime/api/services/data/",
        "/commerce/webstores/",
        "/checkouts/",
        "/payments",
        "/shipping-address",
        "/billing-address",
        "/delivery-methods",
        "/taxes",
        "/inventory",
        "/cart-items",
        "/place-order",
        "/guest-checkout",
        "/inventory-reservations", // Add this new pattern
        // Add more patterns for broader coverage
        "/api/",
        "/services/",
        "salesforce.com",
        "force.com",
      ]
      return patterns.some((pattern) => url.toLowerCase().includes(pattern.toLowerCase()))
    }
  
    // Helper function to parse response
    function parseResponse(responseText) {
      try {
        return JSON.parse(responseText)
      } catch (e) {
        return responseText
      }
    }
  
    // Helper function to send data to content script
    function sendToContentScript(callData) {
      try {
        window.postMessage(
          {
            type: "SFCC_NETWORK_CALL",
            callData: callData,
          },
          "*",
        )
      } catch (error) {
        console.error("Error sending to content script:", error)
      }
    }
  
    // Override XMLHttpRequest
    window.XMLHttpRequest = () => {
      const xhr = new originalXHR()
      const originalOpen = xhr.open
      const originalSend = xhr.send
  
      const requestData = {}
  
      xhr.open = function (method, url, async, user, password) {
        requestData.method = method
        requestData.url = url
        requestData.startTime = Date.now()
  
        if (isSFCCCheckoutCall(url)) {
          console.log("XHR Open (SFCC):", method, url)
        }
  
        return originalOpen.apply(this, arguments)
      }
  
      xhr.send = function (data) {
        requestData.requestBody = data
  
        // Store original handlers
        const originalOnReadyStateChange = xhr.onreadystatechange
        const originalOnLoad = xhr.onload
        const originalOnError = xhr.onerror
  
        // Override onreadystatechange
        xhr.onreadystatechange = function () {
          if (xhr.readyState === 4 && isSFCCCheckoutCall(requestData.url)) {
            const callData = {
              ...requestData,
              status: xhr.status,
              statusText: xhr.statusText,
              response: parseResponse(xhr.responseText),
              duration: Date.now() - requestData.startTime,
              timestamp: Date.now(),
              type: "xhr",
            }
  
            console.log("SFCC XHR Call captured:", callData)
            sendToContentScript(callData)
          }
  
          if (originalOnReadyStateChange) {
            originalOnReadyStateChange.apply(this, arguments)
          }
        }
  
        // Override onload as backup
        xhr.onload = function () {
          if (isSFCCCheckoutCall(requestData.url)) {
            const callData = {
              ...requestData,
              status: xhr.status,
              statusText: xhr.statusText,
              response: parseResponse(xhr.responseText),
              duration: Date.now() - requestData.startTime,
              timestamp: Date.now(),
              type: "xhr",
            }
  
            console.log("SFCC XHR Call captured (onload):", callData)
            sendToContentScript(callData)
          }
  
          if (originalOnLoad) {
            originalOnLoad.apply(this, arguments)
          }
        }
  
        // Override onerror
        xhr.onerror = function () {
          if (isSFCCCheckoutCall(requestData.url)) {
            const callData = {
              ...requestData,
              status: xhr.status || 0,
              statusText: xhr.statusText || "Network Error",
              response: { error: "Network request failed" },
              duration: Date.now() - requestData.startTime,
              timestamp: Date.now(),
              type: "xhr",
            }
  
            console.log("SFCC XHR Error captured:", callData)
            sendToContentScript(callData)
          }
  
          if (originalOnError) {
            originalOnError.apply(this, arguments)
          }
        }
  
        return originalSend.apply(this, arguments)
      }
  
      return xhr
    }
  
    // Override fetch
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : input.url
      const method = init?.method || "GET"
      const startTime = Date.now()
  
      if (isSFCCCheckoutCall(url)) {
        console.log("Fetch called (SFCC):", method, url)
      }
  
      return originalFetch
        .apply(this, arguments)
        .then((response) => {
          if (isSFCCCheckoutCall(url)) {
            // Clone response to read it without consuming the original
            const responseClone = response.clone()
  
            responseClone
              .text()
              .then((responseText) => {
                const callData = {
                  method,
                  url,
                  status: response.status,
                  statusText: response.statusText,
                  response: parseResponse(responseText),
                  requestBody: init?.body,
                  duration: Date.now() - startTime,
                  timestamp: Date.now(),
                  type: "fetch",
                }
  
                console.log("SFCC Fetch Call captured:", callData)
                sendToContentScript(callData)
              })
              .catch((err) => {
                console.error("Error reading fetch response:", err)
  
                // Send basic call data even if we can't read response
                const callData = {
                  method,
                  url,
                  status: response.status,
                  statusText: response.statusText,
                  response: { error: "Could not read response" },
                  requestBody: init?.body,
                  duration: Date.now() - startTime,
                  timestamp: Date.now(),
                  type: "fetch",
                }
  
                sendToContentScript(callData)
              })
          }
  
          return response
        })
        .catch((error) => {
          if (isSFCCCheckoutCall(url)) {
            const callData = {
              method,
              url,
              status: 0,
              statusText: "Network Error",
              response: { error: error.message },
              requestBody: init?.body,
              duration: Date.now() - startTime,
              timestamp: Date.now(),
              type: "fetch",
            }
  
            console.log("SFCC Fetch Error captured:", callData)
            sendToContentScript(callData)
          }
  
          throw error
        })
    }
  
    // Also monitor any existing network activity by checking for common SFCC objects
    function checkExistingActivity() {
      // Look for common SFCC/Commerce objects in window
      const sfccObjects = ["sfcc", "commerce", "checkout", "cart"]
      const foundObjects = []
  
      sfccObjects.forEach((obj) => {
        if (window[obj]) {
          foundObjects.push(obj)
        }
      })
  
      if (foundObjects.length > 0) {
        console.log("Found SFCC objects:", foundObjects)
  
        // Send notification about detected SFCC environment
        sendToContentScript({
          method: "INFO",
          url: window.location.href,
          status: 200,
          statusText: "SFCC Environment Detected",
          response: {
            detectedObjects: foundObjects,
            userAgent: navigator.userAgent,
            timestamp: Date.now(),
          },
          duration: 0,
          timestamp: Date.now(),
          type: "environment",
        })
      }
    }
  
    // Check for existing activity after a short delay
    setTimeout(checkExistingActivity, 1000)
  
    console.log("Network interception setup complete")
  })()
  