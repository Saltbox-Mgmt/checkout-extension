// Commerce on Core specific error analysis
class CommerceOnCoreAnalyzer {
  constructor() {
    this.errorPatterns = {
      payment: {
        SystemError: {
          title: "Payment System Error",
          description: "Generic system error - check payment gateway configuration and logs",
          troubleshooting: [
            "Verify payment gateway is properly configured",
            "Check Salesforce debug logs for detailed error messages",
            "Validate payment token is not expired",
            "Ensure billing address matches payment method requirements",
          ],
        },
        InvalidPaymentMethod: {
          title: "Invalid Payment Method",
          description: "The payment method provided is not valid or supported",
          troubleshooting: [
            "Verify payment method is enabled in webstore settings",
            "Check if payment method supports the transaction amount",
            "Validate payment token format and expiration",
          ],
        },
        InsufficientFunds: {
          title: "Insufficient Funds",
          description: "The payment method does not have sufficient funds",
          troubleshooting: [
            "Customer needs to use different payment method",
            "Verify transaction amount is correct",
            "Check for any holds on the payment method",
          ],
        },
      },
      address: {
        InvalidAddress: {
          title: "Address Validation Failed",
          description: "The provided address could not be validated",
          troubleshooting: [
            "Check address validation service configuration",
            "Verify all required address fields are provided",
            "Ensure postal code format matches country requirements",
          ],
        },
      },
      inventory: {
        InsufficientInventory: {
          title: "Insufficient Inventory",
          description: "Not enough inventory available for the requested quantity",
          troubleshooting: [
            "Check product inventory levels",
            "Verify inventory allocation rules",
            "Consider implementing backorder functionality",
          ],
        },
      },
    }
  }

  analyzeError(networkCall) {
    const analysis = {
      category: this.determineErrorCategory(networkCall),
      severity: this.determineSeverity(networkCall),
      suggestions: [],
      relatedCalls: [],
      debugInfo: {},
    }

    if (networkCall.response?.errors) {
      networkCall.response.errors.forEach((error) => {
        const pattern = this.findErrorPattern(error, analysis.category)
        if (pattern) {
          analysis.suggestions.push(...pattern.troubleshooting)
          analysis.debugInfo.pattern = pattern
        }
      })
    }

    // Add Commerce on Core specific debug info
    if (networkCall.salesforceResultCode) {
      analysis.debugInfo.salesforceResultCode = networkCall.salesforceResultCode
    }

    if (networkCall.webstoreId) {
      analysis.debugInfo.webstoreId = networkCall.webstoreId
    }

    if (networkCall.checkoutId) {
      analysis.debugInfo.checkoutId = networkCall.checkoutId
    }

    return analysis
  }

  determineErrorCategory(networkCall) {
    const url = networkCall.url.toLowerCase()

    if (url.includes("/payments")) return "payment"
    if (url.includes("/shipping-address") || url.includes("/billing-address")) return "address"
    if (url.includes("/inventory") || url.includes("/cart-items")) return "inventory"
    if (url.includes("/taxes")) return "tax"
    if (url.includes("/delivery-methods")) return "shipping"

    return "general"
  }

  determineSeverity(networkCall) {
    if (networkCall.status >= 500) return "critical"
    if (networkCall.status >= 400) return "error"
    if (networkCall.response?.errors?.length > 0) return "warning"
    return "info"
  }

  findErrorPattern(error, category) {
    const patterns = this.errorPatterns[category]
    if (!patterns) return null

    // Try to match by error type or title
    for (const [key, pattern] of Object.entries(patterns)) {
      if (error.type?.includes(key.toLowerCase()) || error.title?.includes(key) || error.detail?.includes(key)) {
        return pattern
      }
    }

    return null
  }

  generateDebugReport(networkCalls) {
    const report = {
      summary: {
        totalCalls: networkCalls.length,
        errorCalls: networkCalls.filter((call) => call.status >= 400).length,
        checkoutStages: [...new Set(networkCalls.map((call) => call.checkoutStage).filter(Boolean))],
        webstores: [...new Set(networkCalls.map((call) => call.webstoreId).filter(Boolean))],
        checkoutSessions: [...new Set(networkCalls.map((call) => call.checkoutId).filter(Boolean))],
      },
      errors: [],
      recommendations: [],
    }

    // Analyze each error call
    networkCalls
      .filter((call) => call.status >= 400 || call.response?.errors)
      .forEach((call) => {
        const analysis = this.analyzeError(call)
        report.errors.push({
          call,
          analysis,
        })
      })

    // Generate overall recommendations
    report.recommendations = this.generateRecommendations(report.errors)

    return report
  }

  generateRecommendations(errors) {
    const recommendations = []
    const errorTypes = {}

    // Count error types
    errors.forEach(({ analysis }) => {
      const category = analysis.category
      errorTypes[category] = (errorTypes[category] || 0) + 1
    })

    // Generate recommendations based on error patterns
    Object.entries(errorTypes).forEach(([category, count]) => {
      if (count > 1) {
        recommendations.push({
          priority: "high",
          category,
          message: `Multiple ${category} errors detected (${count}). Consider reviewing ${category} configuration.`,
        })
      }
    })

    return recommendations
  }
}

// Export for use in panel
window.CommerceOnCoreAnalyzer = CommerceOnCoreAnalyzer
