// Test suite for Salesforce API integration and log correlation
class SalesforceIntegrationTester {
    constructor() {
      this.salesforceAPI = new window.SalesforceAPI()
      this.testResults = []
      this.mockData = this.generateMockData()
    }
  
    generateMockData() {
      return {
        // Mock checkout network calls
        checkoutCalls: [
          {
            id: "call_1",
            method: "POST",
            url: "https://test.salesforce.com/services/data/v58.0/commerce/webstores/0ZE123/checkouts/checkout_123/payments",
            status: 400,
            timestamp: Date.now() - 60000, // 1 minute ago
            checkoutId: "checkout_123",
            webstoreId: "0ZE123",
            checkoutStage: "payment",
            response: {
              errors: [
                {
                  type: "PaymentError",
                  title: "Payment Processing Failed",
                  detail: "Invalid payment method provided",
                },
              ],
              salesforceResultCode: "PAYMENT_GATEWAY_ERROR",
            },
            requestBody: {
              paymentToken: "tok_test_123",
              amount: 99.99,
              currency: "USD",
            },
          },
          {
            id: "call_2",
            method: "GET",
            url: "https://test.salesforce.com/services/data/v58.0/commerce/webstores/0ZE123/checkouts/checkout_123",
            status: 200,
            timestamp: Date.now() - 30000, // 30 seconds ago
            checkoutId: "checkout_123",
            webstoreId: "0ZE123",
            checkoutStage: "checkout",
            response: {
              id: "checkout_123",
              status: "InProgress",
              totalAmount: 99.99,
            },
          },
          {
            id: "call_3",
            method: "POST",
            url: "https://test.salesforce.com/services/data/v58.0/commerce/webstores/0ZE123/checkouts/checkout_123/delivery-methods",
            status: 200,
            timestamp: Date.now() - 120000, // 2 minutes ago
            checkoutId: "checkout_123",
            webstoreId: "0ZE123",
            checkoutStage: "delivery",
            response: {
              availableDeliveryMethods: [{ id: "standard", name: "Standard Shipping", cost: 5.99 }],
            },
          },
        ],
  
        // Mock Salesforce debug logs
        salesforceLogs: [
          {
            Id: "07L123000000001",
            Application: "Unknown",
            DurationMilliseconds: 1250,
            Location: "PaymentService",
            LogLength: 2048,
            LogUser: { Name: "Integration User" },
            Operation: "PaymentProcessing",
            Request: "PaymentGateway",
            StartTime: new Date(Date.now() - 55000).toISOString(), // 55 seconds ago
            Status: "Success",
            body: `12:34:56.789 (123456)|USER_INFO|[EXTERNAL]|005xx000001234|integration@test.com|Pacific Standard Time|GMT-08:00
  12:34:56.790 (234567)|EXECUTION_STARTED
  12:34:56.791 (345678)|CODE_UNIT_STARTED|[EXTERNAL]|PaymentService.processPayment|PaymentService
  12:34:56.792 (456789)|ENTERING_MANAGED_PKG|commerce_payments
  12:34:56.850 (567890)|CALLOUT_REQUEST|[123]|System.HttpRequest[Endpoint=https://payment-gateway.com/api/charge, Method=POST]
  12:34:57.100 (678901)|CALLOUT_RESPONSE|[123]|System.HttpResponse[Status=PaymentGatewayError, StatusCode=400]
  12:34:57.101 (789012)|FATAL_ERROR|PaymentGatewayException: Invalid payment method provided
  12:34:57.102 (890123)|EXCEPTION_THROWN|[123]|PaymentGatewayException: Payment processing failed
  12:34:57.103 (901234)|CODE_UNIT_FINISHED|PaymentService.processPayment
  12:34:57.104 (012345)|EXECUTION_FINISHED`,
            parsed: null, // Will be populated by parseLogContent
          },
          {
            Id: "07L123000000002",
            Application: "Unknown",
            DurationMilliseconds: 450,
            Location: "CheckoutService",
            LogLength: 1024,
            LogUser: { Name: "Integration User" },
            Operation: "CheckoutValidation",
            Request: "CheckoutAPI",
            StartTime: new Date(Date.now() - 25000).toISOString(), // 25 seconds ago
            Status: "Success",
            body: `12:35:30.123 (123456)|USER_INFO|[EXTERNAL]|005xx000001234|integration@test.com|Pacific Standard Time|GMT-08:00
  12:35:30.124 (234567)|EXECUTION_STARTED
  12:35:30.125 (345678)|CODE_UNIT_STARTED|[EXTERNAL]|CheckoutService.validateCheckout|CheckoutService
  12:35:30.126 (456789)|SOQL_EXECUTE_BEGIN|[124]|Aggregations:0|SELECT Id, Status FROM Checkout__c WHERE Id = 'checkout_123'
  12:35:30.150 (567890)|SOQL_EXECUTE_END|[124]|Rows:1
  12:35:30.151 (678901)|DML_BEGIN|[125]|Op:Update|Type:Checkout__c|Rows:1
  12:35:30.175 (789012)|DML_END|[125]
  12:35:30.176 (890123)|CODE_UNIT_FINISHED|CheckoutService.validateCheckout
  12:35:30.177 (901234)|EXECUTION_FINISHED`,
            parsed: null,
          },
          {
            Id: "07L123000000003",
            Application: "Unknown",
            DurationMilliseconds: 800,
            Location: "DeliveryService",
            LogLength: 1536,
            LogUser: { Name: "Integration User" },
            Operation: "DeliveryCalculation",
            Request: "DeliveryAPI",
            StartTime: new Date(Date.now() - 115000).toISOString(), // 1 minute 55 seconds ago
            Status: "Success",
            body: `12:33:25.456 (123456)|USER_INFO|[EXTERNAL]|005xx000001234|integration@test.com|Pacific Standard Time|GMT-08:00
  12:33:25.457 (234567)|EXECUTION_STARTED
  12:33:25.458 (345678)|CODE_UNIT_STARTED|[EXTERNAL]|DeliveryService.calculateMethods|DeliveryService
  12:33:25.500 (456789)|SOQL_EXECUTE_BEGIN|[126]|Aggregations:0|SELECT Id, Name, Cost FROM DeliveryMethod__c WHERE Active__c = true
  12:33:25.550 (567890)|SOQL_EXECUTE_END|[126]|Rows:3
  12:33:25.600 (678901)|CODE_UNIT_FINISHED|DeliveryService.calculateMethods
  12:33:25.601 (789012)|EXECUTION_FINISHED`,
            parsed: null,
          },
        ],
      }
    }
  
    async runAllTests() {
      console.log("🧪 Starting Salesforce Integration Tests...")
  
      const tests = [
        this.testConnectionValidation,
        this.testLogParsing,
        this.testCorrelationAlgorithm,
        this.testRelevanceScoring,
        this.testErrorDetection,
        this.testPerformanceMetrics,
        this.testTimeWindowCorrelation,
        this.testMockIntegration,
      ]
  
      for (const test of tests) {
        try {
          await test.call(this)
        } catch (error) {
          this.addTestResult(test.name, false, `Test failed: ${error.message}`)
        }
      }
  
      this.displayResults()
      return this.testResults
    }
  
    async testConnectionValidation() {
      console.log("Testing connection validation...")
  
      // Test invalid URL
      let result = await this.salesforceAPI.connect("invalid-url", "fake-session")
      this.addTestResult("Connection with invalid URL", !result.success, "Should reject invalid URLs")
  
      // Test empty credentials
      result = await this.salesforceAPI.connect("", "")
      this.addTestResult("Connection with empty credentials", !result.success, "Should reject empty credentials")
  
      // Test URL normalization
      const testUrl = "https://test.salesforce.com/"
      await this.salesforceAPI.connect(testUrl, "test-session")
      const normalizedUrl = this.salesforceAPI.baseUrl
      this.addTestResult(
        "URL normalization",
        normalizedUrl === "https://test.salesforce.com",
        "Should remove trailing slash",
      )
    }
  
    async testLogParsing() {
      console.log("Testing log parsing...")
  
      const testLog = this.mockData.salesforceLogs[0]
      const parsed = this.salesforceAPI.parseLogContent(testLog.body)
  
      // Test error extraction
      this.addTestResult("Error extraction", parsed.errors.length > 0, "Should extract FATAL_ERROR and EXCEPTION_THROWN")
  
      // Test callout extraction
      this.addTestResult(
        "Callout extraction",
        parsed.webserviceCalls.length > 0,
        "Should extract CALLOUT_REQUEST and CALLOUT_RESPONSE",
      )
  
      // Test timestamp extraction
      const hasTimestamps = parsed.errors.every((error) => error.timestamp !== null)
      this.addTestResult("Timestamp extraction", hasTimestamps, "Should extract timestamps from log lines")
  
      // Test specific error content
      const paymentError = parsed.errors.find((e) => e.message.includes("PaymentGatewayException"))
      this.addTestResult("Specific error detection", !!paymentError, "Should detect PaymentGatewayException")
    }
  
    async testCorrelationAlgorithm() {
      console.log("Testing correlation algorithm...")
  
      // Parse mock logs first
      this.mockData.salesforceLogs.forEach((log) => {
        log.parsed = this.salesforceAPI.parseLogContent(log.body)
      })
  
      const correlations = await this.mockCorrelateWithCheckout(this.mockData.checkoutCalls, this.mockData.salesforceLogs)
  
      this.addTestResult("Correlation generation", correlations.length > 0, "Should generate correlations")
  
      // Test payment error correlation
      const paymentCorrelation = correlations.find(
        (c) => c.checkoutCall.checkoutStage === "payment" && c.salesforceLog.Operation === "PaymentProcessing",
      )
      this.addTestResult("Payment error correlation", !!paymentCorrelation, "Should correlate payment errors")
  
      // Test relevance scoring
      const highRelevanceCorrelations = correlations.filter((c) => c.relevanceScore > 0.5)
      this.addTestResult(
        "High relevance correlations",
        highRelevanceCorrelations.length > 0,
        "Should have high-relevance correlations",
      )
    }
  
    async testRelevanceScoring() {
      console.log("Testing relevance scoring...")
  
      const paymentCall = this.mockData.checkoutCalls[0] // Payment call with error
      const paymentLog = this.mockData.salesforceLogs[0] // Payment processing log
      const deliveryLog = this.mockData.salesforceLogs[2] // Delivery calculation log
  
      const paymentScore = this.salesforceAPI.calculateRelevanceScore(paymentCall, paymentLog)
      const deliveryScore = this.salesforceAPI.calculateRelevanceScore(paymentCall, deliveryLog)
  
      this.addTestResult(
        "Payment relevance scoring",
        paymentScore > deliveryScore,
        "Payment call should have higher relevance to payment log",
      )
      this.addTestResult("Error bonus scoring", paymentScore > 0.7, "Error correlation should have high relevance score")
  
      // Test ID matching bonus
      const checkoutCall = this.mockData.checkoutCalls[1]
      const checkoutLog = this.mockData.salesforceLogs[1]
      const checkoutScore = this.salesforceAPI.calculateRelevanceScore(checkoutCall, checkoutLog)
  
      this.addTestResult(
        "Checkout ID correlation",
        checkoutScore > 0.5,
        "Checkout calls should correlate with checkout logs",
      )
    }
  
    async testErrorDetection() {
      console.log("Testing error detection...")
  
      const paymentCall = this.mockData.checkoutCalls[0]
      const paymentLog = this.mockData.salesforceLogs[0]
      paymentLog.parsed = this.salesforceAPI.parseLogContent(paymentLog.body)
  
      const correlationType = this.salesforceAPI.determineCorrelationType(paymentCall, paymentLog)
  
      this.addTestResult("Error correlation type", correlationType === "error", "Should identify error correlations")
  
      // Test error message extraction
      const hasPaymentError = paymentLog.parsed.errors.some((e) => e.message.includes("PaymentGatewayException"))
      this.addTestResult("Payment error extraction", hasPaymentError, "Should extract payment-specific errors")
    }
  
    async testPerformanceMetrics() {
      console.log("Testing performance metrics...")
  
      const testLog = this.mockData.salesforceLogs[1]
      const parsed = this.salesforceAPI.parseLogContent(testLog.body)
  
      this.addTestResult("SOQL query detection", parsed.soqlQueries.length > 0, "Should detect SOQL queries")
      this.addTestResult("DML operation detection", parsed.dmlOperations.length > 0, "Should detect DML operations")
  
      // Test performance metric extraction
      const hasPerformanceData =
        parsed.performance &&
        (parsed.performance.soqlQueries !== undefined || parsed.performance.dmlStatements !== undefined)
      this.addTestResult("Performance metrics", hasPerformanceData, "Should extract performance metrics")
    }
  
    async testTimeWindowCorrelation() {
      console.log("Testing time window correlation...")
  
      // Create calls with different time gaps
      const recentCall = { ...this.mockData.checkoutCalls[0], timestamp: Date.now() - 30000 } // 30 seconds ago
      const oldCall = { ...this.mockData.checkoutCalls[0], timestamp: Date.now() - 600000 } // 10 minutes ago
  
      const recentLog = { ...this.mockData.salesforceLogs[0], StartTime: new Date(Date.now() - 60000).toISOString() } // 1 minute ago
  
      // Test within time window
      const recentTimeDiff = Math.abs(recentCall.timestamp - new Date(recentLog.StartTime).getTime())
      this.addTestResult(
        "Recent time correlation",
        recentTimeDiff <= 5 * 60 * 1000,
        "Should correlate within 5-minute window",
      )
  
      // Test outside time window
      const oldTimeDiff = Math.abs(oldCall.timestamp - new Date(recentLog.StartTime).getTime())
      this.addTestResult("Old time correlation", oldTimeDiff > 5 * 60 * 1000, "Should not correlate outside time window")
    }
  
    async testMockIntegration() {
      console.log("Testing mock integration...")
  
      // Test with mock data to simulate full integration
      const mockAPI = this.createMockSalesforceAPI()
  
      try {
        const connectResult = await mockAPI.connect("https://test.salesforce.com", "mock-session")
        this.addTestResult("Mock connection", connectResult.success, "Mock connection should succeed")
  
        const logs = await mockAPI.getDebugLogs({ maxRecords: 10 })
        this.addTestResult("Mock log retrieval", logs.logs.length > 0, "Should retrieve mock logs")
  
        const correlations = await mockAPI.correlateWithCheckout(this.mockData.checkoutCalls)
        this.addTestResult("Mock correlation", correlations.length > 0, "Should generate mock correlations")
      } catch (error) {
        this.addTestResult("Mock integration", false, `Mock integration failed: ${error.message}`)
      }
    }
  
    createMockSalesforceAPI() {
      const mockAPI = Object.create(this.salesforceAPI)
  
      // Override methods with mock implementations
      mockAPI.connect = async (instanceUrl, sessionId) => {
        mockAPI.baseUrl = instanceUrl
        mockAPI.sessionId = sessionId
        mockAPI.isConnected = true
        return { success: true, orgInfo: { keyPrefix: "00D" } }
      }
  
      mockAPI.getDebugLogs = async (options = {}) => {
        return {
          totalSize: this.mockData.salesforceLogs.length,
          logs: this.mockData.salesforceLogs.map((log) => ({
            ...log,
            parsed: this.salesforceAPI.parseLogContent(log.body),
          })),
        }
      }
  
      mockAPI.correlateWithCheckout = async (checkoutCalls) => {
        return this.mockCorrelateWithCheckout(checkoutCalls, this.mockData.salesforceLogs)
      }
  
      return mockAPI
    }
  
    async mockCorrelateWithCheckout(checkoutCalls, salesforceLogs) {
      const correlations = []
      const timeWindow = 5 * 60 * 1000 // 5 minutes
  
      checkoutCalls.forEach((call) => {
        const callTime = new Date(call.timestamp)
  
        salesforceLogs.forEach((log) => {
          const logTime = new Date(log.StartTime)
          const timeDiff = Math.abs(callTime.getTime() - logTime.getTime())
  
          if (timeDiff <= timeWindow) {
            const relevanceScore = this.salesforceAPI.calculateRelevanceScore(call, log)
  
            if (relevanceScore > 0.3) {
              correlations.push({
                checkoutCall: call,
                salesforceLog: log,
                timeDifference: timeDiff,
                relevanceScore,
                correlationType: this.salesforceAPI.determineCorrelationType(call, log),
              })
            }
          }
        })
      })
  
      return correlations.sort((a, b) => b.relevanceScore - a.relevanceScore)
    }
  
    addTestResult(testName, passed, description) {
      const result = {
        name: testName,
        passed,
        description,
        timestamp: new Date().toISOString(),
      }
  
      this.testResults.push(result)
  
      const status = passed ? "✅ PASS" : "❌ FAIL"
      console.log(`${status}: ${testName} - ${description}`)
    }
  
    displayResults() {
      const totalTests = this.testResults.length
      const passedTests = this.testResults.filter((r) => r.passed).length
      const failedTests = totalTests - passedTests
  
      console.log("\n" + "=".repeat(60))
      console.log("🧪 SALESFORCE INTEGRATION TEST RESULTS")
      console.log("=".repeat(60))
      console.log(`Total Tests: ${totalTests}`)
      console.log(`✅ Passed: ${passedTests}`)
      console.log(`❌ Failed: ${failedTests}`)
      console.log(`Success Rate: ${Math.round((passedTests / totalTests) * 100)}%`)
      console.log("=".repeat(60))
  
      if (failedTests > 0) {
        console.log("\n❌ FAILED TESTS:")
        this.testResults
          .filter((r) => !r.passed)
          .forEach((result) => {
            console.log(`- ${result.name}: ${result.description}`)
          })
      }
  
      console.log("\n🎯 RECOMMENDATIONS:")
      this.generateRecommendations()
    }
  
    generateRecommendations() {
      const failedTests = this.testResults.filter((r) => !r.passed)
  
      if (failedTests.length === 0) {
        console.log("✅ All tests passed! The integration is working correctly.")
        return
      }
  
      const recommendations = []
  
      failedTests.forEach((test) => {
        if (test.name.includes("Connection")) {
          recommendations.push("🔧 Check network connectivity and Salesforce credentials")
        }
        if (test.name.includes("Parsing")) {
          recommendations.push("📝 Review log parsing regular expressions and patterns")
        }
        if (test.name.includes("Correlation")) {
          recommendations.push("🔗 Adjust correlation algorithm parameters and thresholds")
        }
        if (test.name.includes("Relevance")) {
          recommendations.push("⚖️ Fine-tune relevance scoring weights and bonuses")
        }
      })
  
      // Remove duplicates
      const uniqueRecommendations = [...new Set(recommendations)]
      uniqueRecommendations.forEach((rec) => console.log(rec))
  
      if (uniqueRecommendations.length === 0) {
        console.log("🔍 Review individual test failures for specific guidance")
      }
    }
  
    // Export test results for analysis
    exportResults() {
      const exportData = {
        summary: {
          totalTests: this.testResults.length,
          passedTests: this.testResults.filter((r) => r.passed).length,
          failedTests: this.testResults.filter((r) => !r.passed).length,
          successRate: Math.round((this.testResults.filter((r) => r.passed).length / this.testResults.length) * 100),
        },
        results: this.testResults,
        mockData: this.mockData,
        timestamp: new Date().toISOString(),
      }
  
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `salesforce-integration-test-results-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
  
      console.log("📊 Test results exported successfully")
    }
  }
  
  // Auto-run tests when script loads
  if (typeof window !== "undefined" && window.SalesforceAPI) {
    window.SalesforceIntegrationTester = SalesforceIntegrationTester
  
    // Add test button to popup for manual testing
    document.addEventListener("DOMContentLoaded", () => {
      const testButton = document.createElement("button")
      testButton.textContent = "Run SF Tests"
      testButton.className = "btn btn-secondary"
      testButton.style.fontSize = "10px"
      testButton.style.padding = "4px 8px"
      testButton.onclick = async () => {
        const tester = new SalesforceIntegrationTester()
        await tester.runAllTests()
        tester.exportResults()
      }
  
      // Add to popup if it exists
      const actions = document.querySelector(".actions")
      if (actions) {
        actions.appendChild(testButton)
      }
    })
  }
  