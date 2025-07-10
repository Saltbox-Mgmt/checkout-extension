// Dedicated Salesforce logging and correlation service
;(() => {
    console.log("🔧 Loading SalesforceLogger...")
  
    class SalesforceLogger {
      constructor() {
        this.baseUrl = null
        this.sessionId = null
        this.isConnected = false
        this.orgId = null
        this.chrome = window.chrome || window.chrome
        this.logs = []
        this.lastSync = null
        this.syncInProgress = false
  
        console.log("✅ SalesforceLogger initialized")
      }
  
      // Connection management
      async connect(instanceUrl, sessionId) {
        try {
          console.log("🔗 Connecting to Salesforce...")
  
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
          console.log("✅ Connected to Salesforce successfully")
          return { success: true }
        } catch (error) {
          console.error("❌ Salesforce connection failed:", error)
          this.isConnected = false
          return { success: false, error: error.message }
        }
      }
  
      async disconnect() {
        this.baseUrl = null
        this.sessionId = null
        this.isConnected = false
        this.orgId = null
        this.logs = []
        console.log("🔌 Disconnected from Salesforce")
      }
  
      // API request wrapper
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
  
      // Main log retrieval method
      async syncLogs(options = {}) {
        if (this.syncInProgress) {
          console.log("⏳ Sync already in progress, skipping...")
          return { success: false, message: "Sync already in progress" }
        }
  
        if (!this.isConnected) {
          console.warn("⚠️ Not connected to Salesforce")
          return { success: false, message: "Not connected to Salesforce" }
        }
  
        try {
          this.syncInProgress = true
          console.log("🔄 Starting Salesforce log sync...")
  
          const {
            startTime = new Date(Date.now() - 60 * 60 * 1000), // Last hour
            endTime = new Date(),
            maxRecords = 50,
          } = options
  
          // Query ApexLog records
          const logs = await this.queryDebugLogs(startTime, endTime, maxRecords)
  
          // Process logs with content
          const processedLogs = await this.processLogs(logs)
  
          // Store results
          this.logs = processedLogs
          this.lastSync = Date.now()
  
          console.log(`✅ Sync completed: ${processedLogs.length} logs retrieved`)
  
          return {
            success: true,
            logs: processedLogs,
            totalCount: logs.length,
            syncTime: this.lastSync,
          }
        } catch (error) {
          console.error("❌ Log sync failed:", error)
          return { success: false, error: error.message }
        } finally {
          this.syncInProgress = false
        }
      }
  
      // Fetch recent logs method for easier access
      async fetchRecentLogs(options = {}) {
        const result = await this.syncLogs(options)
        return result.success ? result.logs : []
      }
  
      // Query debug logs from Salesforce
      async queryDebugLogs(startTime, endTime, maxRecords) {
        const startTimeStr = startTime.toISOString()
        const endTimeStr = endTime.toISOString()
  
        console.log("📅 Querying logs from", startTimeStr, "to", endTimeStr)
  
        const soql = `
          SELECT Id, Application, DurationMilliseconds, Location, LogLength, 
                 LogUser.Name, Operation, Request, StartTime, Status
          FROM ApexLog 
          WHERE StartTime >= ${startTimeStr} 
          AND StartTime <= ${endTimeStr}
          ORDER BY StartTime DESC
          LIMIT ${maxRecords}
        `
  
        const result = await this.makeRequest(`/services/data/v58.0/query?q=${encodeURIComponent(soql)}`)
        console.log(`📊 Found ${result.totalSize} logs in time window`)
  
        return result.records || []
      }
  
      // Process logs by fetching content and parsing
      async processLogs(logs) {
        const processedLogs = []
        const logsToProcess = logs.slice(0, Math.min(20, logs.length)) // Limit processing
  
        console.log(`🔍 Processing ${logsToProcess.length} logs...`)
  
        for (const log of logsToProcess) {
          try {
            const logBody = await this.getLogBody(log.Id)
            const parsed = this.parseLogContent(logBody)
  
            processedLogs.push({
              ...log,
              body: logBody,
              parsed: parsed,
              processedAt: Date.now(),
            })
          } catch (error) {
            console.warn(`⚠️ Failed to process log ${log.Id}:`, error.message)
            processedLogs.push({
              ...log,
              body: null,
              parsed: null,
              error: error.message,
              processedAt: Date.now(),
            })
          }
        }
  
        return processedLogs
      }
  
      // Fetch individual log body
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
  
      // Parse log content for Commerce Cloud patterns
      parseLogContent(logBody) {
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
          performance: {
            totalTime: 0,
            cpuTime: 0,
            heapSize: 0,
            soqlQueries: 0,
            dmlStatements: 0,
          },
        }
  
        lines.forEach((line) => {
          // Extract Apex class information
          if (line.includes("[EXTERNAL]|apex://")) {
            const apexMatch = line.match(/apex:\/\/([^/]+)\//)
            if (apexMatch) {
              parsed.apexClass = apexMatch[1]
            }
          }
  
          // Extract user information
          if (line.includes("|USER_INFO|")) {
            const userMatch = line.match(/\|([^|]+@[^|]+)\|/)
            if (userMatch) {
              parsed.userInfo = userMatch[1]
            }
          }
  
          // Parse error patterns
          if (line.includes("|FATAL_ERROR|") || line.includes("|ERROR|") || line.includes("|EXCEPTION_THROWN|")) {
            parsed.errors.push({
              timestamp: this.extractTimestamp(line),
              message: line.trim(),
              type: "error",
            })
          } else if (line.includes("|WARN|")) {
            parsed.warnings.push({
              timestamp: this.extractTimestamp(line),
              message: line.trim(),
              type: "warning",
            })
          }
  
          // Commerce Cloud specific patterns
          if (line.toLowerCase().includes("checkout")) {
            parsed.checkoutEvents.push({
              timestamp: this.extractTimestamp(line),
              event: line.trim(),
              type: "checkout",
            })
          }
  
          if (line.toLowerCase().includes("payment")) {
            parsed.paymentEvents.push({
              timestamp: this.extractTimestamp(line),
              event: line.trim(),
              type: "payment",
            })
          }
  
          if (line.toLowerCase().includes("cart")) {
            parsed.cartEvents.push({
              timestamp: this.extractTimestamp(line),
              event: line.trim(),
              type: "cart",
            })
          }
  
          // API and web service calls
          if (line.includes("|CALLOUT_REQUEST|") || line.includes("|CALLOUT_RESPONSE|")) {
            parsed.webserviceCalls.push({
              timestamp: this.extractTimestamp(line),
              callout: line.trim(),
              type: "callout",
            })
          }
  
          // Commerce Cloud API patterns
          if (line.includes("/webruntime/") || line.includes("/commerce/") || line.includes("/services/data/")) {
            parsed.apiCalls.push({
              timestamp: this.extractTimestamp(line),
              call: line.trim(),
              type: "api",
            })
          }
  
          // Performance metrics
          if (line.includes("Number of SOQL queries:")) {
            const match = line.match(/(\d+)/)
            if (match) parsed.performance.soqlQueries = Number.parseInt(match[1])
          }
  
          if (line.includes("Number of DML statements:")) {
            const match = line.match(/(\d+)/)
            if (match) parsed.performance.dmlStatements = Number.parseInt(match[1])
          }
  
          if (line.includes("Maximum CPU time:")) {
            const match = line.match(/(\d+)/)
            if (match) parsed.performance.cpuTime = Number.parseInt(match[1])
          }
  
          if (line.includes("Maximum heap size:")) {
            const match = line.match(/(\d+)/)
            if (match) parsed.performance.heapSize = Number.parseInt(match[1])
          }
        })
  
        return parsed
      }
  
      // Extract timestamp from log line
      extractTimestamp(line) {
        const match = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3})/)
        return match ? match[1] : null
      }
  
      // Connection validation
      async testConnection() {
        if (!this.isConnected) {
          return { success: false, message: "Not connected" }
        }
  
        try {
          console.log("🧪 Testing Salesforce connection...")
          await this.makeRequest("/services/data/v58.0/limits")
          console.log("✅ Connection test successful")
          return { success: true, message: "Connection is active" }
        } catch (error) {
          console.error("❌ Connection test failed:", error)
          return { success: false, message: error.message }
        }
      }
  
      // Get current logs
      getLogs() {
        return {
          logs: this.logs,
          lastSync: this.lastSync,
          isConnected: this.isConnected,
          totalCount: this.logs.length,
        }
      }
  
      // Clear stored logs
      clearLogs() {
        this.logs = []
        this.lastSync = null
        console.log("🗑️ Salesforce logs cleared")
      }
  
      // Get connection status
      getConnectionStatus() {
        return {
          isConnected: this.isConnected,
          baseUrl: this.baseUrl,
          orgId: this.orgId,
          lastSync: this.lastSync,
          logCount: this.logs.length,
        }
      }
  
      // Session ID validation
      validateSessionId(sessionId) {
        if (!sessionId) {
          return { valid: false, error: "Session ID is required" }
        }
  
        if (sessionId.length < 15) {
          return { valid: false, error: "Session ID appears to be too short" }
        }
  
        if (!sessionId.includes("!") && !sessionId.startsWith("00D")) {
          return {
            valid: false,
            error: "Session ID format may be incorrect. Please ensure you're copying the full session ID.",
          }
        }
  
        return { valid: true }
      }
  
      // Get setup instructions
      getSetupInstructions() {
        return {
          steps: [
            "1. Open your Salesforce org in a new tab",
            "2. Open browser Developer Tools (F12)",
            "3. Go to Application/Storage tab",
            "4. Find Cookies for your Salesforce domain",
            "5. Look for 'sid' cookie and copy its value",
            "6. Alternatively, go to Network tab and look for 'Authorization: Bearer' header",
          ],
          troubleshooting: [
            "Ensure you're logged into Salesforce in the same browser",
            "Check that your Salesforce org allows API access",
            "Verify the instance URL is correct",
            "Make sure the session hasn't expired",
          ],
        }
      }
  
      // Export logs for debugging
      exportLogs() {
        const exportData = {
          connectionStatus: this.getConnectionStatus(),
          logs: this.logs,
          exportTime: new Date().toISOString(),
          metadata: {
            totalLogs: this.logs.length,
            lastSync: this.lastSync,
            syncInProgress: this.syncInProgress,
          },
        }
  
        return exportData
      }
    }
  
    // Make available globally
    window.SalesforceLogger = SalesforceLogger
  
    console.log("✅ SalesforceLogger class loaded and available")
  
    // Dispatch a custom event to signal the class is ready
    window.dispatchEvent(
      new CustomEvent("SalesforceLoggerReady", {
        detail: { SalesforceLogger },
      }),
    )
  })()
  