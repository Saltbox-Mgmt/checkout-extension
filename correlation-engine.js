class CorrelationEngine {
    constructor() {
      this.correlations = []
      this.confidenceThreshold = 0.6
      this.timeWindow = 5 * 60 * 1000 // 5 minutes
    }
  
    correlateAll(networkCalls, salesforceLogs) {
      console.log(`🔗 Starting correlation of ${networkCalls.length} network calls with ${salesforceLogs.length} SF logs`)
  
      const correlations = []
      let totalComparisons = 0
  
      networkCalls.forEach((call) => {
        const callTime = new Date(call.timestamp)
  
        salesforceLogs.forEach((log) => {
          totalComparisons++
          const logTime = new Date(log.StartTime)
          const timeDiff = Math.abs(callTime - logTime)
  
          // Only correlate within time window
          if (timeDiff <= this.timeWindow) {
            const correlation = this.calculateCorrelation(call, log)
  
            if (correlation.confidence >= this.confidenceThreshold) {
              correlations.push({
                networkCall: call,
                salesforceLog: log,
                ...correlation,
                timeDifference: timeDiff,
              })
            }
          }
        })
      })
  
      console.log(`📊 Completed ${totalComparisons} comparisons, found ${correlations.length} correlations`)
  
      // Sort by confidence
      return correlations.sort((a, b) => b.confidence - a.confidence)
    }
  
    calculateCorrelation(networkCall, salesforceLog) {
      const factors = []
      let score = 0
      const maxScore = 100
  
      // 1. Time proximity (0-25 points)
      const timeDiff = Math.abs(new Date(networkCall.timestamp) - new Date(salesforceLog.StartTime))
      const timeScore = Math.max(0, 25 - timeDiff / 1000 / 60 / 2) // Decrease over 2 minutes
      score += timeScore
      factors.push(`time: ${timeScore.toFixed(1)}`)
  
      // 2. URL/Operation matching (0-20 points)
      const operationScore = this.calculateOperationMatch(networkCall, salesforceLog)
      score += operationScore
      factors.push(`operation: ${operationScore}`)
  
      // 3. Content keyword matching (0-20 points)
      const contentScore = this.calculateContentMatch(networkCall, salesforceLog)
      score += contentScore
      factors.push(`content: ${contentScore}`)
  
      // 4. Error correlation (0-15 points)
      const errorScore = this.calculateErrorMatch(networkCall, salesforceLog)
      score += errorScore
      if (errorScore > 0) factors.push(`error: ${errorScore}`)
  
      // 5. ID matching (0-20 points)
      const idScore = this.calculateIdMatch(networkCall, salesforceLog)
      score += idScore
      if (idScore > 0) factors.push(`id: ${idScore}`)
  
      const confidence = Math.min(score / maxScore, 1)
      const type = this.determineCorrelationType(networkCall, salesforceLog)
  
      return {
        confidence,
        score,
        maxScore,
        factors,
        type,
        reasoning: this.generateReasoning(networkCall, salesforceLog, factors),
      }
    }
  
    calculateOperationMatch(networkCall, salesforceLog) {
      const url = networkCall.url.toLowerCase()
      const operation = (salesforceLog.Operation || "").toLowerCase()
      const request = (salesforceLog.Request || "").toLowerCase()
  
      let score = 0
  
      // Direct operation matching
      if (url.includes("payment") && (operation.includes("payment") || request.includes("payment"))) {
        score += 20
      } else if (url.includes("checkout") && (operation.includes("checkout") || request.includes("checkout"))) {
        score += 18
      } else if (url.includes("cart") && (operation.includes("cart") || request.includes("cart"))) {
        score += 15
      } else if (url.includes("inventory") && (operation.includes("inventory") || request.includes("inventory"))) {
        score += 15
      } else if (url.includes("tax") && (operation.includes("tax") || request.includes("tax"))) {
        score += 12
      }
  
      return Math.min(score, 20)
    }
  
    calculateContentMatch(networkCall, salesforceLog) {
      const logBody = (salesforceLog.body || "").toLowerCase()
      const url = networkCall.url.toLowerCase()
      const requestBody = JSON.stringify(networkCall.requestBody || {}).toLowerCase()
  
      let score = 0
      const keywords = this.extractKeywords(url, requestBody)
  
      keywords.forEach((keyword) => {
        if (logBody.includes(keyword)) {
          score += 3
        }
      })
  
      return Math.min(score, 20)
    }
  
    calculateErrorMatch(networkCall, salesforceLog) {
      if (networkCall.status < 400 || !salesforceLog.parsed?.errors?.length) {
        return 0
      }
  
      const networkErrors = networkCall.response?.errors || []
      const sfErrors = salesforceLog.parsed.errors || []
  
      let score = 0
  
      // Basic error presence correlation
      if (networkErrors.length > 0 && sfErrors.length > 0) {
        score += 10
  
        // Try to match error types/messages
        networkErrors.forEach((netErr) => {
          sfErrors.forEach((sfErr) => {
            const similarity = this.calculateStringSimilarity(netErr.message || netErr.title || "", sfErr.message || "")
            if (similarity > 0.3) {
              score += 5
            }
          })
        })
      }
  
      return Math.min(score, 15)
    }
  
    calculateIdMatch(networkCall, salesforceLog) {
      const logBody = salesforceLog.body || ""
      let score = 0
  
      // Checkout ID matching
      if (networkCall.checkoutId && logBody.includes(networkCall.checkoutId)) {
        score += 15
      }
  
      // Webstore ID matching
      if (networkCall.webstoreId && logBody.includes(networkCall.webstoreId)) {
        score += 10
      }
  
      // Payment token matching
      if (networkCall.requestBody) {
        const paymentToken = this.extractPaymentToken(networkCall.requestBody)
        if (paymentToken && logBody.includes(paymentToken)) {
          score += 12
        }
      }
  
      return Math.min(score, 20)
    }
  
    extractKeywords(url, requestBody) {
      const keywords = []
  
      // Extract from URL
      const urlParts = url.split("/").filter((part) => part.length > 3)
      keywords.push(...urlParts)
  
      // Extract from request body
      try {
        const bodyObj = typeof requestBody === "string" ? JSON.parse(requestBody) : requestBody
        Object.values(bodyObj).forEach((value) => {
          if (typeof value === "string" && value.length > 3) {
            keywords.push(value.toLowerCase())
          }
        })
      } catch (e) {
        // Ignore parsing errors
      }
  
      return [...new Set(keywords)] // Remove duplicates
    }
  
    calculateStringSimilarity(str1, str2) {
      if (!str1 || !str2) return 0
  
      const longer = str1.length > str2.length ? str1 : str2
      const shorter = str1.length > str2.length ? str2 : str1
  
      if (longer.length === 0) return 1.0
  
      const editDistance = this.levenshteinDistance(longer, shorter)
      return (longer.length - editDistance) / longer.length
    }
  
    levenshteinDistance(str1, str2) {
      const matrix = []
  
      for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i]
      }
  
      for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j
      }
  
      for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
          if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
            matrix[i][j] = matrix[i - 1][j - 1]
          } else {
            matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
          }
        }
      }
  
      return matrix[str2.length][str1.length]
    }
  
    extractPaymentToken(requestBody) {
      try {
        const body = typeof requestBody === "string" ? JSON.parse(requestBody) : requestBody
        return body?.paymentToken || body?.token || body?.paymentMethodId
      } catch (e) {
        return null
      }
    }
  
    determineCorrelationType(networkCall, salesforceLog) {
      const url = networkCall.url.toLowerCase()
      const hasErrors = networkCall.status >= 400 || salesforceLog.parsed?.errors?.length > 0
  
      if (hasErrors) return "error"
      if (url.includes("payment")) return "payment"
      if (url.includes("checkout")) return "checkout"
      if (url.includes("inventory")) return "inventory"
      if (url.includes("shipping") || url.includes("delivery")) return "shipping"
      if (url.includes("tax")) return "tax"
      return "general"
    }
  
    generateReasoning(networkCall, salesforceLog, factors) {
      const reasons = []
  
      const timeDiff = Math.abs(new Date(networkCall.timestamp) - new Date(salesforceLog.StartTime))
  
      reasons.push(`Occurred ${Math.round(timeDiff / 1000)}s apart`)
  
      if (factors.some((f) => f.includes("id:"))) {
        reasons.push("Matching IDs found")
      }
  
      if (factors.some((f) => f.includes("error:"))) {
        reasons.push("Both contain errors")
      }
  
      if (factors.some((f) => f.includes("operation:"))) {
        reasons.push("Similar operations detected")
      }
  
      return reasons.join(", ")
    }
  
    // Method to get correlations for a specific network call
    getCorrelationsForCall(networkCall, allCorrelations) {
      return allCorrelations.filter((corr) => corr.networkCall.id === networkCall.id)
    }
  
    // Method to get correlations for a specific Salesforce log
    getCorrelationsForLog(salesforceLog, allCorrelations) {
      return allCorrelations.filter((corr) => corr.salesforceLog.Id === salesforceLog.Id)
    }
  
    // Export correlations for analysis
    exportCorrelations(correlations) {
      const exportData = {
        timestamp: new Date().toISOString(),
        totalCorrelations: correlations.length,
        confidenceThreshold: this.confidenceThreshold,
        timeWindow: this.timeWindow,
        correlations: correlations.map((corr) => ({
          confidence: corr.confidence,
          type: corr.type,
          reasoning: corr.reasoning,
          timeDifference: corr.timeDifference,
          networkCall: {
            url: corr.networkCall.url,
            method: corr.networkCall.method,
            status: corr.networkCall.status,
            timestamp: corr.networkCall.timestamp,
          },
          salesforceLog: {
            id: corr.salesforceLog.Id,
            operation: corr.salesforceLog.Operation,
            startTime: corr.salesforceLog.StartTime,
            duration: corr.salesforceLog.DurationMilliseconds,
          },
        })),
      }
  
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `sfcc-correlations-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
    }
  }
  
  // Export for use in other scripts
  window.CorrelationEngine = CorrelationEngine
  