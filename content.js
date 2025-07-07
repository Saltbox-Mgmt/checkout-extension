// Salesforce API integration for log retrieval - embedded in content script
class SalesforceAPI {
  constructor() {
    this.baseUrl = null
    this.sessionId = null
    this.isConnected = false
    this.orgId = null
    this.chrome = window.chrome || window.chrome
  }

  async connect(instanceUrl, sessionId) {
    try {
      this.baseUrl = instanceUrl.endsWith("/") ? instanceUrl.slice(0, -1) : instanceUrl
      this.sessionId = sessionId

      const versionUrl = `${this.baseUrl}/services/data/`
      const versionResponse = await fetch(versionUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.sessionId}`,
          Accept: "application/json",
        },
        mode: "cors",
        credentials: "omit",
      })

      if (!versionResponse.ok) {
        throw new Error(`Connection failed: ${versionResponse.status}`)
      }

      this.isConnected = true
      return { success: true }
    } catch (error) {
      this.isConnected = false
      return { success: false, error: error.message }
    }
  }

  async makeRequest(endpoint, options = {}) {
    if (!this.isConnected || !this.sessionId) {
      throw new Error("Not connected to Salesforce")
    }

    const url = `${this.baseUrl}${endpoint}`
    const requestOptions = {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${this.sessionId}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options.headers,
      },
      mode: "cors",
      credentials: "omit",
    }

    if (options.body) {
      requestOptions.body = JSON.stringify(options.body)
    }

    const response = await fetch(url, requestOptions)

    if (!response.ok) {
      if (response.status === 401) {
        this.isConnected = false
        throw new Error("Session expired")
      }
      throw new Error(`API request failed: ${response.status}`)
    }

    return await response.json()
  }

  async getDebugLogs(options = {}) {
    const { startTime = new Date(Date.now() - 60 * 60 * 1000), endTime = new Date(), maxRecords = 50 } = options

    const startTimeStr = startTime.toISOString()
    const endTimeStr = endTime.toISOString()

    const soql = `
      SELECT Id, Application, DurationMilliseconds, Location, LogLength, 
             LogUser.Name, Operation, Request, StartTime, Status
      FROM ApexLog 
      WHERE StartTime >= ${startTimeStr} 
      AND StartTime <= ${endTimeStr}
      AND Operation = 'UniversalPerfLogger'
      ORDER BY StartTime DESC
      LIMIT ${maxRecords}
    `

    const result = await this.makeRequest(`/services/data/v58.0/query?q=${encodeURIComponent(soql)}`)

    const logsToProcess = result.records.slice(0, Math.min(20, result.records.length))
    const logsWithContent = await Promise.all(
      logsToProcess.map(async (log) => {
        try {
          const logBody = await this.getLogBody(log.Id)
          const parsed = this.parseCommerceLogContent(logBody)
          return { ...log, body: logBody, parsed: parsed }
        } catch (error) {
          return { ...log, body: null, parsed: null, error: error.message }
        }
      }),
    )

    return { totalSize: result.totalSize, logs: logsWithContent }
  }

  async getLogBody(logId) {
    const response = await fetch(`${this.baseUrl}/services/data/v58.0/sobjects/ApexLog/${logId}/Body`, {
      headers: {
        Authorization: `Bearer ${this.sessionId}`,
        Accept: "text/plain",
      },
      mode: "cors",
      credentials: "omit",
    })

    if (!response.ok) {
      throw new Error(`Failed to get log body: ${response.status}`)
    }

    return await response.text()
  }

  parseCommerceLogContent(logBody) {
    if (!logBody) return null

    const lines = logBody.split("\n")
    const parsed = {
      errors: [],
      warnings: [],
      checkoutEvents: [],
      apiCalls: [],
      paymentEvents: [],
      cartEvents: [],
      webserviceCalls: [],
      apexClass: null,
      userInfo: null,
      performance: { totalTime: 0, cpuTime: 0, heapSize: 0 },
    }

    lines.forEach((line) => {
      if (line.includes("[EXTERNAL]|apex://")) {
        const apexMatch = line.match(/apex:\/\/([^/]+)\//)
        if (apexMatch) parsed.apexClass = apexMatch[1]
      }

      if (line.includes("|USER_INFO|")) {
        const userMatch = line.match(/\|([^|]+@[^|]+)\|/)
        if (userMatch) parsed.userInfo = userMatch[1]
      }

      if (line.includes("|FATAL_ERROR|") || line.includes("|ERROR|") || line.includes("|EXCEPTION_THROWN|")) {
        parsed.errors.push({ timestamp: this.extractTimestamp(line), message: line, type: "error" })
      }

      if (line.includes("checkout") || line.includes("Checkout")) {
        parsed.checkoutEvents.push({ timestamp: this.extractTimestamp(line), event: line, type: "checkout" })
      }

      if (line.includes("payment") || line.includes("Payment")) {
        parsed.paymentEvents.push({ timestamp: this.extractTimestamp(line), event: line, type: "payment" })
      }

      if (line.includes("cart") || line.includes("Cart")) {
        parsed.cartEvents.push({ timestamp: this.extractTimestamp(line), event: line, type: "cart" })
      }

      if (line.includes("|CALLOUT_REQUEST|") || line.includes("|CALLOUT_RESPONSE|")) {
        parsed.webserviceCalls.push({ timestamp: this.extractTimestamp(line), callout: line, type: "callout" })
      }
    })

    return parsed
  }

  extractTimestamp(line) {
    const match = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3})/)
    return match ? match[1] : null
  }
}

// Content script to monitor network calls and inject monitoring code
class SFCCMonitor {
  constructor() {
    this.isMonitoring = false
    this.networkCalls = []
    this.errors = []
    this.checkoutData = {}
    this.checkoutStatus = null
    this.salesforceLogs = []
    this.correlations = []
    this.activeTab = "network"
    this.activeFilter = null
    this.sessionStart = Date.now()
    this.contextValid = true
    this.chrome = window.chrome
    this.requirements = [
      { key: "shippingAddress", label: "Shipping Address", required: true },
      { key: "deliveryMethod", label: "Delivery Method", required: true },
      { key: "inventory", label: "Inventory", required: false },
      { key: "taxes", label: "Taxes", required: false },
      { key: "billingAddress", label: "Billing Address", required: true },
      { key: "payment", label: "Payment", required: true },
    ]
    this.correlationEngine = null
    this.analyzer = null
    this.init()
  }

  // Add context validation method
  isContextValid() {
    try {
      // Test if Chrome extension context is still valid
      if (!window.chrome || !window.chrome.runtime || !window.chrome.runtime.id) {
        this.contextValid = false
        return false
      }
      return this.contextValid
    } catch (error) {
      console.warn("Extension context invalid:", error)
      this.contextValid = false
      return false
    }
  }

  // Safe Chrome API wrapper
  async safeChromeCall(operation, fallback = null) {
    if (!this.isContextValid()) {
      console.warn("Chrome context invalid, skipping operation")
      return fallback
    }

    try {
      return await operation()
    } catch (error) {
      if (error.message.includes("Extension context invalidated")) {
        console.warn("Extension context invalidated during operation")
        this.contextValid = false
        return fallback
      }
      console.error("Chrome API error:", error)
      return fallback
    }
  }

  init() {
    // Wait for DOM to be ready
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.initializeAfterDOM())
    } else {
      this.initializeAfterDOM()
    }

    // Load analyzer and correlation engine
    this.loadAnalyzer()
    this.loadCorrelationEngine()

    // Listen for messages from popup and devtools with error handling
    if (this.isContextValid()) {
      try {
        window.chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
          this.handleMessage(message, sender, sendResponse)
        })
      } catch (error) {
        console.warn("Failed to add message listener:", error)
      }
    }

    // Listen for network calls from injected script
    window.addEventListener("message", (event) => {
      if (event.source !== window) return

      if (event.data.type === "SFCC_NETWORK_CALL") {
        this.handleNetworkCall(event.data.callData)
      } else if (event.data.type === "SFCC_ERROR") {
        this.handleError(event.data.errorData)
      }
    })

    // Monitor URL changes for single-page app navigation
    this.setupUrlMonitoring()
  }

  loadAnalyzer() {
    if (!this.isContextValid()) return

    try {
      const script = document.createElement("script")
      script.src = window.chrome.runtime.getURL("checkout-call-analyzer.js")
      script.onload = () => {
        console.log("✅ Checkout call analyzer loaded")
        if (window.CheckoutCallAnalyzer) {
          this.analyzer = new window.CheckoutCallAnalyzer()
          console.log("✅ Checkout call analyzer initialized")
        } else {
          console.error("❌ CheckoutCallAnalyzer not found on window object")
        }
        script.remove()
      }
      script.onerror = (error) => {
        console.error("❌ Failed to load checkout call analyzer:", error)
      }

      const head = document.head || document.getElementsByTagName("head")[0] || document.documentElement
      head.appendChild(script)
    } catch (error) {
      console.error("Failed to inject checkout call analyzer:", error)
    }
  }

  loadCorrelationEngine() {
    if (!this.isContextValid()) return

    try {
      const script = document.createElement("script")
      script.src = window.chrome.runtime.getURL("correlation-engine.js")
      script.onload = () => {
        console.log("✅ Correlation engine loaded")
        // Initialize the correlation engine after the script loads
        if (window.CorrelationEngine) {
          this.correlationEngine = new window.CorrelationEngine()
          console.log("✅ Correlation engine initialized")
        } else {
          console.error("❌ CorrelationEngine not found on window object")
        }
        script.remove()
      }
      script.onerror = (error) => {
        console.error("❌ Failed to load correlation engine:", error)
      }

      const head = document.head || document.getElementsByTagName("head")[0] || document.documentElement
      head.appendChild(script)
    } catch (error) {
      console.error("Failed to inject correlation engine:", error)
    }
  }

  handleMessage(message, sender, sendResponse) {
    try {
      if (message.action === "startMonitoring") {
        this.startMonitoring()
        sendResponse({ success: true })
      } else if (message.action === "stopMonitoring") {
        this.stopMonitoring()
        sendResponse({ success: true })
      } else if (message.action === "updateSalesforceLogs") {
        this.salesforceLogs = message.logs || []
        this.updatePanelContent()
        sendResponse({ success: true })
      }
    } catch (error) {
      console.error("Error handling message:", error)
      sendResponse({ success: false, error: error.message })
    }
  }

  setupUrlMonitoring() {
    let currentUrl = window.location.href
    const urlObserver = new MutationObserver(() => {
      if (window.location.href !== currentUrl) {
        currentUrl = window.location.href
        console.log("URL changed to:", currentUrl)
        this.handleUrlChange()
      }
    })

    // Start observing URL changes
    urlObserver.observe(document, { subtree: true, childList: true })

    // Also listen for popstate events (back/forward navigation)
    window.addEventListener("popstate", () => {
      setTimeout(() => this.handleUrlChange(), 100)
    })

    // Listen for pushstate/replacestate (programmatic navigation)
    const originalPushState = history.pushState
    const originalReplaceState = history.replaceState

    history.pushState = (...args) => {
      originalPushState.apply(history, args)
      setTimeout(() => this.handleUrlChange(), 100)
    }

    history.replaceState = (...args) => {
      originalReplaceState.apply(history, args)
      setTimeout(() => this.handleUrlChange(), 100)
    }
  }

  initializeAfterDOM() {
    // Double check that body exists
    if (!document.body) {
      setTimeout(() => this.initializeAfterDOM(), 100)
      return
    }

    // Check if we're on a checkout page
    if (this.isCheckoutPage()) {
      this.injectSidePanel()
      this.injectNetworkInterceptor()
      this.startMonitoring()
    }
  }

  handleUrlChange() {
    console.log("Handling URL change:", window.location.href)

    const shouldShowTab = this.isCheckoutPage()
    const tab = document.getElementById("sfcc-debugger-tab")
    const panel = document.getElementById("sfcc-debugger-panel")

    if (shouldShowTab && !tab) {
      // We're on a checkout page but tab doesn't exist - inject it
      console.log("Injecting side panel for checkout page")
      this.injectSidePanel()
      this.injectNetworkInterceptor()
      this.startMonitoring()
    } else if (!shouldShowTab && tab) {
      // We're not on a checkout page but tab exists - remove it
      console.log("Removing side panel - not a checkout page")
      if (tab) tab.remove()
      if (panel) panel.remove()
      this.stopMonitoring()
    } else if (shouldShowTab && tab) {
      // We're on a checkout page and tab exists - make sure it's visible
      const isOpen = panel && panel.style.right === "0px"
      if (!isOpen) {
        this.safeSetStyle(tab, "display", "inline-block", "important")
      }
    }
  }

  // Safe style setting method
  safeSetStyle(element, property, value, priority = "") {
    try {
      if (element && element.style) {
        if (priority) {
          element.style.setProperty(property, value, priority)
        } else {
          element.style[property] = value
        }
      }
    } catch (error) {
      console.warn("Failed to set style:", error)
    }
  }

  // Safe text content setting
  safeSetTextContent(element, text) {
    try {
      if (element) {
        element.textContent = text
      }
    } catch (error) {
      console.warn("Failed to set text content:", error)
    }
  }

  isCheckoutPage() {
    const path = window.location.pathname.toLowerCase()

    // Only show on explicit checkout pages
    const isCheckoutPage = path.includes("/checkout")

    // Exclude admin/settings pages even if they contain "checkout"
    const excludePatterns = [
      "/lightning/settings",
      "/lightning/setup",
      "/lightning/page",
      "/one/one.app",
      "/_ui/",
      "/apex/",
      "/setup/",
      "/lightning/o/",
      "/admin/",
      "/manage/",
      "/config/",
    ]

    const isExcluded = excludePatterns.some((pattern) => path.includes(pattern))

    // Show only on SFCC domains with /checkout in path and not excluded
    const shouldShow = this.isSFCCDomain() && isCheckoutPage && !isExcluded

    console.log("Checkout page check:", {
      path,
      isCheckoutPage,
      isExcluded,
      shouldShow,
    })

    return shouldShow
  }

  isSFCCDomain() {
    return (
      window.location.hostname.includes("force.com") ||
      window.location.hostname.includes("salesforce.com") ||
      window.location.hostname.includes("experience.salesforce.com") ||
      window.location.hostname.includes("site.com") ||
      window.location.hostname.includes("siteforce.com") ||
      window.location.pathname.includes("webruntime")
    )
  }

  injectNetworkInterceptor() {
    if (!this.isContextValid()) return

    try {
      // Create script element that loads the external injected script
      const script = document.createElement("script")
      script.src = window.chrome.runtime.getURL("network-interceptor.js")
      script.onload = () => {
        console.log("Network interceptor script loaded")
        script.remove() // Clean up after loading
      }
      script.onerror = (error) => {
        console.error("Failed to load network interceptor:", error)
      }

      // Inject at the very beginning of head to catch early network calls
      const head = document.head || document.getElementsByTagName("head")[0] || document.documentElement
      head.insertBefore(script, head.firstChild)

      console.log("Network interceptor script injection initiated")
    } catch (error) {
      console.error("Failed to inject network interceptor:", error)
    }
  }

  injectSidePanel() {
    try {
      // Check if panel already exists
      if (document.getElementById("sfcc-debugger-tab")) {
        return
      }

      // Create the floating tab - moved to bottom right
      const tab = document.createElement("div")
      tab.id = "sfcc-debugger-tab"
      tab.innerHTML = `
<div style="display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; height: 100%;">
<div id="sfcc-tab-status-indicator" style="width: 8px; height: 8px; border-radius: 50%; background: #6b7280; transition: background 0.3s ease; flex-shrink: 0;"></div>
<span style="line-height: 1; display: flex; align-items: center; justify-content: center;">🛒 Debug</span>
</div>
`

      // Reset all possible inherited styles and set explicit dimensions
      tab.setAttribute(
        "style",
        `
all: initial !important;
position: fixed !important;
bottom: 20px !important;
right: 20px !important;
width: auto !important;
height: 40px !important;
min-width: 80px !important;
max-width: 120px !important;
z-index: 2147483647 !important;
background: #60a5fa !important;
color: white !important;
padding: 0 16px !important;
border-radius: 8px !important;
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
font-size: 13px !important;
font-weight: 600 !important;
cursor: pointer !important;
box-shadow: 0 4px 12px rgba(96, 165, 250, 0.4) !important;
transition: all 0.3s ease !important;
user-select: none !important;
border: 1px solid rgba(255, 255, 255, 0.2) !important;
display: flex !important;
align-items: center !important;
justify-content: center !important;
text-align: center !important;
white-space: nowrap !important;
overflow: hidden !important;
box-sizing: border-box !important;
margin: 0 !important;
float: none !important;
clear: none !important;
vertical-align: baseline !important;
`,
      )

      document.body.appendChild(tab)

      // Create the side panel
      const panel = document.createElement("div")
      panel.id = "sfcc-debugger-panel"
      panel.innerHTML = this.createPanelHTML()

      // Apply panel styles individually
      this.safeSetStyle(panel, "position", "fixed")
      this.safeSetStyle(panel, "top", "0")
      this.safeSetStyle(panel, "right", "-400px")
      this.safeSetStyle(panel, "width", "400px")
      this.safeSetStyle(panel, "height", "100vh")
      this.safeSetStyle(panel, "background", "white")
      this.safeSetStyle(panel, "zIndex", "999998")
      this.safeSetStyle(panel, "boxShadow", "-4px 0 20px rgba(0, 0, 0, 0.15)")
      this.safeSetStyle(panel, "transition", "right 0.3s ease")
      this.safeSetStyle(panel, "fontFamily", "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif")
      this.safeSetStyle(panel, "display", "flex")
      this.safeSetStyle(panel, "flexDirection", "column")

      document.body.appendChild(panel)

      // Add event listeners
      this.setupPanelEventListeners()

      console.log("SFCC Debugger side panel injected")
    } catch (error) {
      console.error("Failed to inject side panel:", error)
    }
  }

  createPanelHTML() {
    return `
    <div class="sfcc-panel-header" style="background: #f8fafc; border-bottom: 1px solid #e2e8f0; padding: 16px; display: flex; justify-content: space-between; align-items: center;">
      <div class="sfcc-panel-title" style="font-size: 16px; font-weight: 600; color: #1e293b;">SFCC Checkout Debugger</div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <button class="sfcc-btn sfcc-btn-primary" id="sfcc-sync-btn" style="padding: 4px 8px; border: 1px solid #60a5fa; border-radius: 4px; background: #60a5fa; color: white; font-size: 10px; cursor: pointer; transition: all 0.2s;">Sync SF</button>
        <button class="sfcc-close-btn" id="sfcc-close-panel" style="background: none; border: none; font-size: 18px; cursor: pointer; color: #6b7280; padding: 4px; border-radius: 4px; transition: background 0.2s;">×</button>
      </div>
    </div>
    
    <div class="sfcc-panel-content" style="flex: 1; overflow: hidden; display: flex; flex-direction: column;">
      <!-- Active Account Section -->
      <div id="sfcc-active-account-section" class="sfcc-status-section" style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; background: #f0f9ff; display: none;">
        <div class="sfcc-status-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div class="sfcc-status-title" style="font-weight: 600; color: #1e40af; font-size: 12px;">Active Salesforce Account</div>
          <div id="sfcc-account-type-badge" class="sfcc-status-badge" style="padding: 2px 6px; border-radius: 12px; font-size: 9px; font-weight: 500; text-transform: uppercase; background: #dcfce7; color: #166534;">Production</div>
        </div>
        <div style="font-size: 11px; color: #1e40af;">
          <div><strong>Name:</strong> <span id="sfcc-active-account-name">-</span></div>
          <div><strong>Instance:</strong> <span id="sfcc-active-account-instance">-</span></div>
          <div><strong>Last Sync:</strong> <span id="sfcc-active-account-sync">Never</span></div>
        </div>
      </div>

      <div class="sfcc-status-section" style="padding: 16px; border-bottom: 1px solid #e2e8f0; background: #f8fafc;">
        <div class="sfcc-status-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div class="sfcc-status-title" style="font-weight: 600; color: #374151; font-size: 14px;">Monitoring Status</div>
          <div id="sfcc-monitoring-status" class="sfcc-status-badge" style="padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 500; text-transform: uppercase; background: #fef2f2; color: #991b1b;">Inactive</div>
        </div>
        
        <!-- Add checkout status indicator -->
        <div class="sfcc-status-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div class="sfcc-status-title" style="font-weight: 600; color: #374151; font-size: 14px;">Checkout Status</div>
          <div id="sfcc-checkout-status" class="sfcc-status-badge" style="padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 500; text-transform: uppercase; background: #f3f4f6; color: #6b7280;">Unknown</div>
        </div>
        
        <div class="sfcc-session-info" style="font-size: 11px; color: #6b7280; display: flex; gap: 12px; margin-bottom: 12px;">
          <div>Calls: <span id="sfcc-call-count">0</span></div>
          <div>Errors: <span id="sfcc-error-count">0</span></div>
          <div>Duration: <span id="sfcc-session-duration">0s</span></div>
          <div>SF Logs: <span id="sfcc-correlation-count">0</span></div>
        </div>
        <div class="sfcc-requirements-grid" id="sfcc-requirements-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <!-- Requirements will be populated by JavaScript -->
        </div>
      </div>
      
      <div class="sfcc-tabs" style="display: flex; background: white; border-bottom: 1px solid #e2e8f0;">
        <button class="sfcc-tab active" data-tab="network" style="flex: 1; padding: 12px 8px; border: none; background: #f8fafc; cursor: pointer; font-size: 12px; color: #60a5fa; border-bottom: 2px solid #60a5fa; transition: all 0.2s;">Network</button>
        <button class="sfcc-tab" data-tab="correlations" style="flex: 1; padding: 12px 8px; border: none; background: none; cursor: pointer; font-size: 12px; color: #6b7280; border-bottom: 2px solid transparent; transition: all 0.2s;">Correlations</button>
        <button class="sfcc-tab" data-tab="logs" style="flex: 1; padding: 12px 8px; border: none; background: none; cursor: pointer; font-size: 12px; color: #6b7280; border-bottom: 2px solid transparent; transition: all 0.2s;">SF Logs</button>
        <button class="sfcc-tab" data-tab="errors" style="flex: 1; padding: 12px 8px; border: none; background: none; cursor: pointer; font-size: 12px; color: #6b7280; border-bottom: 2px solid transparent; transition: all 0.2s;">Errors</button>
      </div>
      
      <div class="sfcc-tab-content" id="sfcc-tab-content" style="flex: 1; overflow: auto; padding: 12px;">
        <!-- Tab content will be populated by JavaScript -->
      </div>
    </div>
    
    <div class="sfcc-actions" style="padding: 12px 16px; border-top: 1px solid #e2e8f0; background: #f8fafc; display: flex; gap: 8px;">
      <button class="sfcc-btn" id="sfcc-clear-btn" style="flex: 1; padding: 6px 12px; border: 1px solid #d1d5db; border-radius: 4px; background: white; color: #374151; font-size: 11px; cursor: pointer; transition: all 0.2s;">Clear</button>
      <button class="sfcc-btn sfcc-btn-primary" id="sfcc-export-btn" style="flex: 1; padding: 6px 12px; border: 1px solid #60a5fa; border-radius: 4px; background: #60a5fa; color: white; font-size: 11px; cursor: pointer; transition: all 0.2s;">Export</button>
    </div>
  `
  }

  async updateActiveAccountDisplay() {
    try {
      // Get active account info from storage
      const connectionData = await this.safeChromeCall(() => {
        return this.chrome.storage.local.get(["salesforceAccounts", "activeAccountId", "lastSync"])
      }, {})

      const activeAccountSection = document.getElementById("sfcc-active-account-section")
      const accountNameEl = document.getElementById("sfcc-active-account-name")
      const accountInstanceEl = document.getElementById("sfcc-active-account-instance")
      const accountSyncEl = document.getElementById("sfcc-active-account-sync")
      const accountTypeBadge = document.getElementById("sfcc-account-type-badge")

      if (!activeAccountSection) return

      if (connectionData.salesforceAccounts && connectionData.activeAccountId) {
        const activeAccount = connectionData.salesforceAccounts.find((acc) => acc.id === connectionData.activeAccountId)

        if (activeAccount) {
          // Show the section
          activeAccountSection.style.display = "block"

          // Update account info
          this.safeSetTextContent(accountNameEl, activeAccount.name)
          this.safeSetTextContent(accountInstanceEl, new URL(activeAccount.instanceUrl).hostname)

          // Update instance type badge
          const instanceType = activeAccount.instanceType || "production"
          this.safeSetTextContent(accountTypeBadge, instanceType.charAt(0).toUpperCase() + instanceType.slice(1))

          if (instanceType === "sandbox") {
            this.safeSetStyle(accountTypeBadge, "background", "#fef3c7")
            this.safeSetStyle(accountTypeBadge, "color", "#92400e")
          } else {
            this.safeSetStyle(accountTypeBadge, "background", "#dcfce7")
            this.safeSetStyle(accountTypeBadge, "color", "#166534")
          }

          // Update last sync time
          if (connectionData.lastSync) {
            const syncTime = new Date(connectionData.lastSync).toLocaleTimeString()
            this.safeSetTextContent(accountSyncEl, syncTime)
          } else {
            this.safeSetTextContent(accountSyncEl, "Never")
          }

          console.log("✅ Updated active account display:", activeAccount.name, instanceType)
        } else {
          // Hide section if no active account found
          activeAccountSection.style.display = "none"
        }
      } else {
        // Hide section if no accounts configured
        activeAccountSection.style.display = "none"
      }
    } catch (error) {
      console.warn("Error updating active account display:", error)
    }
  }

  setupPanelEventListeners() {
    try {
      const tab = document.getElementById("sfcc-debugger-tab")
      const panel = document.getElementById("sfcc-debugger-panel")
      const closeBtn = document.getElementById("sfcc-close-panel")

      if (!tab || !panel || !closeBtn) {
        console.error("Panel elements not found")
        return
      }

      // Add hover effect to tab with proper color restoration
      tab.addEventListener("mouseenter", () => {
        this.safeSetStyle(tab, "background", "#3b82f6", "important")
        this.safeSetStyle(tab, "transform", "translateY(-2px)", "important")
        this.safeSetStyle(tab, "box-shadow", "0 6px 16px rgba(96, 165, 250, 0.5)", "important")
      })

      tab.addEventListener("mouseleave", () => {
        this.safeSetStyle(tab, "background", "#60a5fa", "important")
        this.safeSetStyle(tab, "transform", "translateY(0)", "important")
        this.safeSetStyle(tab, "box-shadow", "0 4px 12px rgba(96, 165, 250, 0.4)", "important")
      })

      // Toggle panel
      tab.addEventListener("click", () => {
        const isOpen = panel.style.right === "0px"

        if (isOpen) {
          // Close panel and show tab
          this.safeSetStyle(panel, "right", "-400px")
          this.safeSetStyle(tab, "display", "inline-block", "important")
        } else {
          // Open panel and hide tab
          this.safeSetStyle(panel, "right", "0px")
          this.updatePanelContent()
          this.safeSetStyle(tab, "display", "none", "important")
        }
      })

      // Close panel
      closeBtn.addEventListener("click", () => {
        this.safeSetStyle(panel, "right", "-400px")
        // Show tab again when panel is closed
        this.safeSetStyle(tab, "display", "inline-block", "important")
      })

      // Tab switching
      panel.querySelectorAll(".sfcc-tab").forEach((tabBtn) => {
        tabBtn.addEventListener("click", (e) => {
          this.switchTab(e.target.dataset.tab)
        })
      })

      // Clear button
      const clearBtn = document.getElementById("sfcc-clear-btn")
      if (clearBtn) {
        clearBtn.addEventListener("click", () => {
          this.clearData()
        })
      }

      // Export button
      const exportBtn = document.getElementById("sfcc-export-btn")
      if (exportBtn) {
        exportBtn.addEventListener("click", () => {
          this.exportData()
        })
      }

      // Sync button in panel header
      const syncBtn = document.getElementById("sfcc-sync-btn")
      if (syncBtn) {
        syncBtn.addEventListener("click", () => {
          this.syncSalesforceData()
        })
      }

      // Update panel every second
      setInterval(() => this.updateSessionInfo(), 1000)

      // Initial content update
      this.updatePanelContent()
    } catch (error) {
      console.error("Failed to setup panel event listeners:", error)
    }
  }

  switchTab(tabName) {
    this.activeTab = tabName

    // Update tab buttons
    document.querySelectorAll(".sfcc-tab").forEach((tab) => {
      if (tab.dataset.tab === tabName) {
        this.safeSetStyle(tab, "color", "#60a5fa")
        this.safeSetStyle(tab, "borderBottomColor", "#60a5fa")
        this.safeSetStyle(tab, "background", "#f8fafc")
      } else {
        this.safeSetStyle(tab, "color", "#6b7280")
        this.safeSetStyle(tab, "borderBottomColor", "transparent")
        this.safeSetStyle(tab, "background", "none")
      }
    })

    this.renderTabContent()
  }

  updatePanelContent() {
    try {
      this.updateActiveAccountDisplay()
      this.renderRequirements()
      this.renderTabContent()
      this.updateStatus()
      this.updateCheckoutStatus()
      this.updateTabStatusIndicator()
      this.updateSessionInfo()
    } catch (error) {
      console.error("Error updating panel content:", error)
    }
  }

  renderRequirements() {
    const grid = document.getElementById("sfcc-requirements-grid")
    if (!grid) return

    try {
      grid.innerHTML = ""

      this.requirements.forEach((req) => {
        const element = document.createElement("div")
        element.style.cssText = `
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 8px;
          background: white;
          border-radius: 4px;
          font-size: 11px;
          border: 1px solid #e2e8f0;
          cursor: pointer;
          transition: all 0.2s;
        `

        const status = this.getRequirementStatus(req.key, req.required)
        const iconColor = status === "complete" ? "#22c55e" : status === "optional" ? "#f59e0b" : "#ef4444"

        // Check if this requirement is currently filtered
        const isFiltered = this.activeFilter === req.key
        if (isFiltered) {
          this.safeSetStyle(element, "background", "#dbeafe")
          this.safeSetStyle(element, "borderColor", "#60a5fa")
        }

        const callCount = this.getCallCountForRequirement(req.key)
        element.innerHTML = `
          <div style="width: 8px; height: 8px; border-radius: 50%; background: ${iconColor};"></div>
          <span>${req.label}</span>
          ${callCount > 0 ? `<span style="background: #f3f4f6; color: #374151; padding: 1px 4px; border-radius: 8px; font-size: 9px; margin-left: auto;">${callCount}</span>` : ""}
        `

        // Add click handler for filtering
        element.addEventListener("click", () => {
          this.toggleFilter(req.key)
        })

        // Add hover effect
        element.addEventListener("mouseenter", () => {
          if (!isFiltered) {
            this.safeSetStyle(element, "background", "#f8fafc")
          }
        })

        element.addEventListener("mouseleave", () => {
          if (!isFiltered) {
            this.safeSetStyle(element, "background", "white")
          }
        })

        grid.appendChild(element)
      })

      // Add "All" filter option
      const allElement = document.createElement("div")
      allElement.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        background: white;
        border-radius: 4px;
        font-size: 11px;
        border: 1px solid #e2e8f0;
        cursor: pointer;
        transition: all 0.2s;
        grid-column: 1 / -1;
      `

      const isAllFiltered = !this.activeFilter
      if (isAllFiltered) {
        this.safeSetStyle(allElement, "background", "#dbeafe")
        this.safeSetStyle(allElement, "borderColor", "#60a5fa")
      }

      allElement.innerHTML = `
        <div style="width: 8px; height: 8px; border-radius: 50%; background: #6b7280;"></div>
        <span>All Calls</span>
        <span style="background: #f3f4f6; color: #374151; padding: 1px 4px; border-radius: 8px; font-size: 9px; margin-left: auto;">${this.networkCalls.length}</span>
      `

      allElement.addEventListener("click", () => {
        this.toggleFilter(null)
      })

      allElement.addEventListener("mouseenter", () => {
        if (!isAllFiltered) {
          this.safeSetStyle(allElement, "background", "#f8fafc")
        }
      })

      allElement.addEventListener("mouseleave", () => {
        if (!isAllFiltered) {
          this.safeSetStyle(allElement, "background", "white")
        }
      })

      grid.appendChild(allElement)
    } catch (error) {
      console.error("Error rendering requirements:", error)
    }
  }

  getRequirementStatus(key, required) {
    const hasData = this.checkoutData[key]
    if (hasData) return "complete"
    if (!required) return "optional"
    return "incomplete"
  }

  getCallCountForRequirement(requirementKey) {
    return this.networkCalls.filter((call) => {
      const stage = this.mapUrlToRequirement(call.url)
      return stage === requirementKey
    }).length
  }

  mapUrlToRequirement(url) {
    const urlLower = url.toLowerCase()

    // More comprehensive URL pattern matching
    if (
      urlLower.includes("/addresses") &&
      (urlLower.includes("addresstype=shipping") || urlLower.includes("shipping"))
    ) {
      return "shippingAddress"
    }
    if (urlLower.includes("/addresses") && (urlLower.includes("addresstype=billing") || urlLower.includes("billing"))) {
      return "billingAddress"
    }
    if (urlLower.includes("/shipping-address") || urlLower.includes("/delivery-address")) {
      return "shippingAddress"
    }
    // Update this section to include the actual Commerce Cloud delivery patterns
    if (
      urlLower.includes("/delivery-methods") ||
      urlLower.includes("/shipping-methods") ||
      urlLower.includes("/delivery-groups/") ||
      urlLower.includes("/carts/current/delivery-groups")
    ) {
      return "deliveryMethod"
    }
    if (
      urlLower.includes("/inventory") ||
      urlLower.includes("/cart-items") ||
      urlLower.includes("/inventory-reservations") ||
      urlLower.includes("/products/") // Product availability checks
    ) {
      return "inventory"
    }
    if (urlLower.includes("/taxes") || urlLower.includes("/tax")) {
      return "taxes"
    }
    if (urlLower.includes("/billing-address")) {
      return "billingAddress"
    }
    if (urlLower.includes("/payments") || urlLower.includes("/payment")) {
      return "payment"
    }

    return null
  }

  toggleFilter(filterKey) {
    if (this.activeFilter === filterKey) {
      // If clicking the same filter, clear it
      this.activeFilter = null
    } else {
      // Set new filter
      this.activeFilter = filterKey
    }

    this.renderRequirements()
    this.renderTabContent()
  }

  renderTabContent() {
    const container = document.getElementById("sfcc-tab-content")
    if (!container) return

    try {
      switch (this.activeTab) {
        case "network":
          container.innerHTML = this.renderNetworkCalls()
          break
        case "correlations":
          container.innerHTML = this.renderCorrelations()
          break
        case "logs":
          container.innerHTML = this.renderSalesforceLogs()
          break
        case "errors":
          container.innerHTML = this.renderErrors()
          break
      }

      // Add click handlers for expandable items
      container
        .querySelectorAll(".sfcc-network-call-header, .sfcc-log-header, .sfcc-correlation-header")
        .forEach((header) => {
          header.addEventListener("click", (e) => {
            const call = e.target.closest(".sfcc-network-call, .sfcc-log, .sfcc-correlation")
            const details = call.querySelector(
              ".sfcc-network-call-details, .sfcc-log-details, .sfcc-correlation-details",
            )
            if (details) {
              this.safeSetStyle(details, "display", details.style.display === "block" ? "none" : "block")
            }
          })
        })
    } catch (error) {
      console.error("Error rendering tab content:", error)
    }
  }

  renderCorrelations() {
    if (!this.correlations || this.correlations.length === 0) {
      return `
      <div style="text-align: center; padding: 40px 20px; color: #6b7280;">
        <div style="font-size: 32px; margin-bottom: 12px;">🔗</div>
        <div>No correlations found</div>
        <div style="font-size: 10px; margin-top: 8px;">
          ${this.networkCalls.length === 0 ? "Perform checkout actions to generate network calls" : ""}
          ${this.salesforceLogs.length === 0 ? "Click 'Sync SF' to fetch Salesforce logs" : ""}
          ${this.networkCalls.length > 0 && this.salesforceLogs.length > 0 ? "No matching patterns found between network calls and SF logs" : ""}
        </div>
      </div>
    `
    }

    return this.correlations
      .slice(0, 20) // Limit to avoid performance issues
      .map((correlation) => {
        const confidenceColor =
          correlation.confidence > 0.8 ? "#22c55e" : correlation.confidence > 0.6 ? "#f59e0b" : "#ef4444"
        const confidenceText = correlation.confidence > 0.8 ? "High" : correlation.confidence > 0.6 ? "Medium" : "Low"

        return `
        <div class="sfcc-correlation" style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 8px; overflow: hidden; border-left: 3px solid ${confidenceColor};">
          <div class="sfcc-correlation-header" style="padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: background 0.2s;">
            <div style="display: flex; align-items: center; flex: 1;">
              <span style="font-weight: 600; font-size: 10px; padding: 2px 6px; border-radius: 3px; color: white; margin-right: 8px; background: ${this.getMethodColor(correlation.networkCall.method)};">${correlation.networkCall.method}</span>
              <span style="font-family: monospace; font-size: 10px; color: #374151; flex: 1; margin-right: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${this.truncateUrl(correlation.networkCall.url)}</span>
              <span style="background: #dbeafe; color: #1d4ed8; padding: 1px 4px; border-radius: 3px; font-size: 9px; font-weight: 500; text-transform: uppercase; margin-left: 4px;">${correlation.type}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 10px; color: #6b7280;">${Math.round(correlation.timeDifference / 1000)}s apart</span>
              <div style="font-size: 11px; font-weight: 600; color: ${confidenceColor};">
                ${(correlation.confidence * 100).toFixed(0)}%
              </div>
            </div>
          </div>
          <div class="sfcc-correlation-details" style="padding: 12px; background: white; border-top: 1px solid #e5e7eb; display: none; font-size: 11px;">
            <div style="margin-bottom: 12px;">
              <div style="font-weight: 600; font-size: 10px; color: #374151; margin-bottom: 4px; text-transform: uppercase;">Correlation Analysis</div>
              <div style="font-family: monospace; font-size: 9px; background: #f8fafc; padding: 6px; border-radius: 3px; border: 1px solid #e2e8f0;">
                <div><strong>Confidence:</strong> ${confidenceText} (${(correlation.confidence * 100).toFixed(1)}%)</div>
                <div><strong>Type:</strong> ${correlation.type}</div>
                <div><strong>Score:</strong> ${correlation.score.toFixed(1)}/${correlation.maxScore}</div>
                <div><strong>Reasoning:</strong> ${correlation.reasoning}</div>
                <div><strong>Factors:</strong> ${correlation.factors.join(", ")}</div>
              </div>
            </div>
            
            <div style="margin-bottom: 12px;">
              <div style="font-weight: 600; font-size: 10px; color: #374151; margin-bottom: 4px; text-transform: uppercase;">Network Call</div>
              <div style="font-family: monospace; font-size: 9px; background: #f0f9ff; padding: 6px; border-radius: 3px; border: 1px solid #bae6fd;">
                <div><strong>URL:</strong> ${correlation.networkCall.url}</div>
                <div><strong>Status:</strong> ${correlation.networkCall.status}</div>
                <div><strong>Time:</strong> ${new Date(correlation.networkCall.timestamp).toLocaleString()}</div>
                ${correlation.networkCall.checkoutId ? `<div><strong>Checkout ID:</strong> ${correlation.networkCall.checkoutId}</div>` : ""}
              </div>
            </div>
            
            <div style="margin-bottom: 12px;">
              <div style="font-weight: 600; font-size: 10px; color: #374151; margin-bottom: 4px; text-transform: uppercase;">Salesforce Log</div>
              <div style="font-family: monospace; font-size: 9px; background: #fef3c7; padding: 6px; border-radius: 3px; border: 1px solid #fde68a;">
                <div><strong>ID:</strong> ${correlation.salesforceLog.Id}</div>
                <div><strong>Operation:</strong> ${correlation.salesforceLog.Operation}</div>
                <div><strong>Duration:</strong> ${correlation.salesforceLog.DurationMilliseconds}ms</div>
                <div><strong>Time:</strong> ${new Date(correlation.salesforceLog.StartTime).toLocaleString()}</div>
                ${correlation.salesforceLog.parsed?.apexClass ? `<div><strong>Apex Class:</strong> ${correlation.salesforceLog.parsed.apexClass}</div>` : ""}
              </div>
            </div>
          </div>
        </div>
      `
      })
      .join("")
  }

  renderSalesforceLogs() {
    if (!this.salesforceLogs || this.salesforceLogs.length === 0) {
      return `
      <div style="text-align: center; padding: 40px 20px; color: #6b7280;">
        <div style="font-size: 32px; margin-bottom: 12px;">📝</div>
        <div>No Salesforce logs</div>
        <div style="font-size: 10px; margin-top: 8px;">Click "Sync SF" to fetch logs from Salesforce</div>
      </div>
    `
    }

    return this.salesforceLogs
      .slice(0, 20) // Limit to avoid performance issues
      .map((log) => {
        const apexClass = log.parsed?.apexClass || "Unknown"
        const userInfo = log.parsed?.userInfo || log.LogUser?.Name || "Unknown User"
        const hasErrors = log.parsed?.errors?.length > 0

        return `
        <div class="sfcc-log" style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 8px; overflow: hidden; ${hasErrors ? "border-left: 3px solid #ef4444;" : ""}">
          <div class="sfcc-log-header" style="padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: background 0.2s;">
            <div style="display: flex; align-items: center; flex: 1;">
              <span style="font-weight: 600; font-size: 11px; padding: 2px 6px; border-radius: 3px; color: white; margin-right: 8px; background: #3b82f6;">${apexClass}</span>
              <span style="font-family: monospace; font-size: 10px; color: #374151; flex: 1; margin-right: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${userInfo}</span>
              ${hasErrors ? `<span style="background: #fef2f2; color: #991b1b; padding: 1px 4px; border-radius: 3px; font-size: 9px; font-weight: 500; margin-left: 4px;">ERRORS</span>` : ""}
            </div>
            <div style="font-size: 10px; color: #6b7280;">
              ${log.DurationMilliseconds}ms
            </div>
          </div>
          <div class="sfcc-log-details" style="padding: 12px; background: white; border-top: 1px solid #e5e7eb; display: none; font-size: 11px;">
            <div style="margin-bottom: 12px;">
              <div style="font-weight: 600; font-size: 10px; color: #374151; margin-bottom: 4px; text-transform: uppercase;">Log Info</div>
              <div style="font-family: monospace; font-size: 9px; background: #f8fafc; padding: 6px; border-radius: 3px; border: 1px solid #e2e8f0;">
                <div><strong>ID:</strong> ${log.Id}</div>
                <div><strong>User:</strong> ${userInfo}</div>
                <div><strong>Apex Class:</strong> ${apexClass}</div>
                <div><strong>Duration:</strong> ${log.DurationMilliseconds}ms</div>
                <div><strong>Time:</strong> ${new Date(log.StartTime).toLocaleString()}</div>
                <div><strong>Status:</strong> ${log.Status}</div>
              </div>
            </div>
            
            ${
              hasErrors
                ? `
              <div style="margin-bottom: 12px;">
                <div style="font-weight: 600; font-size: 10px; color: #374151; margin-bottom: 4px; text-transform: uppercase;">Errors Found</div>
                <div style="font-family: monospace; font-size: 9px; background: #fef2f2; padding: 6px; border-radius: 3px; border: 1px solid #fecaca; color: #991b1b; white-space: pre-wrap; max-height: 120px; overflow: auto;">
                  ${log.parsed.errors.map((error) => error.message).join("\n")}
                </div>
              </div>
            `
                : ""
            }
            
            ${
              log.parsed?.checkoutEvents?.length > 0
                ? `
              <div style="margin-bottom: 12px;">
                <div style="font-weight: 600; font-size: 10px; color: #374151; margin-bottom: 4px; text-transform: uppercase;">Checkout Events (${log.parsed.checkoutEvents.length})</div>
                <div style="font-family: monospace; font-size: 9px; background: #f0f9ff; padding: 6px; border-radius: 3px; border: 1px solid #bae6fd; white-space: pre-wrap; max-height: 120px; overflow: auto;">
                  ${log.parsed.checkoutEvents
                    .slice(0, 5)
                    .map((event) => event.event)
                    .join("\n")}
                  ${log.parsed.checkoutEvents.length > 5 ? "\n... and " + (log.parsed.checkoutEvents.length - 5) + " more" : ""}
                </div>
              </div>
            `
                : ""
            }
            
            ${
              log.parsed?.paymentEvents?.length > 0
                ? `
              <div style="margin-bottom: 12px;">
                <div style="font-weight: 600; font-size: 10px; color: #374151; margin-bottom: 4px; text-transform: uppercase;">Payment Events (${log.parsed.paymentEvents.length})</div>
                <div style="font-family: monospace; font-size: 9px; background: #fef3c7; padding: 6px; border-radius: 3px; border: 1px solid #fde68a; white-space: pre-wrap; max-height: 120px; overflow: auto;">
                  ${log.parsed.paymentEvents
                    .slice(0, 5)
                    .map((event) => event.event)
                    .join("\n")}
                  ${log.parsed.paymentEvents.length > 5 ? "\n... and " + (log.parsed.paymentEvents.length - 5) + " more" : ""}
                </div>
              </div>
            `
                : ""
            }
            
            <div style="margin-bottom: 12px;">
              <div style="font-weight: 600; font-size: 10px; color: #374151; margin-bottom: 4px; text-transform: uppercase;">Full Log Content</div>
              <div style="font-family: monospace; font-size: 8px; background: #f8fafc; padding: 6px; border-radius: 3px; border: 1px solid #e2e8f0; white-space: pre-wrap; max-height: 200px; overflow: auto;">
                ${log.body ? log.body.substring(0, 2000) + (log.body.length > 2000 ? "..." : "") : "No log content available"}
              </div>
            </div>
          </div>
        </div>
      `
      })
      .join("")
  }

  renderErrors() {
    if (this.errors.length === 0) {
      return `
      <div style="text-align: center; padding: 40px 20px; color: #6b7280;">
        <div style="font-size: 32px; margin-bottom: 12px;">✅</div>
        <div>No errors detected</div>
        <div style="font-size: 10px; margin-top: 8px;">Errors will appear here when network calls fail</div>
      </div>
    `
    }

    return this.errors
      .slice(-10) // Show only last 10 errors
      .reverse()
      .map(
        (error) => `
    <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 12px; margin-bottom: 8px; border-left: 3px solid #ef4444;">
      <div style="display: flex; justify-content: between; align-items: center; margin-bottom: 8px;">
        <div style="font-weight: 600; font-size: 12px; color: #991b1b;">${error.type || "Network Error"}</div>
        <div style="font-size: 10px; color: #6b7280;">${new Date(error.timestamp).toLocaleTimeString()}</div>
      </div>
      <div style="font-family: monospace; font-size: 10px; color: #7f1d1d; margin-bottom: 8px;">${error.message}</div>
      ${
        error.url
          ? `<div style="font-family: monospace; font-size: 9px; color: #6b7280; background: white; padding: 4px 6px; border-radius: 3px; word-break: break-all;">${error.url}</div>`
          : ""
      }
    </div>
  `,
      )
      .join("")
  }

  getFilteredNetworkCalls() {
    if (!this.activeFilter) return this.networkCalls

    return this.networkCalls.filter((call) => {
      const stage = this.mapUrlToRequirement(call.url)
      return stage === this.activeFilter
    })
  }

  getMethodColor(method) {
    const colors = {
      GET: "#22c55e",
      POST: "#3b82f6",
      PUT: "#f59e0b",
      PATCH: "#8b5cf6",
      DELETE: "#ef4444",
    }
    return colors[method] || "#6b7280"
  }

  truncateUrl(url) {
    if (url.length <= 60) return url
    return url.substring(0, 30) + "..." + url.substring(url.length - 27)
  }

  updateStatus() {
    const statusElement = document.getElementById("sfcc-monitoring-status")
    if (statusElement) {
      if (this.isMonitoring) {
        this.safeSetTextContent(statusElement, "Active")
        this.safeSetStyle(statusElement, "background", "#dcfce7")
        this.safeSetStyle(statusElement, "color", "#166534")
      } else {
        this.safeSetTextContent(statusElement, "Inactive")
        this.safeSetStyle(statusElement, "background", "#fef2f2")
        this.safeSetStyle(statusElement, "color", "#991b1b")
      }
    }
  }

  updateCheckoutStatus() {
    const statusElement = document.getElementById("sfcc-checkout-status")
    if (!statusElement) return

    // Determine checkout status based on recent network calls
    const recentCalls = this.networkCalls.filter((call) => Date.now() - call.timestamp < 30000) // Last 30 seconds

    let status = "Unknown"
    let bgColor = "#f3f4f6"
    let textColor = "#6b7280"

    if (recentCalls.length > 0) {
      // Check for specific checkout stages
      const hasPayment = recentCalls.some((call) => call.url.includes("payment"))
      const hasDelivery = recentCalls.some((call) => call.url.includes("delivery"))
      const hasAddress = recentCalls.some((call) => call.url.includes("address"))
      const hasCheckout = recentCalls.some((call) => call.url.includes("checkout"))

      if (hasPayment) {
        status = "Payment"
        bgColor = "#fef3c7"
        textColor = "#92400e"
      } else if (hasDelivery) {
        status = "Delivery"
        bgColor = "#dbeafe"
        textColor = "#1d4ed8"
      } else if (hasAddress) {
        status = "Address"
        bgColor = "#e0e7ff"
        textColor = "#3730a3"
      } else if (hasCheckout) {
        status = "Active"
        bgColor = "#dcfce7"
        textColor = "#166534"
      } else {
        status = "Browsing"
        bgColor = "#f3f4f6"
        textColor = "#6b7280"
      }
    }

    this.safeSetTextContent(statusElement, status)
    this.safeSetStyle(statusElement, "background", bgColor)
    this.safeSetStyle(statusElement, "color", textColor)
  }

  updateTabStatusIndicator() {
    const indicator = document.getElementById("sfcc-tab-status-indicator")
    if (!indicator) return

    // Update indicator based on activity
    const hasRecentActivity = this.networkCalls.some((call) => Date.now() - call.timestamp < 5000) // Last 5 seconds
    const hasErrors = this.errors.length > 0

    if (hasErrors) {
      this.safeSetStyle(indicator, "background", "#ef4444") // Red for errors
    } else if (hasRecentActivity) {
      this.safeSetStyle(indicator, "background", "#22c55e") // Green for recent activity
    } else if (this.isMonitoring) {
      this.safeSetStyle(indicator, "background", "#60a5fa") // Blue for monitoring
    } else {
      this.safeSetStyle(indicator, "background", "#6b7280") // Gray for inactive
    }
  }

  updateSessionInfo() {
    try {
      const callCountEl = document.getElementById("sfcc-call-count")
      const errorCountEl = document.getElementById("sfcc-error-count")
      const durationEl = document.getElementById("sfcc-session-duration")
      const correlationCountEl = document.getElementById("sfcc-correlation-count")

      if (callCountEl) this.safeSetTextContent(callCountEl, this.networkCalls.length.toString())
      if (errorCountEl) this.safeSetTextContent(errorCountEl, this.errors.length.toString())
      if (correlationCountEl) this.safeSetTextContent(correlationCountEl, this.salesforceLogs.length.toString())

      if (durationEl) {
        const duration = Math.floor((Date.now() - this.sessionStart) / 1000)
        this.safeSetTextContent(durationEl, `${duration}s`)
      }
    } catch (error) {
      console.warn("Error updating session info:", error)
    }
  }

  startMonitoring() {
    this.isMonitoring = true
    console.log("SFCC monitoring started")
    this.updateStatus()
  }

  stopMonitoring() {
    this.isMonitoring = false
    console.log("SFCC monitoring stopped")
    this.updateStatus()
  }

  handleNetworkCall(callData) {
    if (!this.isMonitoring) return

    try {
      // Use the analyzer if available, otherwise fall back to existing logic
      let enhancedCall = callData
      if (this.analyzer) {
        enhancedCall = this.analyzer.analyzeCall(callData)

        // Log detailed analysis for debugging
        if (enhancedCall.callType) {
          console.log(`✅ Call analyzed as: ${enhancedCall.callType}`, {
            url: callData.url.split("/").pop(),
            method: callData.method,
            stage: enhancedCall.checkoutStage,
            successful: enhancedCall.isSuccessful,
            hasPayload: !!callData.requestBody,
            payloadKeys: this.getPayloadKeys(callData.requestBody),
            responseKeys: this.getResponseKeys(callData.response),
          })
        } else {
          console.log(`❓ Call not categorized:`, {
            url: callData.url.split("/").pop(),
            method: callData.method,
            hasPayload: !!callData.requestBody,
            payloadKeys: this.getPayloadKeys(callData.requestBody),
            responseKeys: this.getResponseKeys(callData.response),
          })
        }

        // Update checkout data using analyzer
        this.checkoutData = this.analyzer.updateCheckoutData(this.checkoutData, enhancedCall)
      } else {
        // Fallback to existing extraction logic
        this.extractCheckoutData(callData)
        enhancedCall.checkoutStage = this.detectCheckoutStage(callData.url, callData.requestBody)
      }

      // Add timestamp and ID
      enhancedCall.timestamp = Date.now()
      enhancedCall.id = this.generateId()

      // Add to network calls
      this.networkCalls.push(enhancedCall)

      // Limit array size to prevent memory issues
      if (this.networkCalls.length > 100) {
        this.networkCalls = this.networkCalls.slice(-50)
      }

      // Run correlation if engine is available
      if (this.correlationEngine && this.salesforceLogs.length > 0) {
        const newCorrelations = this.correlationEngine.correlateAll([enhancedCall], this.salesforceLogs)
        this.correlations.push(...newCorrelations)

        // Limit correlations
        if (this.correlations.length > 100) {
          this.correlations = this.correlations.slice(-50)
        }

        if (newCorrelations.length > 0) {
          console.log(
            `🔗 Generated ${newCorrelations.length} new correlations for ${enhancedCall.callType || "unknown"} call`,
          )
        }
      }

      // Update panel if it's open
      this.updatePanelContent()
    } catch (error) {
      console.error("Error handling network call:", error)
    }
  }

  // Add helper methods for debugging
  getPayloadKeys(requestBody) {
    try {
      const body = this.parseRequestBody(requestBody)
      if (!body) return []
      return Object.keys(body).slice(0, 5) // Limit to first 5 keys
    } catch (e) {
      return []
    }
  }

  getResponseKeys(response) {
    try {
      if (!response || typeof response !== "object") return []
      return Object.keys(response).slice(0, 5) // Limit to first 5 keys
    } catch (e) {
      return []
    }
  }

  parseRequestBody(requestBody) {
    if (!requestBody) return null

    try {
      return typeof requestBody === "string" ? JSON.parse(requestBody) : requestBody
    } catch (e) {
      return null
    }
  }

  detectCheckoutStage(url, requestBody) {
    const urlLower = url.toLowerCase()

    // Enhanced delivery method detection
    if (urlLower.includes("delivery") || urlLower.includes("shipping")) {
      // Check if it's updating delivery method specifically
      if (requestBody && typeof requestBody === "object") {
        if (
          requestBody.deliveryMethodId ||
          (typeof requestBody === "string" && requestBody.includes("deliveryMethodId"))
        ) {
          return "delivery-method"
        }
      }
      return "delivery"
    }

    if (urlLower.includes("address")) return "address"
    if (urlLower.includes("payment")) return "payment"
    if (urlLower.includes("tax")) return "taxes"
    if (urlLower.includes("inventory") || urlLower.includes("stock")) return "inventory"
    if (urlLower.includes("checkout")) return "checkout"

    return null
  }

  extractCheckoutData(callData) {
    try {
      const url = callData.url.toLowerCase()
      const response = callData.response
      const request = callData.requestBody

      // Extract checkout ID from various sources
      if (response) {
        if (response.checkoutId) {
          callData.checkoutId = response.checkoutId
        } else if (response.cartSummary?.cartId) {
          callData.checkoutId = response.cartSummary.cartId
        }
      }

      // Enhanced delivery method detection
      if (url.includes("delivery") || url.includes("shipping")) {
        this.checkoutData.deliveryMethod = true

        // Extract delivery method details from response
        if (response?.deliveryGroups?.items) {
          const deliveryGroup = response.deliveryGroups.items[0]
          if (deliveryGroup?.selectedDeliveryMethod) {
            this.checkoutData.selectedDeliveryMethod = {
              id: deliveryGroup.selectedDeliveryMethod.id,
              name: deliveryGroup.selectedDeliveryMethod.name,
              fee: deliveryGroup.selectedDeliveryMethod.shippingFee,
              carrier: deliveryGroup.selectedDeliveryMethod.carrier,
            }
            console.log("✅ Delivery method selected:", this.checkoutData.selectedDeliveryMethod)
          }

          if (deliveryGroup?.availableDeliveryMethods) {
            this.checkoutData.availableDeliveryMethods = deliveryGroup.availableDeliveryMethods
            console.log("📦 Available delivery methods:", deliveryGroup.availableDeliveryMethods.length)
          }
        }

        // Extract from request payload for delivery method updates
        if (request && typeof request === "object" && request.deliveryMethodId) {
          this.checkoutData.requestedDeliveryMethodId = request.deliveryMethodId
          console.log("🚚 Delivery method update requested:", request.deliveryMethodId)
        }
      }

      if (url.includes("address")) {
        this.checkoutData.shippingAddress = true
        if (response?.deliveryGroups?.items?.[0]?.deliveryAddress) {
          this.checkoutData.addressDetails = response.deliveryGroups.items[0].deliveryAddress
        }
      }

      if (url.includes("payment")) {
        this.checkoutData.payment = true
        if (response?.paymentMethods) {
          this.checkoutData.paymentMethods = response.paymentMethods
        }
      }

      if (url.includes("tax")) {
        this.checkoutData.taxes = true
        if (response?.cartSummary?.totalTaxAmount) {
          this.checkoutData.taxAmount = response.cartSummary.totalTaxAmount
        }
      }

      if (url.includes("inventory") || url.includes("stock")) {
        this.checkoutData.inventory = true
      }

      // Extract Salesforce result codes
      if (response?.errors && Array.isArray(response.errors)) {
        response.errors.forEach((error) => {
          if (error.errorCode) {
            callData.salesforceResultCode = error.errorCode
          }
        })
      }
    } catch (error) {
      console.warn("Error extracting checkout data:", error)
    }
  }

  handleError(errorData) {
    this.errors.push({
      ...errorData,
      timestamp: Date.now(),
      id: this.generateId(),
    })

    // Limit errors array
    if (this.errors.length > 20) {
      this.errors = this.errors.slice(-10)
    }

    this.updatePanelContent()
    console.error("SFCC Error captured:", errorData)
  }

  clearData() {
    this.networkCalls = []
    this.errors = []
    this.checkoutData = {}
    this.salesforceLogs = []
    this.correlations = []
    this.sessionStart = Date.now()
    this.updatePanelContent()
    console.log("SFCC data cleared")
  }

  exportData() {
    const data = {
      timestamp: new Date().toISOString(),
      sessionDuration: Date.now() - this.sessionStart,
      networkCalls: this.networkCalls,
      errors: this.errors,
      checkoutData: this.checkoutData,
      salesforceLogs: this.salesforceLogs,
      correlations: this.correlations,
      url: window.location.href,
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `sfcc-debug-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    console.log("SFCC data exported")
  }

  async syncSalesforceData() {
    if (!this.isContextValid()) {
      console.warn("Cannot sync - extension context invalid")
      return
    }

    try {
      const syncBtn = document.getElementById("sfcc-sync-btn")
      if (syncBtn) {
        this.safeSetTextContent(syncBtn, "Syncing...")
        this.safeSetStyle(syncBtn, "opacity", "0.6")
      }

      // Get connection info from storage
      const connectionData = await this.safeChromeCall(() => {
        return this.chrome.storage.local.get(["salesforceAccounts", "activeAccountId"])
      }, {})

      if (!connectionData.salesforceAccounts || !connectionData.activeAccountId) {
        console.warn("No Salesforce account selected")
        return
      }

      // Find the active account
      const activeAccount = connectionData.salesforceAccounts.find((acc) => acc.id === connectionData.activeAccountId)

      if (!activeAccount) {
        console.warn("Active account not found")
        return
      }

      // Create API instance and connect
      const salesforceAPI = new SalesforceAPI()
      const connectResult = await salesforceAPI.connect(activeAccount.instanceUrl, activeAccount.sessionId)

      if (!connectResult.success) {
        console.error("❌ Sync failed:", connectResult.error)
        return
      }

      // Fetch logs directly
      const { logs } = await salesforceAPI.getDebugLogs({
        startTime: new Date(Date.now() - 60 * 60 * 1000),
        endTime: new Date(),
        maxRecords: 50,
      })

      console.log(`✅ Retrieved ${logs.length} Salesforce logs from ${activeAccount.name}`)

      // Store logs
      this.salesforceLogs = logs

      // Perform correlations if we have network calls
      if (this.networkCalls.length > 0 && logs.length > 0 && this.correlationEngine) {
        console.log("🔗 Starting correlation analysis...")

        this.correlations = this.correlationEngine.correlateAll(this.networkCalls, logs)

        console.log(`📊 Found ${this.correlations.length} correlations`)

        // Log top correlations
        if (this.correlations.length > 0) {
          console.log("🏆 Top correlations:")
          this.correlations.slice(0, 3).forEach((corr, i) => {
            console.log(`${i + 1}. ${corr.type} - ${corr.confidence.toFixed(3)} confidence - ${corr.reasoning}`)
          })
        }
      } else if (this.networkCalls.length > 0 && logs.length > 0 && !this.correlationEngine) {
        console.warn("⚠️ Correlation engine not loaded, skipping correlation analysis")
      }

      // Store everything
      await this.safeChromeCall(() => {
        return this.chrome.storage.local.set({
          salesforceLogs: logs,
          correlations: this.correlations,
          lastSync: Date.now(),
        })
      })

      this.updatePanelContent()

      const correlationText = this.correlations.length > 0 ? ` (${this.correlations.length} correlations)` : ""
      console.log(`✅ Sync completed: ${logs.length} logs${correlationText}`)
    } catch (error) {
      console.error("❌ Direct sync failed:", error)
    } finally {
      const syncBtn = document.getElementById("sfcc-sync-btn")
      if (syncBtn) {
        this.safeSetTextContent(syncBtn, "Sync SF")
        this.safeSetStyle(syncBtn, "opacity", "1")
      }
    }
  }

  generateId() {
    return Math.random().toString(36).substring(2, 15)
  }

  renderNetworkCalls() {
    const filteredCalls = this.getFilteredNetworkCalls()

    if (filteredCalls.length === 0) {
      const filterText = this.activeFilter
        ? `No ${this.requirements.find((r) => r.key === this.activeFilter)?.label || this.activeFilter} calls captured yet`
        : "No network calls captured yet"

      return `
    <div style="text-align: center; padding: 40px 20px; color: #6b7280;">
      <div style="font-size: 32px; margin-bottom: 12px;">🌐</div>
      <div>${filterText}</div>
      <div style="font-size: 10px; margin-top: 8px;">Perform checkout actions to see network activity</div>
      <div style="font-size: 10px; margin-top: 4px; color: #22c55e;">Monitoring: ${this.isMonitoring ? "Active" : "Inactive"}</div>
      ${this.activeFilter ? `<button onclick="window.sfccMonitor.toggleFilter(null)" style="margin-top: 12px; padding: 4px 8px; background: #60a5fa; color: white; border: none; border-radius: 4px; font-size: 10px; cursor: pointer;">Show All Calls</button>` : ""}
    </div>
  `
    }

    return filteredCalls
      .slice(-20) // Show only last 20 calls to avoid performance issues
      .reverse() // Show newest first
      .map(
        (call) => `
  <div class="sfcc-network-call" style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 8px; overflow: hidden; ${call.status >= 400 ? "border-left: 3px solid #ef4444;" : ""}">
    <div class="sfcc-network-call-header" style="padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: background 0.2s;">
      <div style="display: flex; align-items: center; flex: 1;">
        <span style="font-weight: 600; font-size: 10px; padding: 2px 6px; border-radius: 3px; color: white; margin-right: 8px; background: ${this.getMethodColor(call.method)};">${call.method}</span>
        <span style="font-family: monospace; font-size: 10px; color: #374151; flex: 1; margin-right: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${this.truncateUrl(call.url)}</span>
        ${call.callType ? `<span style="background: #e0f2fe; color: #0369a1; padding: 1px 4px; border-radius: 3px; font-size: 9px; font-weight: 500; text-transform: uppercase; margin-left: 4px;">${call.callType}</span>` : ""}
        ${call.checkoutStage ? `<span style="background: #dbeafe; color: #1d4ed8; padding: 1px 4px; border-radius: 3px; font-size: 9px; font-weight: 500; text-transform: uppercase; margin-left: 4px;">${call.checkoutStage}</span>` : ""}
      </div>
      <div style="font-size: 11px; font-weight: 600; color: ${call.status >= 400 ? "#ef4444" : "#22c55e"};">
        ${call.status}
      </div>
    </div>
    <div class="sfcc-network-call-details" style="padding: 12px; background: white; border-top: 1px solid #e5e7eb; display: none; font-size: 11px;">
      ${
        call.callType
          ? `
        <div style="margin-bottom: 12px;">
          <div style="font-weight: 600; font-size: 10px; color: #374151; margin-bottom: 4px; text-transform: uppercase;">Call Analysis</div>
          <div style="font-family: monospace; font-size: 9px; background: #f0f9ff; padding: 6px; border-radius: 3px; border: 1px solid #bae6fd;">
            <div><strong>Type:</strong> ${call.callType}</div>
            <div><strong>Stage:</strong> ${call.checkoutStage}</div>
            <div><strong>Successful:</strong> ${call.isSuccessful ? "Yes" : "No"}</div>
            ${call.deliveryMethodId ? `<div><strong>Delivery Method ID:</strong> ${call.deliveryMethodId}</div>` : ""}
            ${call.paymentToken ? `<div><strong>Payment Token:</strong> ${call.paymentToken.substring(0, 20)}...</div>` : ""}
          </div>
        </div>
      `
          : ""
      }
      
      ${
        call.checkoutId
          ? `
        <div style="margin-bottom: 12px;">
          <div style="font-weight: 600; font-size: 10px; color: #374151; margin-bottom: 4px; text-transform: uppercase;">Checkout Session</div>
          <div style="font-family: monospace; font-size: 9px; background: #f8fafc; padding: 6px; border-radius: 3px; border: 1px solid #e2e8f0;">Checkout ID: ${call.checkoutId}</div>
        </div>
      `
          : ""
      }
      
      ${
        call.salesforceResultCode
          ? `
        <div style="margin-bottom: 12px;">
          <div style="font-weight: 600; font-size: 10px; color: #374151; margin-bottom: 4px; text-transform: uppercase;">Salesforce Result Code</div>
          <div style="font-family: monospace; font-size: 9px; background: #f8fafc; padding: 6px; border-radius: 3px; border: 1px solid #e2e8f0;">${call.salesforceResultCode}</div>
        </div>
      `
          : ""
      }
      
      <div style="margin-bottom: 12px;">
        <div style="font-weight: 600; font-size: 10px; color: #374151; margin-bottom: 4px; text-transform: uppercase;">Request URL</div>
        <div style="font-family: monospace; font-size: 9px; background: #f8fafc; padding: 6px; border-radius: 3px; border: 1px solid #e2e8f0; word-break: break-all;">${call.url}</div>
      </div>
      
      ${
        call.requestBody
          ? `
        <div style="margin-bottom: 12px;">
          <div style="font-weight: 600; font-size: 10px; color: #374151; margin-bottom: 4px; text-transform: uppercase;">Request Payload</div>
          <div style="font-family: monospace; font-size: 9px; background: #f8fafc; padding: 6px; border-radius: 3px; border: 1px solid #e2e8f0; white-space: pre-wrap; max-height: 120px; overflow: auto;">${typeof call.requestBody === "string" ? call.requestBody : JSON.stringify(call.requestBody, null, 2)}</div>
        </div>
      `
          : ""
      }
      
      <div style="margin-bottom: 12px;">
        <div style="font-weight: 600; font-size: 10px; color: #374151; margin-bottom: 4px; text-transform: uppercase;">Response</div>
        <div style="font-family: monospace; font-size: 9px; background: #f8fafc; padding: 6px; border-radius: 3px; border: 1px solid #e2e8f0; white-space: pre-wrap; max-height: 200px; overflow: auto;">${call.response ? (typeof call.response === "string" ? call.response : JSON.stringify(call.response, null, 2)) : "No response body"}</div>
      </div>
      
      <div style="display: flex; gap: 16px; font-size: 10px; color: #6b7280;">
        <div><strong>Time:</strong> ${new Date(call.timestamp).toLocaleTimeString()}</div>
        <div><strong>Duration:</strong> ${call.duration || 0}ms</div>
        ${call.size ? `<div><strong>Size:</strong> ${call.size} bytes</div>` : ""}
      </div>
    </div>
  </div>
`,
      )
      .join("")
  }
}

// Initialize the monitor
const monitor = new SFCCMonitor()

// Make it globally accessible for debugging
window.sfccMonitor = monitor

console.log("SFCC Checkout Debugger content script loaded")
