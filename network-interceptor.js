// Network interceptor to capture fetch and XMLHttpRequest calls
;(() => {

  // Store original functions
  const originalFetch = window.fetch
  const originalXHROpen = XMLHttpRequest.prototype.open
  const originalXHRSend = XMLHttpRequest.prototype.send

  // Helper function to extract meaningful URL name
  function extractUrlName(url) {
    try {
      const urlObj = new URL(url)
      const pathname = urlObj.pathname
      const search = urlObj.search

      // Extract the last meaningful segment from the path
      const pathSegments = pathname.split("/").filter((segment) => segment.length > 0)
      let lastSegment = pathSegments[pathSegments.length - 1]

      // Handle special cases
      if (lastSegment === "active" && pathSegments.length > 1) {
        // For /checkouts/active, show "checkouts/active"
        lastSegment = pathSegments[pathSegments.length - 2] + "/" + lastSegment
      } else if (lastSegment && lastSegment.length > 20) {
        // If the last segment is very long (like an ID), use the previous segment
        const prevSegment = pathSegments[pathSegments.length - 2]
        if (prevSegment && prevSegment.length < 20) {
          lastSegment = prevSegment
        }
      }

      // Always include query parameters if they exist
      return lastSegment + search
    } catch (error) {
      console.warn("Failed to extract URL name:", error)
      return url
    }
  }

  // Helper function to safely stringify data
  function safeStringify(data) {
    try {
      if (typeof data === "string") return data
      return JSON.stringify(data)
    } catch (error) {
      return String(data)
    }
  }

  // Helper function to safely parse JSON
  function safeParse(data) {
    try {
      if (typeof data === "string") {
        return JSON.parse(data)
      }
      return data
    } catch (error) {
      return data
    }
  }

  // Intercept fetch
  window.fetch = async function (...args) {
    const startTime = performance.now()
    const [resource, options = {}] = args

    const url = typeof resource === "string" ? resource : resource.url
    const method = options.method || "GET"
    const requestHeaders = options.headers || {}
    const requestBody = options.body

    // Parse request body if it's a string
    let parsedRequestBody = null
    if (requestBody) {
      parsedRequestBody = safeParse(requestBody)
    }

    try {
      const response = await originalFetch.apply(this, args)
      const endTime = performance.now()
      const duration = Math.round(endTime - startTime)

      // Clone response to read body without consuming it
      const responseClone = response.clone()
      let responseData = null

      try {
        const responseText = await responseClone.text()
        responseData = responseText ? safeParse(responseText) : null
      } catch (error) {
        console.warn("Failed to read response body:", error)
      }

      // Create call data object
      const callData = {
        url: url,
        urlName: extractUrlName(url),
        method: method,
        status: response.status,
        duration: duration,
        timestamp: Date.now(),
        requestHeaders: requestHeaders,
        requestBody: parsedRequestBody,
        responseBody: responseData,
        response: responseData, // Keep both for backward compatibility
      }

      // Send to content script
      window.postMessage(
        {
          type: "SFCC_NETWORK_CALL",
          callData: callData,
        },
        "*",
      )

      return response
    } catch (error) {
      const endTime = performance.now()
      const duration = Math.round(endTime - startTime)

      // Create error call data
      const callData = {
        url: url,
        urlName: extractUrlName(url),
        method: method,
        status: 0,
        duration: duration,
        timestamp: Date.now(),
        requestHeaders: requestHeaders,
        requestBody: parsedRequestBody,
        responseBody: null,
        response: null,
        error: error.message,
      }

      // Send to content script
      window.postMessage(
        {
          type: "SFCC_NETWORK_CALL",
          callData: callData,
        },
        "*",
      )

      throw error
    }
  }

  // Intercept XMLHttpRequest
  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    this._sfccMethod = method
    this._sfccUrl = url
    this._sfccStartTime = performance.now()
    return originalXHROpen.call(this, method, url, ...args)
  }

  XMLHttpRequest.prototype.send = function (body) {
    
    let parsedRequestBody = null

    if (body) {
      parsedRequestBody = safeParse(body)
    }

    // Store request data
    this._sfccRequestBody = parsedRequestBody

    // Override onreadystatechange to capture response
    const originalOnReadyStateChange = this.onreadystatechange

    this.onreadystatechange = () => {
      if (this.readyState === 4) {
        const endTime = performance.now()
        const duration = Math.round(endTime - this._sfccStartTime)

        let responseData = null
        try {
          responseData = this.responseText ? safeParse(this.responseText) : null
        } catch (error) {
          console.warn("Failed to parse XHR response:", error)
        }

        // Create call data object
        const callData = {
          url: this._sfccUrl,
          urlName: extractUrlName(this._sfccUrl),
          method: this._sfccMethod,
          status: this.status,
          duration: duration,
          timestamp: Date.now(),
          requestHeaders: {}, // XHR headers are harder to capture
          requestBody: this._sfccRequestBody,
          responseBody: responseData,
          response: responseData, // Keep both for backward compatibility
        }

        // Send to content script
        window.postMessage(
          {
            type: "SFCC_NETWORK_CALL",
            callData: callData,
          },
          "*",
        )
      }

      // Call original handler if it exists
      if (originalOnReadyStateChange) {
        originalOnReadyStateChange.call(this)
      }
    }

    return originalXHRSend.call(this, body)
  }

})()
