// Salesforce API integration for log retrieval
class SalesforceAPI {
    constructor() {
      this.baseUrl = null
      this.sessionId = null
      this.isConnected = false
      this.orgId = null
      this.chrome = window.chrome || window.chrome // Declare chrome variable here
  
      // Handle Chrome API availability
      try {
        if (!this.chrome || !this.chrome.storage) {
          console.warn("Chrome storage API not available, using fallback")
          this.chrome = {
            storage: {
              local: {
                set: () => Promise.resolve(),
                get: () => Promise.resolve({}),
                remove: () => Promise.resolve(),
              },
            },
          }
        }
      } catch (error) {
        console.warn("Chrome API initialization failed:", error)
        this.chrome = {
          storage: {
            local: {
              set: () => Promise.resolve(),
              get: () => Promise.resolve({}),
              remove: () => Promise.resolve(),
            },
          },
        }
      }
    }
  
    async connect(instanceUrl, sessionId) {
      try {
        console.log("🔗 Attempting to connect to Salesforce...")
        console.log("Instance URL:", instanceUrl)
        console.log("Session ID length:", sessionId?.length)
        console.log("Session ID prefix:", sessionId?.substring(0, 15) + "...")
  
        // Set these BEFORE making any requests
        this.baseUrl = instanceUrl.endsWith("/") ? instanceUrl.slice(0, -1) : instanceUrl
        this.sessionId = sessionId
  
        // Test with the simplest possible API call first - using direct fetch instead of makeRequest
        console.log("🧪 Testing with version endpoint...")
        const versionUrl = `${this.baseUrl}/services/data/`
        console.log("Version URL:", versionUrl)
  
        const versionResponse = await fetch(versionUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.sessionId}`,
            Accept: "application/json",
            "User-Agent": "SFCC-Debugger-Extension/1.0",
          },
          mode: "cors",
          credentials: "omit", // Don't send cookies
        })
  
        console.log("Version response status:", versionResponse.status)
        console.log("Version response headers:", Object.fromEntries(versionResponse.headers.entries()))
  
        if (!versionResponse.ok) {
          const errorText = await versionResponse.text()
          console.error("Version endpoint failed:", {
            status: versionResponse.status,
            statusText: versionResponse.statusText,
            errorText: errorText,
            headers: Object.fromEntries(versionResponse.headers.entries()),
          })
  
          // Provide specific error messages based on status
          if (versionResponse.status === 401) {
            throw new Error("Authentication failed. Please check your session ID and try again.")
          } else if (versionResponse.status === 403) {
            throw new Error("Access denied. Your user may not have API access permissions.")
          } else if (versionResponse.status === 404) {
            throw new Error("Salesforce instance not found. Please check your instance URL.")
          } else if (versionResponse.status === 0) {
            throw new Error("Network error. Please check your internet connection and try again.")
          } else {
            throw new Error(`Connection failed: ${versionResponse.status} ${versionResponse.statusText}. ${errorText}`)
          }
        }
  
        const versionData = await versionResponse.json()
        console.log("✅ Version endpoint successful:", versionData)
  
        // Now test limits endpoint with direct fetch
        console.log("🧪 Testing with limits endpoint...")
        const limitsUrl = `${this.baseUrl}/services/data/v58.0/limits`
        console.log("Limits URL:", limitsUrl)
  
        const limitsResponse = await fetch(limitsUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.sessionId}`,
            Accept: "application/json",
            "User-Agent": "SFCC-Debugger-Extension/1.0",
          },
          mode: "cors",
          credentials: "omit",
        })
  
        console.log("Limits response status:", limitsResponse.status)
  
        if (!limitsResponse.ok) {
          const errorText = await limitsResponse.text()
          console.error("Limits endpoint failed:", {
            status: limitsResponse.status,
            statusText: limitsResponse.statusText,
            errorText: errorText,
          })
          throw new Error(`Limits API failed: ${limitsResponse.status} ${limitsResponse.statusText}. ${errorText}`)
        }
  
        const limitsData = await limitsResponse.json()
        console.log("✅ Limits endpoint successful:", limitsData)
  
        // Now set connected to true BEFORE trying org query
        this.isConnected = true
  
        // Try to get org info using makeRequest now that we're connected
        console.log("🧪 Getting organization info...")
        const orgResponse = await this.makeRequest(
          "/services/data/v58.0/query?q=SELECT Id, Name FROM Organization LIMIT 1",
        )
        console.log("✅ Organization query successful:", orgResponse)
  
        this.orgId = orgResponse.records?.[0]?.Id || "unknown"
  
        // Store connection info securely
        await this.chrome.storage.local.set({
          salesforceConnection: {
            instanceUrl: this.baseUrl,
            sessionId: this.sessionId,
            isConnected: true,
            connectedAt: Date.now(),
          },
        })
  
        console.log("🎉 Successfully connected to Salesforce!")
        return {
          success: true,
          orgInfo: {
            orgId: this.orgId,
            orgName: orgResponse.records?.[0]?.Name || "Unknown",
            instanceUrl: this.baseUrl,
          },
        }
      } catch (error) {
        console.error("❌ Failed to connect to Salesforce:", error)
        console.error("Error details:", {
          message: error.message,
          stack: error.stack,
          instanceUrl: this.baseUrl,
          sessionIdProvided: !!sessionId,
          sessionIdLength: sessionId?.length,
          name: error.name,
          cause: error.cause,
        })
  
        // Reset connection state on failure
        this.isConnected = false
        this.baseUrl = null
        this.sessionId = null
  
        return { success: false, error: error.message }
      }
    }
  
    async disconnect() {
      this.baseUrl = null
      this.sessionId = null
      this.isConnected = false
      this.orgId = null
  
      await this.chrome.storage.local.remove("salesforceConnection")
    }
  
    async makeRequest(endpoint, options = {}) {
      if (!this.isConnected || !this.sessionId) {
        throw new Error("Not connected to Salesforce")
      }
  
      const url = `${this.baseUrl}${endpoint}`
      console.log("🌐 Making Salesforce API request:", { url, method: options.method || "GET" })
  
      try {
        const requestOptions = {
          method: options.method || "GET",
          headers: {
            Authorization: `Bearer ${this.sessionId}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "SFCC-Debugger-Extension/1.0",
            ...options.headers,
          },
          mode: "cors",
          credentials: "omit", // Don't send cookies to avoid CORS issues
        }
  
        if (options.body) {
          requestOptions.body = JSON.stringify(options.body)
        }
  
        console.log("Request options:", {
          ...requestOptions,
          headers: {
            ...requestOptions.headers,
            Authorization: `Bearer ${this.sessionId.substring(0, 15)}...`,
          },
        })
  
        const response = await fetch(url, requestOptions)
  
        console.log("Response status:", response.status, response.statusText)
        console.log("Response headers:", Object.fromEntries(response.headers.entries()))
  
        if (!response.ok) {
          const errorText = await response.text()
          console.error("API request failed:", {
            status: response.status,
            statusText: response.statusText,
            errorText: errorText,
            url: url,
            requestHeaders: requestOptions.headers,
          })
  
          if (response.status === 401) {
            this.isConnected = false
            throw new Error("Session expired or invalid. Please reconnect to Salesforce.")
          }
  
          if (response.status === 403) {
            throw new Error("Access denied. Please check your user permissions.")
          }
  
          if (response.status === 0 || response.status === 404) {
            throw new Error("Cannot reach Salesforce. Please check your instance URL and network connection.")
          }
  
          // Try to parse error response
          let errorMessage = `API request failed: ${response.status} ${response.statusText}`
          try {
            const errorJson = JSON.parse(errorText)
            if (errorJson.message) {
              errorMessage += `. ${errorJson.message}`
            } else if (errorJson[0]?.message) {
              errorMessage += `. ${errorJson[0].message}`
            }
          } catch (e) {
            // Error text is not JSON, use as is
            if (errorText) {
              errorMessage += `. ${errorText}`
            }
          }
  
          throw new Error(errorMessage)
        }
  
        const responseData = await response.json()
        console.log("✅ API response successful")
        return responseData
      } catch (error) {
        console.error("❌ Request error:", error)
  
        // Handle network errors
        if (error.name === "TypeError" && error.message.includes("fetch")) {
          throw new Error(
            "Network error: Cannot connect to Salesforce. This might be a CORS issue or network connectivity problem.",
          )
        }
  
        // Handle CORS errors
        if (error.message.includes("CORS")) {
          throw new Error(
            "CORS error: Your Salesforce org may be blocking cross-origin requests. Try using a different browser or check your org's CORS settings.",
          )
        }
  
        throw error
      }
    }
  
    async getDebugLogs(options = {}) {
      const {
        startTime = new Date(Date.now() - 60 * 60 * 1000), // Extended to last 60 minutes
        endTime = new Date(),
        logLevel = "DEBUG",
        maxRecords = 200, // Increased to get more logs
      } = options
  
      try {
        console.log("🔍 Fetching Commerce Cloud debug logs...")
        console.log("📅 Time range:", {
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          durationMinutes: Math.round((endTime - startTime) / (1000 * 60)),
        })
  
        // Query ApexLog records with proper Salesforce datetime format
        const startTimeStr = startTime.toISOString()
        const endTimeStr = endTime.toISOString()
  
        // Filter out /webruntime/api/apex/execute operations (Commerce Cloud performance logs)
        const soql = `
          SELECT Id, Application, DurationMilliseconds, Location, LogLength, 
                 LogUser.Name, Operation, Request, StartTime, Status
          FROM ApexLog 
          WHERE StartTime >= ${startTimeStr} 
          AND StartTime <= ${endTimeStr}
          AND Operation != '/webruntime/api/apex/execute'
          ORDER BY StartTime DESC
          LIMIT ${maxRecords}
        `
  
        console.log("📝 SOQL Query (filtering out /webruntime/api/apex/execute):", soql)
  
        const result = await this.makeRequest(`/services/data/v58.0/query?q=${encodeURIComponent(soql)}`)
        console.log(`📊 Found ${result.totalSize} logs in time window`)
  
        // If no logs found, let's check what operations are available
        if (result.totalSize === 0) {
          console.warn("⚠️ No logs found. Checking available operations...")
  
          try {
            const operationsQuery = `
              SELECT Operation, COUNT(Id) LogCount
              FROM ApexLog 
              WHERE StartTime >= ${startTimeStr} 
              AND StartTime <= ${endTimeStr}
              GROUP BY Operation
              ORDER BY COUNT(Id) DESC
              LIMIT 10
            `
  
            const operationsResult = await this.makeRequest(
              `/services/data/v58.0/query?q=${encodeURIComponent(operationsQuery)}`,
            )
            console.log("📈 Available operations in time window:", operationsResult.records)
  
            // Also check for any Commerce-related logs
            const commerceQuery = `
              SELECT Id, Operation, Request, StartTime
              FROM ApexLog 
              WHERE StartTime >= ${startTimeStr} 
              AND StartTime <= ${endTimeStr}
              AND (Operation LIKE '%Commerce%' OR Operation LIKE '%Perf%' OR Request LIKE '%commerce%')
              ORDER BY StartTime DESC
              LIMIT 20
            `
  
            const commerceResult = await this.makeRequest(
              `/services/data/v58.0/query?q=${encodeURIComponent(commerceQuery)}`,
            )
            console.log("🛒 Commerce-related logs:", commerceResult.records)
          } catch (error) {
            console.warn("Could not fetch operation breakdown:", error.message)
          }
        }
  
        // Log details about what we found
        if (result.records && result.records.length > 0) {
          console.log("🔍  log breakdown:")
          const logsByRequest = {}
          const logsByStatus = {}
  
          result.records.forEach((log) => {
            // Count by request type
            const req = log.Request || "Unknown"
            logsByRequest[req] = (logsByRequest[req] || 0) + 1
  
            // Count by status
            const status = log.Status || "Unknown"
            logsByStatus[status] = (logsByStatus[status] || 0) + 1
          })
  
          console.log("📈 Request types:", logsByRequest)
          console.log("📊 Status breakdown:", logsByStatus)
          console.log("⏰ Time range of logs:", {
            earliest: result.records[result.records.length - 1]?.StartTime,
            latest: result.records[0]?.StartTime,
          })
        } else {
          console.warn("⚠️ No logs found in the specified time window")
        }
  
        // Get detailed log content for each log (limit to avoid rate limits)
        const logsToProcess = result.records.slice(0, Math.min(20, result.records.length))
        console.log(`📝 Processing ${logsToProcess.length} logs for detailed content`)
  
        const logsWithContent = await Promise.all(
          logsToProcess.map(async (log) => {
            try {
              const logBody = await this.getLogBody(log.Id)
              const parsed = this.parseCommerceLogContent(logBody) // Use specialized parser
  
              console.log(`📄 log ${log.Id}:`, {
                request: log.Request,
                duration: log.DurationMilliseconds,
                bodyLength: logBody?.length || 0,
                checkoutEvents: parsed?.checkoutEvents?.length || 0,
                apiCalls: parsed?.apiCalls?.length || 0,
                errors: parsed?.errors?.length || 0,
              })
  
              return {
                ...log,
                body: logBody,
                parsed: parsed,
              }
            } catch (error) {
              console.error(`Failed to get log body for ${log.Id}:`, error)
              return {
                ...log,
                body: null,
                parsed: null,
                error: error.message,
              }
            }
          }),
        )
  
        console.log("✅ logs processed successfully")
        return {
          totalSize: result.totalSize,
          logs: logsWithContent,
        }
      } catch (error) {
        console.error("❌ Failed to get debug logs:", error)
        throw error
      }
    }
  
    async getLogBody(logId) {
      console.log(`📄 Fetching log body for ${logId}`)
  
      const response = await fetch(`${this.baseUrl}/services/data/v58.0/sobjects/ApexLog/${logId}/Body`, {
        headers: {
          Authorization: `Bearer ${this.sessionId}`,
          Accept: "text/plain",
        },
        mode: "cors",
        credentials: "omit",
      })
  
      if (!response.ok) {
        throw new Error(`Failed to get log body: ${response.status} ${response.statusText}`)
      }
  
      const logBody = await response.text()
      console.log(`✅ Log body retrieved (${logBody.length} characters)`)
      return logBody
    }
  
    // Specialized parser for Commerce Cloud logs
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
        performance: {
          totalTime: 0,
          cpuTime: 0,
          heapSize: 0,
        },
      }
  
      lines.forEach((line) => {
        // Extract Apex class from EXTERNAL lines
        if (line.includes("[EXTERNAL]|apex://")) {
          const apexMatch = line.match(/apex:\/\/([^/]+)\//)
          if (apexMatch) {
            parsed.apexClass = apexMatch[1]
          }
        }
  
        // Extract user info from USER_INFO lines
        if (line.includes("|USER_INFO|")) {
          const userMatch = line.match(/\|([^|]+@[^|]+)\|/)
          if (userMatch) {
            parsed.userInfo = userMatch[1]
          }
        }
  
        // Parse Commerce Cloud specific log patterns
        if (line.includes("|FATAL_ERROR|") || line.includes("|ERROR|") || line.includes("|EXCEPTION_THROWN|")) {
          parsed.errors.push({
            timestamp: this.extractTimestamp(line),
            message: line,
            type: "error",
          })
        } else if (line.includes("|WARN|")) {
          parsed.warnings.push({
            timestamp: this.extractTimestamp(line),
            message: line,
            type: "warning",
          })
        }
  
        // Commerce Cloud specific patterns
        if (line.includes("checkout") || line.includes("Checkout")) {
          parsed.checkoutEvents.push({
            timestamp: this.extractTimestamp(line),
            event: line,
            type: "checkout",
          })
        }
  
        if (line.includes("payment") || line.includes("Payment")) {
          parsed.paymentEvents.push({
            timestamp: this.extractTimestamp(line),
            event: line,
            type: "payment",
          })
        }
  
        if (line.includes("cart") || line.includes("Cart")) {
          parsed.cartEvents.push({
            timestamp: this.extractTimestamp(line),
            event: line,
            type: "cart",
          })
        }
  
        // API and web service calls
        if (line.includes("|CALLOUT_REQUEST|") || line.includes("|CALLOUT_RESPONSE|")) {
          parsed.webserviceCalls.push({
            timestamp: this.extractTimestamp(line),
            callout: line,
            type: "callout",
          })
        }
  
        // Look for Commerce Cloud API patterns
        if (line.includes("/webruntime/") || line.includes("/commerce/") || line.includes("/services/data/")) {
          parsed.apiCalls.push({
            timestamp: this.extractTimestamp(line),
            call: line,
            type: "api",
          })
        }
  
        // Extract performance metrics
        if (line.includes("Number of SOQL queries:")) {
          parsed.performance.soqlQueries = Number.parseInt(line.match(/\d+/)?.[0] || 0)
        }
        if (line.includes("Number of DML statements:")) {
          parsed.performance.dmlStatements = Number.parseInt(line.match(/\d+/)?.[0] || 0)
        }
        if (line.includes("Maximum CPU time:")) {
          parsed.performance.cpuTime = Number.parseInt(line.match(/\d+/)?.[0] || 0)
        }
        if (line.includes("Maximum heap size:")) {
          parsed.performance.heapSize = Number.parseInt(line.match(/\d+/)?.[0] || 0)
        }
      })
  
      return parsed
    }
  
    // Keep the original parser as fallback
    parseLogContent(logBody) {
      if (!logBody) return null
  
      const lines = logBody.split("\n")
      const parsed = {
        errors: [],
        warnings: [],
        systemEvents: [],
        userActions: [],
        dmlOperations: [],
        soqlQueries: [],
        webserviceCalls: [],
        performance: {
          totalTime: 0,
          cpuTime: 0,
          heapSize: 0,
        },
      }
  
      lines.forEach((line) => {
        // Parse different log line types
        if (line.includes("|FATAL_ERROR|") || line.includes("|ERROR|") || line.includes("|EXCEPTION_THROWN|")) {
          parsed.errors.push({
            timestamp: this.extractTimestamp(line),
            message: line,
            type: "error",
          })
        } else if (line.includes("|WARN|")) {
          parsed.warnings.push({
            timestamp: this.extractTimestamp(line),
            message: line,
            type: "warning",
          })
        } else if (line.includes("|DML_BEGIN|") || line.includes("|DML_END|")) {
          parsed.dmlOperations.push({
            timestamp: this.extractTimestamp(line),
            operation: line,
            type: "dml",
          })
        } else if (line.includes("|SOQL_EXECUTE_BEGIN|") || line.includes("|SOQL_EXECUTE_END|")) {
          parsed.soqlQueries.push({
            timestamp: this.extractTimestamp(line),
            query: line,
            type: "soql",
          })
        } else if (line.includes("|CALLOUT_REQUEST|") || line.includes("|CALLOUT_RESPONSE|")) {
          parsed.webserviceCalls.push({
            timestamp: this.extractTimestamp(line),
            callout: line,
            type: "callout",
          })
        } else if (line.includes("|USER_INFO|") || line.includes("|ENTERING_MANAGED_PKG|")) {
          parsed.systemEvents.push({
            timestamp: this.extractTimestamp(line),
            event: line,
            type: "system",
          })
        }
  
        // Extract performance metrics
        if (line.includes("Number of SOQL queries:")) {
          parsed.performance.soqlQueries = Number.parseInt(line.match(/\d+/)?.[0] || 0)
        }
        if (line.includes("Number of DML statements:")) {
          parsed.performance.dmlStatements = Number.parseInt(line.match(/\d+/)?.[0] || 0)
        }
        if (line.includes("Maximum CPU time:")) {
          parsed.performance.cpuTime = Number.parseInt(line.match(/\d+/)?.[0] || 0)
        }
        if (line.includes("Maximum heap size:")) {
          parsed.performance.heapSize = Number.parseInt(line.match(/\d+/)?.[0] || 0)
        }
      })
  
      return parsed
    }
  
    extractTimestamp(line) {
      // Extract timestamp from log line format: HH:mm:ss.SSS
      const match = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3})/)
      return match ? match[1] : null
    }
  
    async correlateWithCheckout(checkoutCalls, timeWindow = 15 * 60 * 1000) {
      // Extended to 15 minutes
      if (!checkoutCalls.length) {
        console.log("⚠️ No checkout calls provided for correlation")
        return []
      }
  
      console.log(`🔗 Correlating ${checkoutCalls.length} checkout calls with logs`)
      console.log("🛒 Checkout calls summary:", {
        totalCalls: checkoutCalls.length,
        timeRange: {
          earliest: new Date(Math.min(...checkoutCalls.map((c) => c.timestamp))).toISOString(),
          latest: new Date(Math.max(...checkoutCalls.map((c) => c.timestamp))).toISOString(),
        },
        methods: [...new Set(checkoutCalls.map((c) => c.method))],
        statusCodes: [...new Set(checkoutCalls.map((c) => c.status))],
        errorCalls: checkoutCalls.filter((c) => c.status >= 400).length,
      })
  
      const correlations = []
  
      // Get the time range of checkout calls
      const checkoutStart = Math.min(...checkoutCalls.map((call) => call.timestamp))
      const checkoutEnd = Math.max(...checkoutCalls.map((call) => call.timestamp))
  
      // Expand the time window significantly
      const logStart = new Date(checkoutStart - timeWindow)
      const logEnd = new Date(checkoutEnd + timeWindow)
  
      console.log("⏰ Correlation time window:", {
        checkoutStart: new Date(checkoutStart).toISOString(),
        checkoutEnd: new Date(checkoutEnd).toISOString(),
        logStart: logStart.toISOString(),
        logEnd: logEnd.toISOString(),
        windowMinutes: Math.round(timeWindow / (1000 * 60)),
      })
  
      try {
        const { logs } = await this.getDebugLogs({
          startTime: logStart,
          endTime: logEnd,
          maxRecords: 100,
        })
  
        console.log(`📊 Found ${logs.length} logs in correlation time window`)
  
        if (logs.length === 0) {
          console.warn("⚠️ No logs found in the time window")
          return []
        }
  
        // Correlate logs with checkout calls
        let totalComparisons = 0
        let potentialMatches = 0
  
        checkoutCalls.forEach((call) => {
          const callTime = new Date(call.timestamp)
          console.log(
            `🔍 Analyzing checkout call: ${call.method} ${call.url} (${call.status}) at ${callTime.toISOString()}`,
          )
  
          logs.forEach((log) => {
            totalComparisons++
            const logTime = new Date(log.StartTime)
            const timeDiff = Math.abs(callTime.getTime() - logTime.getTime())
  
            // If log is within time window of the call
            if (timeDiff <= timeWindow) {
              potentialMatches++
  
              // Check for relevant content with Commerce Cloud specific scoring
              const relevanceScore = this.calculateCommerceRelevanceScore(call, log)
              const correlationType = this.determineCorrelationType(call, log)
  
              console.log(`⚖️ Potential correlation:`, {
                callUrl: call.url.substring(call.url.lastIndexOf("/") + 1),
                logRequest: log.Request,
                timeDiffMinutes: Math.round(timeDiff / (1000 * 60)),
                relevanceScore: relevanceScore.toFixed(3),
                correlationType,
                threshold: 0.1, // Lowered threshold
              })
  
              // Lowered threshold from 0.3 to 0.1 to be more inclusive
              if (relevanceScore > 0.1) {
                correlations.push({
                  checkoutCall: call,
                  salesforceLog: log,
                  timeDifference: timeDiff,
                  relevanceScore,
                  correlationType: correlationType,
                })
  
                console.log(`✅ Added correlation: ${correlationType} (score: ${relevanceScore.toFixed(3)})`)
              }
            }
          })
        })
  
        console.log(`📈 Correlation analysis complete:`, {
          totalComparisons,
          potentialMatches,
          correlationsFound: correlations.length,
          averageRelevance:
            correlations.length > 0
              ? (correlations.reduce((sum, c) => sum + c.relevanceScore, 0) / correlations.length).toFixed(3)
              : 0,
        })
  
        const sortedCorrelations = correlations.sort((a, b) => b.relevanceScore - a.relevanceScore)
  
        if (sortedCorrelations.length > 0) {
          console.log("🏆 Top correlations:")
          sortedCorrelations.slice(0, 5).forEach((corr, i) => {
            console.log(
              `${i + 1}. ${corr.correlationType} - ${corr.checkoutCall.method} ${corr.checkoutCall.url.split("/").pop()} ↔ ${corr.salesforceLog.Request || corr.salesforceLog.Operation} (${corr.relevanceScore.toFixed(3)})`,
            )
          })
        } else {
          console.warn("❌ No correlations found above threshold")
        }
  
        return sortedCorrelations
      } catch (error) {
        console.error("❌ Failed to correlate logs:", error)
        return []
      }
    }
  
    // Commerce Cloud specific relevance scoring
    calculateCommerceRelevanceScore(checkoutCall, salesforceLog) {
      let score = 0
      const reasons = []
  
      const callUrl = checkoutCall.url.toLowerCase()
      const logContent = (salesforceLog.body || "").toLowerCase()
      const logRequest = (salesforceLog.Request || "").toLowerCase()
  
      // Base score for Commerce Cloud activity
      if (salesforceLog.Operation === "UniversalPerfLogger") {
        score += 0.3
        reasons.push("commerce-perf-log")
      }
  
      // High relevance for payment-related activity
      if (callUrl.includes("payment") && (logContent.includes("payment") || logRequest.includes("payment"))) {
        score += 0.8
        reasons.push("payment-match")
      }
  
      // High relevance for checkout-related content
      if (callUrl.includes("checkout") && (logContent.includes("checkout") || logRequest.includes("checkout"))) {
        score += 0.7
        reasons.push("checkout-match")
      }
  
      // Commerce Cloud API correlation
      if (callUrl.includes("/commerce/") && (logContent.includes("commerce") || logRequest.includes("commerce"))) {
        score += 0.6
        reasons.push("commerce-api-match")
      }
  
      // Webstore correlation
      if (callUrl.includes("webstore") && (logContent.includes("webstore") || logRequest.includes("webstore"))) {
        score += 0.6
        reasons.push("webstore-match")
      }
  
      // Error correlation
      if (checkoutCall.status >= 400 && salesforceLog.parsed?.errors?.length > 0) {
        score += 0.8
        reasons.push("error-correlation")
      }
  
      // Exact ID matches
      if (checkoutCall.checkoutId && logContent.includes(checkoutCall.checkoutId)) {
        score += 1.0
        reasons.push("checkout-id-match")
      }
  
      if (checkoutCall.webstoreId && logContent.includes(checkoutCall.webstoreId)) {
        score += 0.9
        reasons.push("webstore-id-match")
      }
  
      // Commerce Cloud specific events
      if (salesforceLog.parsed?.checkoutEvents?.length > 0) {
        score += 0.5
        reasons.push("checkout-events")
      }
  
      if (salesforceLog.parsed?.paymentEvents?.length > 0 && callUrl.includes("payment")) {
        score += 0.7
        reasons.push("payment-events")
      }
  
      if (salesforceLog.parsed?.cartEvents?.length > 0 && callUrl.includes("cart")) {
        score += 0.6
        reasons.push("cart-events")
      }
  
      // Time-based correlation bonus (closer in time = higher score)
      const timeDiff = Math.abs(new Date(checkoutCall.timestamp).getTime() - new Date(salesforceLog.StartTime).getTime())
      const timeBonus = Math.max(0, 0.3 - timeDiff / (1000 * 60 * 10)) // Bonus decreases over 10 minutes
      score += timeBonus
      if (timeBonus > 0.1) reasons.push("time-proximity")
  
      const finalScore = Math.min(score, 1.0) // Cap at 1.0
  
      if (finalScore > 0.05) {
        // Only log potential matches
        console.log(`🎯 Commerce relevance calculation:`, {
          callUrl: callUrl.split("/").pop(),
          logRequest: logRequest,
          score: finalScore.toFixed(3),
          reasons: reasons.join(", "),
        })
      }
  
      return finalScore
    }
  
    calculateRelevanceScore(checkoutCall, salesforceLog) {
      // Use the Commerce-specific scoring for logs
      if (salesforceLog.Operation === "UniversalPerfLogger") {
        return this.calculateCommerceRelevanceScore(checkoutCall, salesforceLog)
      }
  
      // Fallback to original scoring for other log types
      let score = 0
      const reasons = []
  
      const callUrl = checkoutCall.url.toLowerCase()
      const logContent = (salesforceLog.body || "").toLowerCase()
      const logOperation = (salesforceLog.Operation || "").toLowerCase()
  
      // Base score for any Commerce Cloud related activity
      if (callUrl.includes("commerce") || callUrl.includes("webstore") || callUrl.includes("checkout")) {
        score += 0.2
        reasons.push("commerce-related")
      }
  
      // High relevance for payment-related logs
      if (callUrl.includes("payment") && (logContent.includes("payment") || logOperation.includes("payment"))) {
        score += 0.8
        reasons.push("payment-match")
      }
  
      // Medium relevance for checkout-related content
      if (callUrl.includes("checkout") && (logContent.includes("checkout") || logOperation.includes("checkout"))) {
        score += 0.6
        reasons.push("checkout-match")
      }
  
      // API call correlation
      if (callUrl.includes("/api/") && (logContent.includes("api") || logOperation.includes("api"))) {
        score += 0.4
        reasons.push("api-match")
      }
  
      // High relevance if there are errors in both
      if (checkoutCall.status >= 400 && salesforceLog.parsed?.errors.length > 0) {
        score += 0.7
        reasons.push("error-correlation")
      }
  
      // Bonus for exact ID matches
      if (checkoutCall.checkoutId && logContent.includes(checkoutCall.checkoutId)) {
        score += 1.0
        reasons.push("checkout-id-match")
      }
  
      if (checkoutCall.webstoreId && logContent.includes(checkoutCall.webstoreId)) {
        score += 0.8
        reasons.push("webstore-id-match")
      }
  
      // General web service activity correlation
      if (salesforceLog.parsed?.webserviceCalls?.length > 0) {
        score += 0.3
        reasons.push("webservice-activity")
      }
  
      // Time-based correlation bonus (closer in time = higher score)
      const timeDiff = Math.abs(new Date(checkoutCall.timestamp).getTime() - new Date(salesforceLog.StartTime).getTime())
      const timeBonus = Math.max(0, 0.2 - timeDiff / (1000 * 60 * 10)) // Bonus decreases over 10 minutes
      score += timeBonus
      if (timeBonus > 0.1) reasons.push("time-proximity")
  
      const finalScore = Math.min(score, 1.0) // Cap at 1.0
  
      if (finalScore > 0.05) {
        // Only log potential matches
        console.log(`🎯 Relevance calculation:`, {
          callUrl: callUrl.split("/").pop(),
          logOp: logOperation,
          score: finalScore.toFixed(3),
          reasons: reasons.join(", "),
        })
      }
  
      return finalScore
    }
  
    determineCorrelationType(checkoutCall, salesforceLog) {
      const callUrl = checkoutCall.url.toLowerCase()
      const hasErrors = checkoutCall.status >= 400 || salesforceLog.parsed?.errors.length > 0
  
      if (hasErrors) return "error"
      if (callUrl.includes("payment")) return "payment"
      if (callUrl.includes("checkout")) return "checkout"
      if (callUrl.includes("inventory")) return "inventory"
      if (callUrl.includes("shipping") || callUrl.includes("delivery")) return "shipping"
      if (callUrl.includes("tax")) return "tax"
      return "general"
    }
  
    async testConnection() {
      if (!this.isConnected) return { success: false, message: "Not connected" }
  
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
  
    validateSessionId(sessionId) {
      if (!sessionId) {
        return { valid: false, error: "Session ID is required" }
      }
  
      if (sessionId.length < 15) {
        return { valid: false, error: "Session ID appears to be too short" }
      }
  
      // Your session ID format looks correct: starts with 00D and has the ! separator
      if (!sessionId.includes("!") && !sessionId.startsWith("00D")) {
        return {
          valid: false,
          error:
            "Session ID format may be incorrect. Please ensure you're copying the full session ID from your browser's developer tools.",
        }
      }
  
      return { valid: true }
    }
  
    getConnectionInstructions() {
      return {
        steps: [
          "1. Open your Salesforce org in a new tab",
          "2. Open browser Developer Tools (F12)",
          "3. Go to Application/Storage tab",
          "4. Find Cookies for your Salesforce domain",
          "5. Look for 'sid' cookie and copy its value",
          "6. Alternatively, go to Network tab, make any request, and look for 'Authorization: Bearer' header",
        ],
        troubleshooting: [
          "Ensure you're logged into Salesforce in the same browser",
          "Check that your Salesforce org allows API access",
          "Verify the instance URL is correct (e.g., https://yourorg.my.salesforce.com)",
          "Make sure the session hasn't expired",
        ],
      }
    }
  }
  
  // Export for use in other scripts
  window.SalesforceAPI = SalesforceAPI
  