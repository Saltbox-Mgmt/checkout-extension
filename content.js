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
    this.currentCheckoutId = null // Track current checkout ID
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
    this.salesforceLogger = null
    this.sessionManager = null
    this.currentSession = null
    this.componentsLoaded = {
      analyzer: false,
      correlationEngine: false,
      salesforceLogger: false,
      sessionManager: false,
    }
    this.sessionsLoaded = false // Add flag to prevent infinite loading
    this.isLoadingSessions = false // Add flag to prevent concurrent loading
    this.autoSaveInterval = null // Add auto-save interval tracker
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

  async init() {
    // Wait for DOM to be ready
    if (document.readyState === "loading") {
      await new Promise((resolve) => {
        document.addEventListener("DOMContentLoaded", resolve)
      })
    }

    // Initialize components using event-based loading
    await this.initializeComponents()

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

    // Initialize after DOM is ready
    this.initializeAfterDOM()
  }

  async initializeComponents() {
    // Set up event listeners for component ready events
    const componentPromises = [
      this.waitForComponentEvent("CheckoutCallAnalyzerReady", "analyzer"),
      this.waitForComponentEvent("CorrelationEngineReady", "correlationEngine"),
      this.waitForComponentEvent("SalesforceLoggerReady", "salesforceLogger"),
      this.waitForComponentEvent("SessionManagerReady", "sessionManager"),
    ]

    // Load all scripts
    this.loadScript("checkout-call-analyzer.js")
    this.loadScript("correlation-engine.js")
    this.loadScript("salesforce-logger.js")
    this.loadScript("session-manager.js")

    // Wait for all components with timeout
    const results = await Promise.allSettled(
      componentPromises.map((promise) =>
        Promise.race([
          promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error("Component load timeout")), 10000)),
        ]),
      ),
    )

    // Process results
    results.forEach((result, index) => {
      const componentNames = ["analyzer", "correlationEngine", "salesforceLogger", "sessionManager"]
      const componentName = componentNames[index]

      if (result.status === "fulfilled") {
        this.componentsLoaded[componentName] = true
        //console.log(`✅ ${componentName} loaded successfully`)
      } else {
        console.warn(`⚠️ ${componentName} failed to load:`, result.reason?.message)
        this.componentsLoaded[componentName] = false
      }
    })

    // Additional check for SessionManager availability
    this.checkSessionManagerAvailability()

    // Final fallback check after a delay
    setTimeout(() => {

      // Check SessionManager one more time
      if (!this.sessionManager && window.SessionManager) {
        //console.log("🔧 Final SessionManager assignment")
        this.sessionManager = window.SessionManager
        this.componentsLoaded.sessionManager = true
        this.updatePanelContent()
      }

      /* console.log("📊 Final component status:", {
        analyzer: !!this.analyzer,
        correlationEngine: !!this.correlationEngine,
        salesforceLogger: !!this.salesforceLogger,
        sessionManager: !!this.sessionManager,
        windowSessionManager: !!window.SessionManager,
      }) */
    }, 3000)

    // Force update panel content after components load
    setTimeout(() => {
      this.updatePanelContent()
    }, 1000)
  }

  checkSessionManagerAvailability() {

    // Check if SessionManager is available even if event didn't fire
    if (window.SessionManager && typeof window.SessionManager === "object") {
      //console.log("🔍 SessionManager found directly on window object")
      this.sessionManager = window.SessionManager
      this.componentsLoaded.sessionManager = true

      // Verify required methods exist
      const requiredMethods = [
        "createSession",
        "createNewSession",
        "loadSessions",
        "saveSession",
        "loadSession",
        "deleteSession",
      ]
      const missingMethods = requiredMethods.filter((method) => typeof this.sessionManager[method] !== "function")

      if (missingMethods.length > 0) {
        console.warn("⚠️ SessionManager missing methods:", missingMethods)
        return false
      }

      // Load existing sessions
      this.loadSessionsForDisplay()

      return true
    } else {
      this.forceLoadSessionManager()

      return false
    }
  }

  forceLoadSessionManager() {
    // Try to load the script again
    if (this.isContextValid()) {
      try {
        const script = document.createElement("script")
        script.src = window.chrome.runtime.getURL("session-manager.js")

        script.onload = () => {

          // Check again after a short delay
          setTimeout(() => {
            if (window.SessionManager && typeof window.SessionManager === "object") {
              this.sessionManager = window.SessionManager
              this.componentsLoaded.sessionManager = true
              this.updatePanelContent()
            } else {
              console.log("❌ SessionManager still not available after force load")
            }
          }, 500)

          script.remove()
        }

        script.onerror = (error) => {
          console.error("❌ Failed to force load SessionManager:", error)
          script.remove()
        }

        const head = document.head || document.getElementsByTagName("head")[0] || document.documentElement
        head.appendChild(script)
      } catch (error) {
        console.error("Failed to inject SessionManager script:", error)
      }
    }
  }

  waitForComponentEvent(eventName, componentName) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`${componentName} event timeout`))
      }, 8000)

      const handler = (event) => {
        clearTimeout(timeout)
        window.removeEventListener(eventName, handler)

        // Initialize the component
        try {
          switch (componentName) {
            case "analyzer":
              this.analyzer = new window.CheckoutCallAnalyzer()
              break
            case "correlationEngine":
              this.correlationEngine = new window.CorrelationEngine()
              break
            case "salesforceLogger":
              this.salesforceLogger = new window.SalesforceLogger()
              break
            case "sessionManager":
              // For the object-based SessionManager, just reference it directly
              this.sessionManager = window.SessionManager
              break
          }
          resolve(true)
        } catch (error) {
          console.error(`Failed to initialize ${componentName}:`, error)
          reject(error)
        }
      }

      window.addEventListener(eventName, handler)
    })
  }

  loadScript(filename) {
    if (!this.isContextValid()) return

    try {
      const script = document.createElement("script")
      script.src = window.chrome.runtime.getURL(filename)

      script.onload = () => {

        // Special handling for session-manager.js
        if (filename === "session-manager.js") {
          // Give it a moment to execute and set up window.SessionManager
          setTimeout(() => {
            this.checkSessionManagerAvailability()
          }, 100)
        }

        script.remove()
      }

      script.onerror = (error) => {
        console.error(`❌ Failed to load ${filename}:`, error)
        script.remove()
      }

      const head = document.head || document.getElementsByTagName("head")[0] || document.documentElement
      head.appendChild(script)
    } catch (error) {
      console.error(`Failed to inject ${filename}:`, error)
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
      } else if (message.action === "getComponentStatus") {
        sendResponse({
          success: true,
          components: this.componentsLoaded,
          analyzer: !!this.analyzer,
          correlationEngine: !!this.correlationEngine,
          salesforceLogger: !!this.salesforceLogger,
          sessionManager: !!this.sessionManager,
          sessionManagerType: typeof this.sessionManager,
          windowSessionManager: typeof window.SessionManager,
        })
      } else if (message.action === "openSidePanelManually") {
        this.openSidePanelManually()
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

    const shouldShowTab = this.isCheckoutPage()
    const tab = document.getElementById("sfcc-debugger-tab")
    const panel = document.getElementById("sfcc-debugger-panel")

    if (shouldShowTab && !tab) {
      // We're on a checkout page but tab doesn't exist - inject it
      this.injectSidePanel()
      this.injectNetworkInterceptor()
      this.startMonitoring()
    } else if (!shouldShowTab && tab) {
      // We're not on a checkout page but tab exists - remove it
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

    /* console.log("Checkout page check:", {
      path,
      isCheckoutPage,
      isExcluded,
      shouldShow,
    }) */

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
        script.remove() // Clean up after loading
      }
      script.onerror = (error) => {
        console.error("Failed to load network interceptor:", error)
      }

      // Inject at the very beginning of head to catch early network calls
      const head = document.head || document.getElementsByTagName("head")[0] || document.documentElement
      head.insertBefore(script, head.firstChild)

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

      <!-- Current Session Section -->
      <div id="sfcc-current-session-section" class="sfcc-status-section" style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; background: #f0fdf4; display: none;">
        <div class="sfcc-status-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div class="sfcc-status-title" style="font-weight: 600; color: #166534; font-size: 12px;">Current Session</div>
          <div style="display: flex; gap: 4px;">
            <button id="sfcc-save-session-btn" style="padding: 2px 6px; border: 1px solid #22c55e; border-radius: 3px; background: #22c55e; color: white; font-size: 9px; cursor: pointer;">Save</button>
            <button id="sfcc-end-session-btn" style="padding: 2px 6px; border: 1px solid #ef4444; border-radius: 3px; background: #ef4444; color: white; font-size: 9px; cursor: pointer;">End</button>
          </div>
        </div>
        <div style="font-size: 11px; color: #166534;">
          <div><strong>Name:</strong> <span id="sfcc-current-session-name">-</span></div>
          <div><strong>Checkout ID:</strong> <span id="sfcc-current-session-checkout-id">-</span></div>
          <div><strong>Duration:</strong> <span id="sfcc-current-session-duration">-</span></div>
          <div><strong>Calls:</strong> <span id="sfcc-current-session-calls">0</span></div>
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
        <button class="sfcc-tab" data-tab="sessions" style="flex: 1; padding: 12px 8px; border: none; background: none; cursor: pointer; font-size: 12px; color: #6b7280; border-bottom: 2px solid transparent; transition: all 0.2s;">Sessions</button>
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
      <button class="sfcc-btn sfcc-btn-danger" id="sfcc-clear-sessions-btn" style="flex: 1; padding: 6px 12px; border: 1px solid #ef4444; border-radius: 4px; background: #ef4444; color: white; font-size: 11px; cursor: pointer; transition: all 0.2s;">Clear Sessions</button>
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

          //console.log("✅ Updated active account display:", activeAccount.name, instanceType)
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

  updateCurrentSessionDisplay() {
    const currentSessionSection = document.getElementById("sfcc-current-session-section")
    const sessionNameEl = document.getElementById("sfcc-current-session-name")
    const sessionCheckoutIdEl = document.getElementById("sfcc-current-session-checkout-id")
    const sessionDurationEl = document.getElementById("sfcc-current-session-duration")
    const sessionCallsEl = document.getElementById("sfcc-current-session-calls")

    if (!currentSessionSection) return

    if (this.currentSession && this.currentSession.id) {
      currentSessionSection.style.display = "block"

      this.safeSetTextContent(sessionNameEl, this.currentSession.name || "Unnamed Session")
      this.safeSetTextContent(
        sessionCheckoutIdEl,
        this.currentSession.checkoutId || this.currentCheckoutId || "Not detected",
      )

      const duration = Math.floor((Date.now() - (this.currentSession.startTime || Date.now())) / 1000)
      this.safeSetTextContent(sessionDurationEl, `${duration}s`)

      this.safeSetTextContent(sessionCallsEl, this.networkCalls.length.toString())
    } else {
      currentSessionSection.style.display = "none"
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

      // Clear Sessions button
      const clearSessionsBtn = document.getElementById("sfcc-clear-sessions-btn")
      if (clearSessionsBtn) {
        clearSessionsBtn.addEventListener("click", () => {
          this.clearAllSessions()
        })
      }

      // Sync button in panel header
      const syncBtn = document.getElementById("sfcc-sync-btn")
      if (syncBtn) {
        syncBtn.addEventListener("click", () => {
          this.syncSalesforceData()
        })
      }

      // Session management buttons
      const saveSessionBtn = document.getElementById("sfcc-save-session-btn")
      if (saveSessionBtn) {
        saveSessionBtn.addEventListener("click", () => {
          this.saveCurrentSession()
        })
      }

      const endSessionBtn = document.getElementById("sfcc-end-session-btn")
      if (endSessionBtn) {
        endSessionBtn.addEventListener("click", () => {
          this.endCurrentSession()
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
      this.updateCurrentSessionDisplay()
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
      const stage = this.mapUrlToRequirement(call.url, call.requestBody)
      return stage === requirementKey
    }).length
  }

  // Enhanced URL to requirement mapping that considers request body
  mapUrlToRequirement(url, requestBody = null) {
    if (!url) return null

    const urlLower = url.toLowerCase()

    // Reduce logging to prevent infinite loops - only log when debugging is needed
    if (this.activeTab === "sessions" && this.isLoadingSessions) {
      // Skip logging during session loading to prevent loops
      return null
    }

    // Handle /active calls by analyzing the request body
    if (urlLower.includes("/active")) {
      if (requestBody) {
        // Parse the request body if it's a string
        let parsedBody = requestBody
        if (typeof requestBody === "string") {
          try {
            parsedBody = JSON.parse(requestBody)
          } catch (e) {
            // Silent fail for parsing errors
          }
        }

        // Check for delivery method updates
        if (parsedBody && parsedBody.deliveryMethodId) {
          return "deliveryMethod"
        }

        // Check for address updates
        if (parsedBody && parsedBody.deliveryAddress) {
          return "shippingAddress"
        }

        // Check for billing address
        if (parsedBody && parsedBody.billingAddress) {
          return "billingAddress"
        }

        // Check for payment updates
        if (parsedBody && (parsedBody.paymentMethodId || parsedBody.paymentDetails)) {
          return "payment"
        }

        // Check for other address-related fields
        if (
          parsedBody &&
          (parsedBody.desiredDeliveryDate || parsedBody.shippingInstructions || parsedBody.contactInfo)
        ) {
          return "shippingAddress"
        }
      }

      return null
    }

    // Existing URL-based logic for other endpoints
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
      urlLower.includes("/products/")
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

    //console.log("Filter toggled:", this.activeFilter)

    // Re-render requirements to update visual state
    this.renderRequirements()

    // Re-render current tab content if it's network tab
    if (this.activeTab === "network") {
      this.renderTabContent()
    }
  }

  renderTabContent() {
    const container = document.getElementById("sfcc-tab-content")
    if (!container) return

    try {
      switch (this.activeTab) {
        case "network":
          container.innerHTML = this.renderNetworkCalls()
          break
        case "sessions":
          container.innerHTML = this.renderSessions()
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
      container.querySelectorAll(".sfcc-network-call-header").forEach((header) => {
        header.addEventListener("click", (e) => {
          const call = e.target.closest(".sfcc-network-call")
          const details = call.querySelector(".sfcc-network-call-details")
          if (details) {
            const isVisible = details.style.display === "block"
            details.style.display = isVisible ? "none" : "block"
          }
        })
      })

      // Add click handlers for session headers
      container.querySelectorAll(".sfcc-session-header").forEach((header) => {
        header.addEventListener("click", (e) => {
          // Don't toggle if clicking a button
          if (e.target.tagName === "BUTTON") return

          const session = e.target.closest(".sfcc-session")
          const details = session.querySelector(".sfcc-session-details")
          if (details) {
            const isVisible = details.style.display === "block"
            details.style.display = isVisible ? "none" : "block"
          }
        })
      })

      // Add click handlers for other expandable items
      container.querySelectorAll(".sfcc-log-header, .sfcc-correlation-header").forEach((header) => {
        header.addEventListener("click", (e) => {
          const item = e.target.closest(".sfcc-log, .sfcc-correlation")
          const details = item.querySelector(".sfcc-log-details, .sfcc-correlation-details")
          if (details) {
            const isVisible = details.style.display === "block"
            details.style.display = isVisible ? "none" : "block"
          }
        })
      })

      // Add session management event listeners if on sessions tab
      if (this.activeTab === "sessions") {
        this.setupSessionTabEventListeners()
      }
    } catch (error) {
      console.error("Error rendering tab content:", error)
    }
  }

  renderNetworkCalls() {
    let filteredCalls = this.networkCalls

    // Apply filter if active
    if (this.activeFilter) {
      filteredCalls = this.networkCalls.filter((call) => {
        const stage = this.mapUrlToRequirement(call.url, call.requestBody)
        return stage === this.activeFilter
      })
    }

    if (filteredCalls.length === 0) {
      return `
    <div style="text-align: center; padding: 40px 20px; color: #6b7280;">
      <div style="font-size: 32px; margin-bottom: 12px;">🌐</div>
      <div>${this.activeFilter ? "No calls found for this filter" : "No network calls captured"}</div>
      <div style="font-size: 10px; margin-top: 8px;">${this.activeFilter ? "Try selecting a different filter" : "Perform checkout actions to see network calls"}</div>
    </div>
  `
    }

    return filteredCalls
      .slice(0, 20) // Limit to avoid performance issues
      .map((call) => {
        const stage = this.mapUrlToRequirement(call.url, call.requestBody)
        const stageLabel = stage ? this.requirements.find((r) => r.key === stage)?.label || stage : "Other"

        // Get analysis from analyzer if available
        let analysisInfo = ""

        return `
      <div class="sfcc-network-call" style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 8px; overflow: hidden;">
        <div class="sfcc-network-call-header" style="padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: background 0.2s;">
          <div style="display: flex; align-items: center; flex: 1;">
            <span style="font-weight: 600; font-size: 10px; padding: 2px 6px; border-radius: 3px; color: white; margin-right: 8px; background: ${this.getMethodColor(call.method)};">${call.method}</span>
            <span style="font-family: monospace; font-size: 10px; color: #374151; flex: 1; margin-right: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${call.urlName || this.truncateUrl(call.url)}</span>
            <span style="background: #dbeafe; color: #1d4ed8; padding: 1px 4px; border-radius: 3px; font-size: 9px; font-weight: 500; text-transform: uppercase; margin-left: 4px;">${stageLabel}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 10px; color: #6b7280;">${call.duration}ms</span>
            <div style="font-size: 11px; font-weight: 600; color: ${this.getStatusColor(call.status)};">
              ${call.status}
            </div>
          </div>
        </div>
        <div class="sfcc-network-call-details" style="padding: 12px; background: white; border-top: 1px solid #e5e7eb; display: none; font-size: 11px;">
          ${analysisInfo}
          
          <div style="margin-bottom: 12px;">
            <div style="font-weight: 600; font-size: 10px; color: #374151; margin-bottom: 4px; text-transform: uppercase;">Request</div>
            <div style="font-family: monospace; font-size: 9px; background: #f8fafc; padding: 6px; border-radius: 3px; border: 1px solid #e2e8f0;">
              <div><strong>URL:</strong> ${call.url}</div>
              <div><strong>Method:</strong> ${call.method}</div>
              <div><strong>Time:</strong> ${new Date(call.timestamp).toLocaleString()}</div>
              <div><strong>Duration:</strong> ${call.duration}ms</div>
            </div>
          </div>
          
          ${
            call.requestBody
              ? `
            <div style="margin-bottom: 12px;">
              <div style="font-weight: 600; font-size: 10px; color: #374151; margin-bottom: 4px; text-transform: uppercase;">Request Body</div>
              <div style="font-family: monospace; font-size: 9px; background: #fef3c7; padding: 6px; border-radius: 3px; border: 1px solid #fde68a; white-space: pre-wrap; max-height: 120px; overflow: auto;">
                ${typeof call.requestBody === "string" ? call.requestBody.substring(0, 500) : JSON.stringify(call.requestBody, null, 2).substring(0, 500)}${(typeof call.requestBody === "string" ? call.requestBody : JSON.stringify(call.requestBody)).length > 500 ? "..." : ""}
              </div>
            </div>
          `
              : ""
          }
          
          ${
            call.responseBody || call.response
              ? `
            <div style="margin-bottom: 12px;">
              <div style="font-weight: 600; font-size: 10px; color: #374151; margin-bottom: 4px; text-transform: uppercase;">Response Body</div>
              <div style="font-family: monospace; font-size: 9px; background: #f0fdf4; padding: 6px; border-radius: 3px; border: 1px solid #bbf7d0; white-space: pre-wrap; max-height: 120px; overflow: auto;">
                ${(() => {
                  const responseData = call.responseBody || call.response
                  const responseStr =
                    typeof responseData === "string" ? responseData : JSON.stringify(responseData, null, 2)
                  return responseStr
                    ? responseStr.substring(0, 500) + (responseStr.length > 500 ? "..." : "")
                    : "No response data"
                })()}
              </div>
            </div>
          `
              : ""
          }
        </div>
      </div>
    `
      })
      .join("")
  }

  renderSessions() {
    if (!this.sessionManager) {
      return `
    <div style="text-align: center; padding: 40px 20px; color: #6b7280;">
      <div style="font-size: 32px; margin-bottom: 12px;">⚠️</div>
      <div>Session Manager not available</div>
      <div style="font-size: 10px; margin-top: 8px;">Sessions cannot be loaded</div>
    </div>
  `
    }

    // Load sessions only once to prevent infinite loops
    if (!this.sessionsLoaded && !this.isLoadingSessions) {
      this.loadSessionsForDisplay()
    }

    // Check if sessions are loaded
    if (this.isLoadingSessions) {
      return `
      <div style="text-align: center; padding: 40px 20px; color: #6b7280;">
        <div style="font-size: 32px; margin-bottom: 12px;">⏳</div>
        <div>Loading sessions...</div>
      </div>
      `
    }

    // Get sessions from SessionManager
    let sessions = []
    try {
      sessions = this.sessionManager.sessions || []
      //console.log(`Found ${sessions.length} sessions to display`)
    } catch (error) {
      console.error("Error accessing sessions:", error)
      return `
      <div style="text-align: center; padding: 40px 20px; color: #6b7280;">
        <div style="font-size: 32px; margin-bottom: 12px;">❌</div>
        <div>Error loading sessions</div>
        <div style="font-size: 10px; margin-top: 8px;">${error.message}</div>
      </div>
    `
    }

    if (sessions.length === 0) {
      return `
    <div style="text-align: center; padding: 40px 20px; color: #6b7280;">
      <div style="font-size: 32px; margin-bottom: 12px;">📋</div>
      <div>No sessions found</div>
      <div style="font-size: 10px; margin-top: 8px;">Sessions will appear here as you debug checkout flows</div>
      <button id="sfcc-create-session-btn" style="margin-top: 12px; padding: 6px 12px; border: 1px solid #60a5fa; border-radius: 4px; background: #60a5fa; color: white; font-size: 11px; cursor: pointer;">Create New Session</button>
    </div>
  `
    }

    // Sort sessions by most recent first
    const sortedSessions = [...sessions].sort((a, b) => (b.startTime || 0) - (a.startTime || 0))

    return `
    <div style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
      <div style="font-size: 12px; color: #6b7280;">${sessions.length} session${sessions.length !== 1 ? "s" : ""} found</div>
      <button id="sfcc-create-session-btn" style="padding: 4px 8px; border: 1px solid #60a5fa; border-radius: 4px; background: #60a5fa; color: white; font-size: 10px; cursor: pointer;">New Session</button>
    </div>
    
    ${sortedSessions
      .map((session) => {
        const duration = session.endTime
          ? Math.floor((session.endTime - session.startTime) / 1000)
          : Math.floor((Date.now() - session.startTime) / 1000)

        const isActive = this.currentSession && this.currentSession.id === session.id

        return `
      <div class="sfcc-session" style="background: ${isActive ? "#f0fdf4" : "#f9fafb"}; border: 1px solid ${isActive ? "#22c55e" : "#e5e7eb"}; border-radius: 6px; margin-bottom: 8px; overflow: hidden;">
        <div class="sfcc-session-header" style="padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: background 0.2s;">
          <div style="display: flex; align-items: center; flex: 1;">
            <div style="width: 8px; height: 8px; border-radius: 50%; background: ${isActive ? "#22c55e" : session.endTime ? "#6b7280" : "#f59e0b"}; margin-right: 8px;"></div>
            <div style="flex: 1;">
              <div style="font-weight: 600; font-size: 11px; color: #374151; margin-bottom: 2px;">${session.name || "Unnamed Session"}</div>
              <div style="font-size: 9px; color: #6b7280;">
                <span>Checkout ID: ${session.checkoutId || "Not detected"}</span> • 
                <span>${session.networkCalls?.length || 0} calls</span> • 
                <span>${duration}s</span>
              </div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            ${
              isActive
                ? `<span style="background: #dcfce7; color: #166534; padding: 1px 4px; border-radius: 3px; font-size: 9px; font-weight: 500; text-transform: uppercase;">Active</span>`
                : session.endTime
                  ? `<span style="background: #f3f4f6; color: #6b7280; padding: 1px 4px; border-radius: 3px; font-size: 9px; font-weight: 500; text-transform: uppercase;">Completed</span>`
                  : `<span style="background: #fef3c7; color: #92400e; padding: 1px 4px; border-radius: 3px; font-size: 9px; font-weight: 500; text-transform: uppercase;">Paused</span>`
            }
          </div>
        </div>
        <div class="sfcc-session-details" style="padding: 12px; background: white; border-top: 1px solid #e5e7eb; display: none; font-size: 11px;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
            <div>
              <div style="font-weight: 600; font-size: 10px; color: #374151; margin-bottom: 4px; text-transform: uppercase;">Session Info</div>
              <div style="font-size: 10px; color: #6b7280;">
                <div><strong>ID:</strong> ${session.id}</div>
                <div><strong>Started:</strong> ${new Date(session.startTime).toLocaleString()}</div>
                ${session.endTime ? `<div><strong>Ended:</strong> ${new Date(session.endTime).toLocaleString()}</div>` : ""}
                <div><strong>Duration:</strong> ${duration}s</div>
                <div><strong>Checkout ID:</strong> ${session.checkoutId || "Not detected"}</div>
              </div>
            </div>
            <div>
              <div style="font-weight: 600; font-size: 10px; color: #374151; margin-bottom: 4px; text-transform: uppercase;">Statistics</div>
              <div style="font-size: 10px; color: #6b7280;">
                <div><strong>Network Calls:</strong> ${session.networkCalls?.length || 0}</div>
                <div><strong>Errors:</strong> ${session.errors?.length || 0}</div>
                <div><strong>SF Logs:</strong> ${session.salesforceLogs?.length || 0}</div>
                <div><strong>Correlations:</strong> ${session.correlations?.length || 0}</div>
              </div>
            </div>
          </div>
          
          <div style="display: flex; gap: 6px; margin-top: 12px;">
            ${
              !isActive
                ? `<button class="sfcc-load-session-btn" data-session-id="${session.id}" style="padding: 4px 8px; border: 1px solid #22c55e; border-radius: 3px; background: #22c55e; color: white; font-size: 9px; cursor: pointer;">Load Session</button>`
                : ""
            }
            <button class="sfcc-export-session-btn" data-session-id="${session.id}" style="padding: 4px 8px; border: 1px solid #60a5fa; border-radius: 3px; background: #60a5fa; color: white; font-size: 9px; cursor: pointer;">Export</button>
            <button class="sfcc-delete-session-btn" data-session-id="${session.id}" style="padding: 4px 8px; border: 1px solid #ef4444; border-radius: 3px; background: #ef4444; color: white; font-size: 9px; cursor: pointer;">Delete</button>
          </div>
        </div>
      </div>
    `
      })
      .join("")}
  `
  }

  async loadSessionsForDisplay() {
    if (this.isLoadingSessions) {
      return
    }

    this.isLoadingSessions = true

    try {
      if (this.sessionManager && typeof this.sessionManager.loadSessions === "function") {
        await this.sessionManager.loadSessions()
        //console.log(`Loaded ${this.sessionManager.sessions?.length || 0} sessions`)
        this.sessionsLoaded = true
      } else {
        console.warn("SessionManager or loadSessions method not available")
      }
    } catch (error) {
      console.error("Error loading sessions:", error)
    } finally {
      this.isLoadingSessions = false
    }
  }

  setupSessionTabEventListeners() {
    const container = document.getElementById("sfcc-tab-content")
    if (!container) return

    // Create new session button
    const createBtn = container.querySelector("#sfcc-create-session-btn")
    if (createBtn) {
      createBtn.addEventListener("click", () => {
        this.createNewSession()
      })
    }

    // Load session buttons
    container.querySelectorAll(".sfcc-load-session-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const sessionId = e.target.dataset.sessionId
        this.loadSession(sessionId)
      })
    })

    // Export session buttons
    container.querySelectorAll(".sfcc-export-session-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const sessionId = e.target.dataset.sessionId
        this.exportSession(sessionId)
      })
    })

    // Delete session buttons
    container.querySelectorAll(".sfcc-delete-session-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const sessionId = e.target.dataset.sessionId
        if (confirm("Are you sure you want to delete this session?")) {
          this.deleteSession(sessionId)
        }
      })
    })
  }

  renderCorrelations() {
    if (this.correlations.length === 0) {
      return `
    <div style="text-align: center; padding: 40px 20px; color: #6b7280;">
      <div style="font-size: 32px; margin-bottom: 12px;">🔗</div>
      <div>No correlations found</div>
      <div style="font-size: 10px; margin-top: 8px;">Correlations between network calls and Salesforce logs will appear here</div>
    </div>
  `
    }

    return this.correlations
      .map((correlation) => {
        return `
      <div class="sfcc-correlation" style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 8px; overflow: hidden;">
        <div class="sfcc-correlation-header" style="padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: background 0.2s;">
          <div style="display: flex; align-items: center; flex: 1;">
            <span style="font-weight: 600; font-size: 10px; padding: 2px 6px; border-radius: 3px; color: white; margin-right: 8px; background: #8b5cf6;">CORR</span>
            <span style="font-size: 11px; color: #374151; flex: 1;">${correlation.type}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 10px; color: #6b7280;">${new Date(correlation.timestamp).toLocaleTimeString()}</span>
            <div style="font-size: 11px; font-weight: 600; color: #8b5cf6;">
              ${(correlation.confidence * 100).toFixed(0)}%
            </div>
          </div>
        </div>
        <div class="sfcc-correlation-details" style="padding: 12px; background: white; border-top: 1px solid #e5e7eb; display: none; font-size: 11px;">
          <div style="margin-bottom: 12px;">
            <div style="font-weight: 600; font-size: 10px; color: #374151; margin-bottom: 4px; text-transform: uppercase;">Correlation Details</div>
            <div style="font-family: monospace; font-size: 9px; background: #f8fafc; padding: 6px; border-radius: 3px; border: 1px solid #e2e8f0;">
              <div><strong>Type:</strong> ${correlation.type}</div>
              <div><strong>Confidence:</strong> ${(correlation.confidence * 100).toFixed(0)}%</div>
              <div><strong>Network Call:</strong> ${correlation.networkCall?.method} ${correlation.networkCall?.url}</div>
              <div><strong>Salesforce Log:</strong> ${correlation.salesforceLog?.message}</div>
            </div>
          </div>
        </div>
      </div>
    `
      })
      .join("")
  }

  renderSalesforceLogs() {
    if (this.salesforceLogs.length === 0) {
      return `
    <div style="text-align: center; padding: 40px 20px; color: #6b7280;">
      <div style="font-size: 32px; margin-bottom: 12px;">📋</div>
      <div>No Salesforce logs found</div>
      <div style="font-size: 10px; margin-top: 8px;">Connect to Salesforce to see logs here</div>
    </div>
  `
    }

    return this.salesforceLogs
      .slice(0, 20) // Limit to avoid performance issues
      .map((log) => {
        return `
      <div class="sfcc-log" style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 8px; overflow: hidden;">
        <div class="sfcc-log-header" style="padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: background 0.2s;">
          <div style="display: flex; align-items: center; flex: 1;">
            <span style="font-weight: 600; font-size: 10px; padding: 2px 6px; border-radius: 3px; color: white; margin-right: 8px; background: ${this.getLogLevelColor(log.level)};">${log.level}</span>
            <span style="font-size: 11px; color: #374151; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${log.message}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 10px; color: #6b7280;">${new Date(log.timestamp).toLocaleTimeString()}</span>
          </div>
        </div>
        <div class="sfcc-log-details" style="padding: 12px; background: white; border-top: 1px solid #e5e7eb; display: none; font-size: 11px;">
          <div style="margin-bottom: 12px;">
            <div style="font-weight: 600; font-size: 10px; color: #374151; margin-bottom: 4px; text-transform: uppercase;">Log Details</div>
            <div style="font-family: monospace; font-size: 9px; background: #f8fafc; padding: 6px; border-radius: 3px; border: 1px solid #e2e8f0;">
              <div><strong>Level:</strong> ${log.level}</div>
              <div><strong>Message:</strong> ${log.message}</div>
              <div><strong>Time:</strong> ${new Date(log.timestamp).toLocaleString()}</div>
              ${log.source ? `<div><strong>Source:</strong> ${log.source}</div>` : ""}
              ${log.category ? `<div><strong>Category:</strong> ${log.category}</div>` : ""}
            </div>
          </div>
          
          ${
            log.details
              ? `
            <div style="margin-bottom: 12px;">
              <div style="font-weight: 600; font-size: 10px; color: #374151; margin-bottom: 4px; text-transform: uppercase;">Additional Details</div>
              <div style="font-family: monospace; font-size: 9px; background: #f0fdf4; padding: 6px; border-radius: 3px; border: 1px solid #bbf7d0; white-space: pre-wrap; max-height: 120px; overflow: auto;">
                ${typeof log.details === "string" ? log.details : JSON.stringify(log.details, null, 2)}
              </div>
            </div>
          `
              : ""
          }
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
      <div style="font-size: 10px; margin-top: 8px;">Errors will appear here when detected</div>
    </div>
  `
    }

    return this.errors
      .map((error) => {
        return `
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; margin-bottom: 8px; padding: 12px;">
        <div style="display: flex; justify-content: between; align-items: center; margin-bottom: 8px;">
          <div style="font-weight: 600; font-size: 11px; color: #dc2626;">${error.type || "Error"}</div>
          <div style="font-size: 10px; color: #6b7280;">${new Date(error.timestamp).toLocaleTimeString()}</div>
        </div>
        <div style="font-size: 10px; color: #374151; margin-bottom: 8px;">${error.message}</div>
        ${
          error.details
            ? `
          <div style="font-family: monospace; font-size: 9px; background: white; padding: 6px; border-radius: 3px; border: 1px solid #fecaca; white-space: pre-wrap; max-height: 120px; overflow: auto;">
            ${typeof error.details === "string" ? error.details : JSON.stringify(error.details, null, 2)}
          </div>
        `
            : ""
        }
      </div>
    `
      })
      .join("")
  }

  getMethodColor(method) {
    const colors = {
      GET: "#10b981",
      POST: "#3b82f6",
      PUT: "#f59e0b",
      DELETE: "#ef4444",
      PATCH: "#8b5cf6",
    }
    return colors[method] || "#6b7280"
  }

  getStatusColor(status) {
    if (status >= 200 && status < 300) return "#10b981"
    if (status >= 300 && status < 400) return "#f59e0b"
    if (status >= 400) return "#ef4444"
    return "#6b7280"
  }

  getLogLevelColor(level) {
    const colors = {
      ERROR: "#ef4444",
      WARN: "#f59e0b",
      INFO: "#3b82f6",
      DEBUG: "#6b7280",
    }
    return colors[level] || "#6b7280"
  }

  truncateUrl(url) {
    if (url.length <= 50) return url
    return url.substring(0, 47) + "..."
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
    if (statusElement) {
      if (this.checkoutStatus) {
        this.safeSetTextContent(statusElement, this.checkoutStatus)
        this.safeSetStyle(statusElement, "background", "#dcfce7")
        this.safeSetStyle(statusElement, "color", "#166534")
      } else {
        this.safeSetTextContent(statusElement, "Unknown")
        this.safeSetStyle(statusElement, "background", "#f3f4f6")
        this.safeSetStyle(statusElement, "color", "#6b7280")
      }
    }
  }

  updateTabStatusIndicator() {
    const indicator = document.getElementById("sfcc-tab-status-indicator")
    if (indicator) {
      if (this.isMonitoring && this.networkCalls.length > 0) {
        this.safeSetStyle(indicator, "background", "#22c55e") // Green for active with data
      } else if (this.isMonitoring) {
        this.safeSetStyle(indicator, "background", "#f59e0b") // Yellow for active but no data
      } else {
        this.safeSetStyle(indicator, "background", "#6b7280") // Gray for inactive
      }
    }
  }

  updateSessionInfo() {
    try {
      // Update call count
      const callCountElement = document.getElementById("sfcc-call-count")
      if (callCountElement) {
        this.safeSetTextContent(callCountElement, this.networkCalls.length.toString())
      }

      // Update error count
      const errorCountElement = document.getElementById("sfcc-error-count")
      if (errorCountElement) {
        this.safeSetTextContent(errorCountElement, this.errors.length.toString())
      }

      // Update session duration
      const durationElement = document.getElementById("sfcc-session-duration")
      if (durationElement) {
        const duration = Math.floor((Date.now() - this.sessionStart) / 1000)
        this.safeSetTextContent(durationElement, `${duration}s`)
      }

      // Update correlation count
      const correlationCountElement = document.getElementById("sfcc-correlation-count")
      if (correlationCountElement) {
        this.safeSetTextContent(correlationCountElement, this.salesforceLogs.length.toString())
      }

      // Update current session display
      this.updateCurrentSessionDisplay()
    } catch (error) {
      console.warn("Error updating session info:", error)
    }
  }

  startMonitoring() {
    if (this.isMonitoring) return

    this.isMonitoring = true

    // Start auto-save interval
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval)
    }
    this.autoSaveInterval = setInterval(() => {
      this.autoSaveCurrentSession()
    }, 30000) // Auto-save every 30 seconds

    this.updatePanelContent()
  }

  stopMonitoring() {
    if (!this.isMonitoring) return

    this.isMonitoring = false

    // Clear auto-save interval
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval)
      this.autoSaveInterval = null
    }

    this.updatePanelContent()
  }

  // Enhanced checkout ID extraction for Salesforce Commerce API endpoints
  extractCheckoutId(callData) {
    const url = callData.url
    const requestBody = callData.requestBody
    const responseBody = callData.responseBody || callData.response

    /* console.log("🔍 Extracting checkout ID from:", {
      url: url,
      hasRequestBody: !!requestBody,
      hasResponseBody: !!responseBody,
    }) */

    // Priority 1: Extract from Salesforce Commerce API URLs
    // Pattern: /webruntime/api/services/data/v64.0/commerce/webstores/{webstoreId}/checkouts/{checkoutId}
    const salesforceCheckoutMatch = url.match(/\/checkouts\/([a-zA-Z0-9]{15,18})(?:\?|$)/)
    if (salesforceCheckoutMatch) {
      const checkoutId = salesforceCheckoutMatch[1]
      //console.log("✅ Found checkout ID in Salesforce URL:", checkoutId)
      return checkoutId
    }

    // Priority 2: Extract from response body (for both checkout endpoints)
    if (responseBody) {
      let parsedResponse = responseBody
      if (typeof responseBody === "string") {
        try {
          parsedResponse = JSON.parse(responseBody)
        } catch (e) {
          console.warn("Failed to parse response body as JSON")
        }
      }

      if (parsedResponse && typeof parsedResponse === "object") {
        // Direct checkoutId field
        if (parsedResponse.checkoutId) {
          //console.log("✅ Found checkout ID in response.checkoutId:", parsedResponse.checkoutId)
          return parsedResponse.checkoutId
        }

        // Check for id field (common in Salesforce APIs)
        if (parsedResponse.id && parsedResponse.id.length >= 15) {
          //console.log("✅ Found checkout ID in response.id:", parsedResponse.id)
          return parsedResponse.id
        }

        // Check nested data structures
        if (parsedResponse.data) {
          if (parsedResponse.data.checkoutId) {
            //console.log("✅ Found checkout ID in response.data.checkoutId:", parsedResponse.data.checkoutId)
            return parsedResponse.data.checkoutId
          }
          if (parsedResponse.data.id && parsedResponse.data.id.length >= 15) {
            //console.log("✅ Found checkout ID in response.data.id:", parsedResponse.data.id)
            return parsedResponse.data.id
          }
        }
      }
    }

    // Priority 3: Extract from request body
    if (requestBody) {
      let parsedBody = requestBody
      if (typeof requestBody === "string") {
        try {
          parsedBody = JSON.parse(requestBody)
        } catch (e) {
          // Check for checkout ID in string format
          const stringMatch = requestBody.match(/checkoutId["':\s]*([a-zA-Z0-9]{15,18})/)
          if (stringMatch) {
            //console.log("✅ Found checkout ID in request body string:", stringMatch[1])
            return stringMatch[1]
          }
        }
      }

      if (parsedBody && typeof parsedBody === "object") {
        if (parsedBody.checkoutId) {
          //console.log("✅ Found checkout ID in request.checkoutId:", parsedBody.checkoutId)
          return parsedBody.checkoutId
        }
        if (parsedBody.id && parsedBody.id.length >= 15) {
          //console.log("✅ Found checkout ID in request.id:", parsedBody.id)
          return parsedBody.id
        }
      }
    }

    return null
  }

  handleNetworkCall(callData) {
    try {
      // Analyze the call if analyzer is available
      if (this.analyzer && typeof this.analyzer.analyzeCall === "function") {
        try {
          callData.analysis = this.analyzer.analyzeCall(callData)
        } catch (error) {
          console.warn("Error analyzing call:", error)
        }
      }

      // Extract checkout ID from the call using enhanced extraction
      const extractedCheckoutId = this.extractCheckoutId(callData)

      if (extractedCheckoutId) {
        //console.log("🆔 Extracted checkout ID:", extractedCheckoutId, "from:", callData.url)

        // Check if we need to switch sessions or create first session
        if (!this.currentCheckoutId && !this.currentSession) {
          // First checkout ID detected - create initial session
          //console.log("🆔 First checkout ID detected, creating initial session:", extractedCheckoutId)
          this.currentCheckoutId = extractedCheckoutId
          this.createNewSessionWithCheckoutId(extractedCheckoutId)
        } else if (this.currentCheckoutId && this.currentCheckoutId !== extractedCheckoutId) {
          // Checkout ID changed - handle transition
          //console.log("🔄 Checkout ID changed from", this.currentCheckoutId, "to", extractedCheckoutId)
          this.handleCheckoutIdChange(extractedCheckoutId)
        } else if (!this.currentCheckoutId) {
          // Have a session but no checkout ID - update it
          //console.log("🆔 Adding checkout ID to existing session:", extractedCheckoutId)
          this.currentCheckoutId = extractedCheckoutId
          if (this.currentSession) {
            this.currentSession.checkoutId = extractedCheckoutId
          }
        }
      }

      // Add to network calls
      this.networkCalls.push(callData)

      // Add to current session if it exists
      if (this.currentSession) {
        if (!this.currentSession.networkCalls) {
          this.currentSession.networkCalls = []
        }
        this.currentSession.networkCalls.push(callData)
      }

      // Update checkout data based on the call
      this.updateCheckoutData(callData)

      // Create correlations if correlation engine is available
      if (this.correlationEngine && typeof this.correlationEngine.createCorrelations === "function") {
        try {
          const newCorrelations = this.correlationEngine.createCorrelations([callData], this.salesforceLogs)
          this.correlations.push(...newCorrelations)
        } catch (error) {
          console.warn("Error creating correlations:", error)
        }
      }

      // Update panel if it's open
      this.updatePanelContent()

      //console.log("📞 Network call processed:", callData.method, callData.url)
    } catch (error) {
      console.error("Error handling network call:", error)
    }
  }

  createNewSessionWithCheckoutId(checkoutId) {
    if (!this.sessionManager) {
      console.warn("SessionManager not available, cannot create session")
      return
    }

    try {
      // Check if there's already an existing session for this checkout ID
      const existingSession = this.sessionManager.findSessionByCheckoutId(checkoutId)

      if (existingSession && !existingSession.endTime) {
        //console.log("🔄 Found existing active session for checkout ID, loading it:", existingSession.id)
        this.loadSession(existingSession.id)
        return
      }

      // Create new session with checkout ID
      const sessionData = {
        name: `Checkout ${checkoutId.substring(0, 8)} - ${new Date().toLocaleTimeString()}`,
        checkoutId: checkoutId,
        startTime: Date.now(),
        networkCalls: [...this.networkCalls],
        errors: [...this.errors],
        salesforceLogs: [...this.salesforceLogs],
        correlations: [...this.correlations],
        checkoutData: { ...this.checkoutData },
      }

      //console.log("📝 Creating new session with checkout ID:", checkoutId)

      if (typeof this.sessionManager.createNewSession === "function") {
        this.currentSession = this.sessionManager.createNewSession(sessionData)
        //console.log("✅ Created new session with checkout ID:", this.currentSession.id, checkoutId)
      } else {
        console.error("No session creation method available")
        return
      }

      this.updatePanelContent()
    } catch (error) {
      console.error("Error creating new session with checkout ID:", error)
    }
  }

  async checkForExistingSession(checkoutId) {
    if (!this.sessionManager || !checkoutId) return

    try {
      //console.log("🔍 Checking for existing session with checkout ID:", checkoutId)

      // Load sessions first to ensure we have the latest data
      await this.sessionManager.loadSessions()

      const existingSession = this.sessionManager.findSessionByCheckoutId(checkoutId)

      if (existingSession && !existingSession.endTime) {
        //console.log("🔄 Found existing active session for checkout ID, switching...")

        // Load the existing session
        this.loadSession(existingSession.id)
        return true
      }

      //console.log("ℹ️ No existing active session found for checkout ID:", checkoutId)
      return false
    } catch (error) {
      console.error("Error checking for existing session:", error)
      return false
    }
  }

  handleCheckoutIdChange(newCheckoutId) {
    //console.log("🔄 Handling checkout ID change:", this.currentCheckoutId, "->", newCheckoutId)

    // Check if there's an existing session with this checkout ID
    this.checkForExistingSession(newCheckoutId).then((foundExisting) => {
      if (!foundExisting) {
        // No existing session found, update current session with new checkout ID
        this.currentCheckoutId = newCheckoutId
        if (this.currentSession) {
          this.currentSession.checkoutId = newCheckoutId
          //console.log("✅ Updated current session with new checkout ID:", newCheckoutId)
          this.updatePanelContent()
        }
      }
    })
  }

  createOrContinueSession() {
    // This method is now only called when we have a checkout ID
    if (!this.sessionManager) {
      console.warn("SessionManager not available, cannot create session")
      return
    }

    if (!this.currentCheckoutId) {
      return
    }

    try {
      // Check if we already have an active session
      if (this.currentSession && this.currentSession.id) {
        //console.log("📋 Continuing existing session:", this.currentSession.id)
        return
      }

      // Create new session with checkout ID
      this.createNewSessionWithCheckoutId(this.currentCheckoutId)
    } catch (error) {
      console.error("Error creating or continuing session:", error)
    }
  }

  createNewSession() {
    if (!this.sessionManager) {
      console.warn("SessionManager not available, cannot create session")
      return
    }

    try {
      const sessionData = {
        name: `Checkout Session ${new Date().toLocaleTimeString()}`,
        checkoutId: this.currentCheckoutId,
        startTime: Date.now(),
        networkCalls: [...this.networkCalls],
        errors: [...this.errors],
        salesforceLogs: [...this.salesforceLogs],
        correlations: [...this.correlations],
        checkoutData: { ...this.checkoutData },
      }

      /* console.log("📝 Creating new session with data:", {
        checkoutId: sessionData.checkoutId,
        networkCallsCount: sessionData.networkCalls.length,
      }) */

      if (typeof this.sessionManager.createNewSession === "function") {
        this.currentSession = this.sessionManager.createNewSession(sessionData)
        //console.log("✅ Created new session:", this.currentSession.id)
      } else if (typeof this.sessionManager.createSession === "function") {
        this.currentSession = this.sessionManager.createSession(sessionData)
        //console.log("✅ Created new session (legacy):", this.currentSession.id)
      } else {
        console.error("No session creation method available")
        return
      }

      this.updatePanelContent()
    } catch (error) {
      console.error("Error creating new session:", error)
    }
  }

  saveCurrentSession() {
    if (!this.currentSession || !this.sessionManager) {
      console.warn("No current session or SessionManager to save")
      return
    }

    try {
      // Update session data
      this.currentSession.networkCalls = [...this.networkCalls]
      this.currentSession.errors = [...this.errors]
      this.currentSession.salesforceLogs = [...this.salesforceLogs]
      this.currentSession.correlations = [...this.correlations]
      this.currentSession.checkoutData = { ...this.checkoutData }
      this.currentSession.checkoutId = this.currentCheckoutId

      if (typeof this.sessionManager.saveSession === "function") {
        this.sessionManager.saveSession(this.currentSession)
        //console.log("💾 Saved current session:", this.currentSession.id)
      } else {
        console.warn("SessionManager.saveSession method not available")
      }
    } catch (error) {
      console.error("Error saving current session:", error)
    }
  }

  autoSaveCurrentSession() {
    if (this.currentSession && this.isMonitoring) {
      this.saveCurrentSession()
    }
  }

  endCurrentSession() {
    if (!this.currentSession) {
      console.warn("No current session to end")
      return
    }

    try {
      // Mark session as ended
      this.currentSession.endTime = Date.now()

      // Save the session
      this.saveCurrentSession()

      //console.log("🏁 Ended session:", this.currentSession.id)

      // Clear current session
      this.currentSession = null

      // Update display
      this.updatePanelContent()

      // Refresh sessions tab if it's active
      if (this.activeTab === "sessions") {
        this.sessionsLoaded = false
        this.renderTabContent()
      }
    } catch (error) {
      console.error("Error ending current session:", error)
    }
  }

  loadSession(sessionId) {
    if (!this.sessionManager) {
      console.warn("SessionManager not available, cannot load session")
      return
    }

    try {
      if (typeof this.sessionManager.loadSession === "function") {
        const session = this.sessionManager.loadSession(sessionId)

        if (session) {
          // Save current session first if it exists
          if (this.currentSession && this.currentSession.id !== sessionId) {
            this.saveCurrentSession()
          }

          // Load the session data
          this.currentSession = session
          this.networkCalls = session.networkCalls || []
          this.errors = session.errors || []
          this.salesforceLogs = session.salesforceLogs || []
          this.correlations = session.correlations || []
          this.checkoutData = session.checkoutData || {}
          this.currentCheckoutId = session.checkoutId

          //console.log("📂 Loaded session:", sessionId, "with checkout ID:", this.currentCheckoutId)

          // Update display
          this.updatePanelContent()

          // Switch to network tab to show loaded data
          this.switchTab("network")
        } else {
          console.error("Session not found:", sessionId)
        }
      } else {
        console.warn("SessionManager.loadSession method not available")
      }
    } catch (error) {
      console.error("Error loading session:", error)
    }
  }

  deleteSession(sessionId) {
    if (!this.sessionManager) {
      console.warn("SessionManager not available, cannot delete session")
      return
    }

    try {
      if (typeof this.sessionManager.deleteSession === "function") {
        this.sessionManager.deleteSession(sessionId)
        //console.log("🗑️ Deleted session:", sessionId)

        // If this was the current session, clear it
        if (this.currentSession && this.currentSession.id === sessionId) {
          this.currentSession = null
          this.updatePanelContent()
        }

        // Refresh sessions display
        this.sessionsLoaded = false
        if (this.activeTab === "sessions") {
          this.renderTabContent()
        }
      } else {
        console.warn("SessionManager.deleteSession method not available")
      }
    } catch (error) {
      console.error("Error deleting session:", error)
    }
  }

  exportSession(sessionId) {
    if (!this.sessionManager) {
      console.warn("SessionManager not available, cannot export session")
      return
    }

    try {
      const session = this.sessionManager.loadSession(sessionId)
      if (session) {
        const exportData = {
          session: session,
          exportTime: new Date().toISOString(),
          version: "1.0",
        }

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `sfcc-session-${sessionId}-${new Date().toISOString().split("T")[0]}.json`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)

        //console.log("📤 Exported session:", sessionId)
      }
    } catch (error) {
      console.error("Error exporting session:", error)
    }
  }

  clearAllSessions() {
    if (!confirm("Are you sure you want to clear all sessions? This cannot be undone.")) {
      return
    }

    if (!this.sessionManager) {
      console.warn("SessionManager not available, cannot clear sessions")
      return
    }

    try {
      if (typeof this.sessionManager.clearAllSessions === "function") {
        this.sessionManager.clearAllSessions()

        // Clear current session
        this.currentSession = null

        // Reset sessions loaded flag
        this.sessionsLoaded = false

        // Update display
        this.updatePanelContent()

        // Refresh sessions tab if active
        if (this.activeTab === "sessions") {
          this.renderTabContent()
        }
      } else {
        console.warn("SessionManager.clearAllSessions method not available")
      }
    } catch (error) {
      console.error("Error clearing all sessions:", error)
    }
  }

  handleError(errorData) {
    this.errors.push(errorData)

    // Add to current session if it exists
    if (this.currentSession) {
      if (!this.currentSession.errors) {
        this.currentSession.errors = []
      }
      this.currentSession.errors.push(errorData)
    }

    this.updatePanelContent()
    console.log("❌ Error captured:", errorData.message)
  }

  updateCheckoutData(callData) {
    // This method analyzes network calls to determine checkout progress
    const url = callData.url.toLowerCase()
    const method = callData.method
    const status = callData.status

    // Only process successful calls
    if (status < 200 || status >= 300) return

    // Map different API endpoints to checkout requirements
    if (url.includes("/addresses") || url.includes("/delivery-address") || url.includes("/shipping-address")) {
      this.checkoutData.shippingAddress = true
    }

    if (url.includes("/billing-address")) {
      this.checkoutData.billingAddress = true
    }

    if (url.includes("/delivery-methods") || url.includes("/shipping-methods")) {
      this.checkoutData.deliveryMethod = true
    }

    if (url.includes("/inventory") || url.includes("/cart-items")) {
      this.checkoutData.inventory = true
    }

    if (url.includes("/taxes") || url.includes("/tax")) {
      this.checkoutData.taxes = true
    }

    if (url.includes("/payments") || url.includes("/payment")) {
      this.checkoutData.payment = true
    }

    // Handle /active endpoint by analyzing request body
    if (url.includes("/active") && callData.requestBody) {
      try {
        let parsedBody = callData.requestBody
        if (typeof callData.requestBody === "string") {
          parsedBody = JSON.parse(callData.requestBody)
        }

        if (parsedBody.deliveryMethodId) {
          this.checkoutData.deliveryMethod = true
        }

        if (parsedBody.deliveryAddress || parsedBody.shippingAddress) {
          this.checkoutData.shippingAddress = true
        }

        if (parsedBody.billingAddress) {
          this.checkoutData.billingAddress = true
        }

        if (parsedBody.paymentMethodId || parsedBody.paymentDetails) {
          this.checkoutData.payment = true
        }
      } catch (error) {
        // Silent fail for JSON parsing errors
      }
    }

    // Determine overall checkout status
    const completedRequirements = this.requirements.filter((req) => this.checkoutData[req.key]).length
    const totalRequirements = this.requirements.filter((req) => req.required).length

    if (completedRequirements === 0) {
      this.checkoutStatus = "Started"
    } else if (completedRequirements < totalRequirements) {
      this.checkoutStatus = "In Progress"
    } else {
      this.checkoutStatus = "Ready"
    }
  }

  async syncSalesforceData() {
    const syncBtn = document.getElementById("sfcc-sync-btn")
    if (syncBtn) {
      this.safeSetTextContent(syncBtn, "Syncing...")
      this.safeSetStyle(syncBtn, "opacity", "0.6")
    }

    try {
      // Send message to background script to sync Salesforce data
      await this.safeChromeCall(async () => {
        return new Promise((resolve, reject) => {
          this.chrome.runtime.sendMessage(
            {
              action: "syncSalesforceData",
              url: window.location.href,
              timestamp: Date.now(),
            },
            (response) => {
              if (this.chrome.runtime.lastError) {
                reject(new Error(this.chrome.runtime.lastError.message))
              } else if (response && response.success) {
                resolve(response)
              } else {
                reject(new Error(response?.error || "Sync failed"))
              }
            },
          )
        })
      })

      // Update last sync time in storage
      await this.safeChromeCall(() => {
        return this.chrome.storage.local.set({ lastSync: Date.now() })
      })

      // Update display
      this.updateActiveAccountDisplay()
    } catch (error) {
      console.error("❌ Salesforce sync failed:", error)
    } finally {
      if (syncBtn) {
        this.safeSetTextContent(syncBtn, "Sync SF")
        this.safeSetStyle(syncBtn, "opacity", "1")
      }
    }
  }

  clearData() {
    this.networkCalls = []
    this.errors = []
    this.correlations = []
    this.checkoutData = {}
    this.checkoutStatus = null
    this.sessionStart = Date.now()

    // Clear current session data but keep the session
    if (this.currentSession) {
      this.currentSession.networkCalls = []
      this.currentSession.errors = []
      this.currentSession.correlations = []
      this.currentSession.checkoutData = {}
    }

    this.updatePanelContent()
  }

  exportData() {
    const exportData = {
      networkCalls: this.networkCalls,
      errors: this.errors,
      salesforceLogs: this.salesforceLogs,
      correlations: this.correlations,
      checkoutData: this.checkoutData,
      checkoutStatus: this.checkoutStatus,
      sessionStart: this.sessionStart,
      exportTime: new Date().toISOString(),
      url: window.location.href,
      version: "1.0",
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `sfcc-debug-${new Date().toISOString().split("T")[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

  }

  openSidePanelManually() {
    try {
      // Check if panel already exists
      let tab = document.getElementById("sfcc-debugger-tab")
      let panel = document.getElementById("sfcc-debugger-panel")

      if (!tab || !panel) {
        // Inject the side panel even if not on checkout page
        this.injectSidePanel()
        tab = document.getElementById("sfcc-debugger-tab")
        panel = document.getElementById("sfcc-debugger-panel")
      }

      if (tab && panel) {
        // Open the panel
        this.safeSetStyle(panel, "right", "0px")
        this.safeSetStyle(tab, "display", "none", "important")

        // Update panel content
        this.updatePanelContent()

        return true
      } else {
        console.error("Failed to create side panel elements")
        return false
      }
    } catch (error) {
      console.error("Error opening side panel manually:", error)
      return false
    }
  }
}

// Initialize the monitor when the script loads
if (typeof window !== "undefined") {
  // Ensure we only create one instance
  if (!window.sfccMonitor) {
    window.sfccMonitor = new SFCCMonitor()
  }
}
