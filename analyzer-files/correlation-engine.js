// Correlation engine for matching network calls with Salesforce logs
;(() => {

  class CorrelationEngine {
    constructor() {
      this.correlationRules = new Map()
      this.initializeDefaultRules()
    }

    initializeDefaultRules() {
      // Rule: Payment correlation
      this.addRule("payment", {
        networkPatterns: [/payment/i, /billing/i],
        logPatterns: [/payment/i, /billing/i, /creditcard/i],
        timeWindow: 30000, // 30 seconds
        weight: 10,
        extractors: {
          paymentToken: (call) => call.requestBody?.paymentToken,
          orderId: (call) => call.response?.orderId,
        },
      })

      // Rule: Delivery method correlation
      this.addRule("delivery", {
        networkPatterns: [/delivery/i, /shipping/i],
        logPatterns: [/delivery/i, /shipping/i, /freight/i],
        timeWindow: 20000, // 20 seconds
        weight: 8,
        extractors: {
          deliveryId: (call) => call.requestBody?.deliveryMethodId,
          shippingAddress: (call) => call.response?.deliveryAddress,
        },
      })

      // Rule: Cart/inventory correlation
      this.addRule("cart", {
        networkPatterns: [/cart/i, /inventory/i, /product/i],
        logPatterns: [/cart/i, /inventory/i, /product/i, /stock/i],
        timeWindow: 15000, // 15 seconds
        weight: 6,
        extractors: {
          productId: (call) => call.requestBody?.productId,
          cartId: (call) => call.response?.cartId,
        },
      })

      // Rule: Address correlation
      this.addRule("address", {
        networkPatterns: [/address/i, /location/i],
        logPatterns: [/address/i, /location/i, /geocode/i],
        timeWindow: 25000, // 25 seconds
        weight: 7,
        extractors: {
          addressId: (call) => call.response?.addressId,
          zipCode: (call) => call.requestBody?.postalCode,
        },
      })

      // Rule: Tax calculation correlation
      this.addRule("tax", {
        networkPatterns: [/tax/i, /calculate/i],
        logPatterns: [/tax/i, /calculate/i, /rate/i],
        timeWindow: 10000, // 10 seconds
        weight: 9,
        extractors: {
          taxAmount: (call) => call.response?.totalTaxAmount,
          jurisdiction: (call) => call.response?.taxJurisdiction,
        },
      })
    }

    addRule(name, config) {
      this.correlationRules.set(name, {
        name,
        networkPatterns: config.networkPatterns || [],
        logPatterns: config.logPatterns || [],
        timeWindow: config.timeWindow || 30000,
        weight: config.weight || 5,
        extractors: config.extractors || {},
        validators: config.validators || [],
      })
    }

    correlateAll(networkCalls, salesforceLogs) {
      const correlations = []

      networkCalls.forEach((networkCall) => {
        const matches = this.findMatches(networkCall, salesforceLogs)
        correlations.push(...matches)
      })

      // Sort by confidence score (highest first)
      return correlations.sort((a, b) => b.confidence - a.confidence)
    }

    correlateNetworkCallWithLogs(networkCall, salesforceLogs) {
      return this.findMatches(networkCall, salesforceLogs)
    }

    correlateAllData(networkCalls, salesforceLogs) {
      return this.correlateAll(networkCalls, salesforceLogs)
    }

    findMatches(networkCall, salesforceLogs) {
      const matches = []

      for (const [ruleName, rule] of this.correlationRules) {
        // Check if network call matches rule patterns
        if (!this.matchesNetworkPatterns(networkCall, rule.networkPatterns)) {
          continue
        }

        // Find matching Salesforce logs within time window
        const candidateLogs = salesforceLogs.filter((log) => {
          const logTime = new Date(log.StartTime).getTime()
          const callTime = networkCall.timestamp
          const timeDiff = Math.abs(logTime - callTime)

          return timeDiff <= rule.timeWindow && this.matchesLogPatterns(log, rule.logPatterns)
        })

        // Score each candidate
        candidateLogs.forEach((log) => {
          const correlation = this.scoreCorrelation(networkCall, log, rule)
          if (correlation.confidence > 0.3) {
            // Minimum confidence threshold
            matches.push(correlation)
          }
        })
      }

      return matches
    }

    matchesNetworkPatterns(networkCall, patterns) {
      const searchText = `${networkCall.url} ${JSON.stringify(networkCall.requestBody || {})} ${JSON.stringify(networkCall.response || {})}`
      return patterns.some((pattern) => pattern.test(searchText))
    }

    matchesLogPatterns(log, patterns) {
      const searchText = `${log.body || ""} ${log.parsed?.apexClass || ""} ${JSON.stringify(log.parsed || {})}`
      return patterns.some((pattern) => pattern.test(searchText))
    }

    scoreCorrelation(networkCall, salesforceLog, rule) {
      let score = 0
      let maxScore = 0
      const factors = []

      // Base score from rule weight
      score += rule.weight
      maxScore += rule.weight
      factors.push(`rule_weight(${rule.weight})`)

      // Time proximity scoring
      const logTime = new Date(salesforceLog.StartTime).getTime()
      const callTime = networkCall.timestamp
      const timeDiff = Math.abs(logTime - callTime)
      const timeScore = Math.max(0, 10 - timeDiff / 1000) // 10 points for immediate, 0 for 10+ seconds
      score += timeScore
      maxScore += 10
      factors.push(`time_proximity(${timeScore.toFixed(1)})`)

      // Pattern matching scoring
      const networkText = `${networkCall.url} ${JSON.stringify(networkCall.requestBody || {})}`.toLowerCase()
      const logText = `${salesforceLog.body || ""} ${JSON.stringify(salesforceLog.parsed || {})}`.toLowerCase()

      let patternScore = 0
      rule.networkPatterns.forEach((pattern) => {
        if (pattern.test(networkText)) patternScore += 2
      })
      rule.logPatterns.forEach((pattern) => {
        if (pattern.test(logText)) patternScore += 2
      })

      score += patternScore
      maxScore += (rule.networkPatterns.length + rule.logPatterns.length) * 2
      factors.push(`pattern_match(${patternScore})`)

      // Data correlation scoring
      let dataScore = 0
      for (const [key, extractor] of Object.entries(rule.extractors)) {
        try {
          const extractedValue = extractor(networkCall)
          if (extractedValue && logText.includes(extractedValue.toString().toLowerCase())) {
            dataScore += 5
            factors.push(`data_match_${key}(5)`)
          }
        } catch (e) {
          // Ignore extraction errors
        }
      }
      score += dataScore
      maxScore += Object.keys(rule.extractors).length * 5

      // HTTP status correlation
      if (networkCall.status >= 400 && salesforceLog.parsed?.errors?.length > 0) {
        score += 3
        factors.push("error_correlation(3)")
      }
      maxScore += 3

      // User correlation (if available)
      if (salesforceLog.parsed?.userInfo && networkCall.response?.user) {
        const logUser = salesforceLog.parsed.userInfo.toLowerCase()
        const callUser = networkCall.response.user.toLowerCase()
        if (logUser.includes(callUser) || callUser.includes(logUser)) {
          score += 4
          factors.push("user_correlation(4)")
        }
      }
      maxScore += 4

      const confidence = maxScore > 0 ? score / maxScore : 0

      return {
        networkCall,
        salesforceLog,
        type: rule.name,
        confidence,
        score,
        maxScore,
        timeDifference: timeDiff,
        factors,
        reasoning: this.generateReasoning(rule.name, confidence, factors),
      }
    }

    generateReasoning(ruleName, confidence, factors) {
      const confidenceLevel = confidence > 0.8 ? "High" : confidence > 0.6 ? "Medium" : "Low"
      const topFactors = factors.slice(0, 3).join(", ")

      return `${confidenceLevel} confidence ${ruleName} correlation based on ${topFactors}`
    }

    // Utility methods for analysis
    getCorrelationStats(correlations) {
      const stats = {
        total: correlations.length,
        byType: {},
        byConfidence: {
          high: 0,
          medium: 0,
          low: 0,
        },
      }

      correlations.forEach((corr) => {
        // Count by type
        if (!stats.byType[corr.type]) {
          stats.byType[corr.type] = 0
        }
        stats.byType[corr.type]++

        // Count by confidence
        if (corr.confidence > 0.8) {
          stats.byConfidence.high++
        } else if (corr.confidence > 0.6) {
          stats.byConfidence.medium++
        } else {
          stats.byConfidence.low++
        }
      })

      return stats
    }

    exportCorrelations(correlations) {
      return {
        correlations: correlations.map((corr) => ({
          networkCall: {
            url: corr.networkCall.url,
            method: corr.networkCall.method,
            status: corr.networkCall.status,
            timestamp: corr.networkCall.timestamp,
          },
          salesforceLog: {
            id: corr.salesforceLog.Id,
            startTime: corr.salesforceLog.StartTime,
            operation: corr.salesforceLog.Operation,
            apexClass: corr.salesforceLog.parsed?.apexClass,
          },
          correlation: {
            type: corr.type,
            confidence: corr.confidence,
            reasoning: corr.reasoning,
            factors: corr.factors,
          },
        })),
        stats: this.getCorrelationStats(correlations),
        exportTime: new Date().toISOString(),
      }
    }
  }

  // Export for use in content script
  window.CorrelationEngine = CorrelationEngine

  // Dispatch a custom event to signal the class is ready
  window.dispatchEvent(
    new CustomEvent("CorrelationEngineReady", {
      detail: { CorrelationEngine },
    }),
  )
})()
