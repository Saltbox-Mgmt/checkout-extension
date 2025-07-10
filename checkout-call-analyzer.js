// Enhanced checkout call analyzer with flexible configuration
;(() => {
  console.log("🔧 Loading CheckoutCallAnalyzer...")

  class CheckoutCallAnalyzer {
    constructor() {
      this.callTypes = new Map()
      this.initializeDefaultTypes()
      console.log("✅ CheckoutCallAnalyzer initialized with", this.callTypes.size, "call types")
    }

    // Replace the initializeDefaultTypes method with this enhanced version
    initializeDefaultTypes() {
      // Payment calls
      this.addCallType("payment", {
        urlPatterns: ["/payments", "/payment"],
        methods: ["POST", "PUT", "PATCH"],
        stage: "payment",
        payloadMatchers: [
          (call) => this.hasPayloadKeys(call, ["paymentToken", "paymentMethodId", "creditCard", "paymentInstrument"]),
          (call) => this.hasResponseKeys(call, ["paymentMethods", "paymentResult", "paymentStatus"]),
        ],
        extractors: {
          paymentToken: (call) => this.extractPaymentToken(call.requestBody),
          paymentErrors: (call) => call.response?.errors,
          salesforceResultCode: (call) => call.response?.salesforceResultCode,
          paymentMethodId: (call) => call.response?.paymentMethodId,
        },
        validators: {
          isSuccessful: (call) => call.status < 400 && !call.response?.errors,
        },
        priority: 10,
      })

      // Delivery method calls - enhanced with payload detection
      this.addCallType("deliveryMethod", {
        urlPatterns: ["/delivery-methods", "/delivery-groups", "/shipping-methods", "/checkouts/"],
        methods: ["GET", "POST", "PUT", "PATCH"],
        stage: "delivery",
        payloadMatchers: [
          (call) => this.hasPayloadKeys(call, ["deliveryMethodId", "shippingMethodId", "deliveryGroupId"]),
          (call) =>
            this.hasResponseKeys(call, ["deliveryGroups", "availableDeliveryMethods", "selectedDeliveryMethod"]),
          (call) => this.hasUrlPath(call, "checkouts") && this.hasPayloadKeys(call, ["deliveryMethodId"]),
        ],
        extractors: {
          deliveryMethodId: (call) => {
            const body = this.parseRequestBody(call.requestBody)
            return body?.deliveryMethodId || body?.shippingMethodId
          },
          selectedMethod: (call) => call.response?.deliveryGroups?.items?.[0]?.selectedDeliveryMethod,
          availableMethods: (call) =>
            call.response?.deliveryGroups?.items?.[0]?.availableDeliveryMethods || call.response?.deliveryMethods,
        },
        validators: {
          isSuccessful: (call) =>
            call.status < 400 && (call.response?.deliveryMethods || call.response?.deliveryGroups),
        },
        priority: 15, // Higher priority to catch payload-based delivery calls
      })

      // Address calls - enhanced with payload detection
      this.addCallType("address", {
        urlPatterns: ["/shipping-address", "/billing-address", "/delivery-address", "/addresses", "/checkouts/"],
        methods: ["GET", "POST", "PUT", "PATCH"],
        stage: "address",
        payloadMatchers: [
          (call) => this.hasPayloadKeys(call, ["address", "deliveryAddress", "billingAddress", "shippingAddress"]),
          (call) => this.hasPayloadKeys(call, ["street", "city", "state", "postalCode", "country"]),
          (call) => this.hasResponseKeys(call, ["deliveryAddress", "billingAddress", "addresses"]),
          (call) => this.hasUrlPath(call, "checkouts") && this.hasAddressInPayload(call),
        ],
        extractors: {
          addressType: (call) => {
            const url = call.url.toLowerCase()
            const payload = this.parseRequestBody(call.requestBody)

            if (url.includes("shipping") || url.includes("delivery") || payload?.deliveryAddress) return "shipping"
            if (url.includes("billing") || payload?.billingAddress) return "billing"
            if (payload?.address?.addressType) return payload.address.addressType
            return "unknown"
          },
          addressDetails: (call) =>
            call.response?.address || call.response?.deliveryAddress || call.response?.billingAddress,
        },
        validators: {
          isSuccessful: (call) => call.status < 400 && !call.response?.errors,
        },
        priority: 12,
      })

      // Tax calculation calls - enhanced
      this.addCallType("taxes", {
        urlPatterns: ["/taxes", "/tax-calculation", "/calculate-tax", "/checkouts/"],
        methods: ["GET", "POST"],
        stage: "taxes",
        payloadMatchers: [
          (call) => this.hasPayloadKeys(call, ["calculateTax", "taxCalculation", "taxAmount"]),
          (call) => this.hasResponseKeys(call, ["taxes", "taxBreakdown", "totalTaxAmount"]),
          (call) => this.hasUrlPath(call, "checkouts") && this.hasTaxInResponse(call),
        ],
        extractors: {
          taxAmount: (call) => call.response?.cartSummary?.totalTaxAmount || call.response?.totalTax,
          taxDetails: (call) => call.response?.taxes || call.response?.taxBreakdown,
        },
        validators: {
          isSuccessful: (call) => call.status < 400 && call.response?.taxes,
        },
        priority: 8,
      })

      // Inventory calls - enhanced
      this.addCallType("inventory", {
        urlPatterns: ["/inventory", "/cart-items", "/stock", "/availability", "/checkouts/"],
        methods: ["GET", "POST", "PUT"],
        stage: "inventory",
        payloadMatchers: [
          (call) => this.hasPayloadKeys(call, ["productId", "sku", "quantity", "inventoryId"]),
          (call) => this.hasResponseKeys(call, ["inventory", "stockStatus", "availableQuantity", "cartItems"]),
          (call) => this.hasUrlPath(call, "checkouts") && this.hasInventoryInResponse(call),
        ],
        extractors: {
          productCount: (call) => call.response?.totalProductCount,
          inventoryLevel: (call) => call.response?.inventory,
          stockStatus: (call) => call.response?.stockStatus,
        },
        validators: {
          isSuccessful: (call) => call.status < 400,
        },
        priority: 8,
      })

      // Checkout status calls - enhanced to catch generic checkout updates
      this.addCallType("checkout", {
        urlPatterns: ["/checkouts/", "/checkout-status", "/cart-summary"],
        methods: ["GET", "POST", "PUT"],
        stage: "checkout",
        payloadMatchers: [
          (call) => this.hasPayloadKeys(call, ["checkoutId", "cartId", "checkoutStep"]),
          (call) => this.hasResponseKeys(call, ["checkoutStatus", "cartSummary", "checkoutProgress"]),
          // Catch generic checkout calls that don't match other types
          (call) => this.hasUrlPath(call, "checkouts") && !this.matchesSpecificType(call),
        ],
        extractors: {
          checkoutId: (call) => this.extractCheckoutId(call),
          checkoutStatus: (call) => call.response?.status || call.response?.checkoutStatus,
          cartSummary: (call) => call.response?.cartSummary,
        },
        validators: {
          isSuccessful: (call) => call.status < 400,
        },
        priority: 5, // Lower priority so specific types match first
      })

      // Order placement - new type for order finalization
      this.addCallType("orderPlacement", {
        urlPatterns: ["/place-order", "/submit-order", "/finalize", "/checkouts/"],
        methods: ["POST", "PUT"],
        stage: "order",
        payloadMatchers: [
          (call) => this.hasPayloadKeys(call, ["placeOrder", "submitOrder", "finalizeOrder"]),
          (call) => this.hasResponseKeys(call, ["orderId", "orderNumber", "orderStatus", "orderPlaced"]),
          (call) => this.hasUrlPath(call, "checkouts") && call.method === "POST" && this.hasOrderInResponse(call),
        ],
        extractors: {
          orderId: (call) => call.response?.orderId || call.response?.id,
          orderNumber: (call) => call.response?.orderNumber,
          orderStatus: (call) => call.response?.status || call.response?.orderStatus,
        },
        validators: {
          isSuccessful: (call) => call.status < 400 && (call.response?.orderId || call.response?.orderNumber),
        },
        priority: 20, // High priority for order placement
      })

      // Add this new call type for /active endpoint - should be HIGHEST priority
      this.addCallType("activeCheckout", {
        urlPatterns: ["/active"],
        methods: ["PATCH", "PUT"],
        stage: "checkout-update",
        payloadMatchers: [
          // This will match any /active call and then we'll determine the specific type in extractors
          (call) => {
            const hasActiveUrl = this.hasUrlPath(call, "/active")
            console.log("🔍 Active URL check:", hasActiveUrl, "for URL:", call.url)
            return hasActiveUrl
          },
        ],
        extractors: {
          updateType: (call) => this.determineActiveUpdateType(call),
          deliveryAddressId: (call) => {
            const body = this.parseRequestBody(call.requestBody)
            return body?.deliveryAddress?.id
          },
          desiredDeliveryDate: (call) => {
            const body = this.parseRequestBody(call.requestBody)
            return body?.desiredDeliveryDate
          },
          deliveryMethodId: (call) => {
            const body = this.parseRequestBody(call.requestBody)
            return body?.deliveryMethodId
          },
          shippingInstructions: (call) => {
            const body = this.parseRequestBody(call.requestBody)
            return body?.shippingInstructions
          },
          contactInfo: (call) => {
            const body = this.parseRequestBody(call.requestBody)
            return body?.contactInfo
          },
        },
        validators: {
          isSuccessful: (call) => call.status < 400 && !call.response?.errors,
        },
        priority: 30, // HIGHEST priority to catch /active calls before any other patterns
      })

      console.log("✅ Initialized call types:", Array.from(this.callTypes.keys()))
    }

    // Add a new call type configuration
    addCallType(name, config) {
      this.callTypes.set(name, {
        name,
        urlPatterns: config.urlPatterns || [],
        methods: config.methods || ["GET", "POST", "PUT", "PATCH", "DELETE"],
        stage: config.stage || name,
        extractors: config.extractors || {},
        validators: config.validators || {},
        payloadMatchers: config.payloadMatchers || [],
        priority: config.priority || 0,
      })
    }

    // Analyze a network call and enhance it with extracted data
    analyzeCall(callData) {
      console.log("🔍 Analyzing call:", callData.method, callData.url.split("/").pop())

      const enhancedCall = { ...callData }
      const matchedTypes = []

      // Find all matching call types
      for (const [typeName, typeConfig] of this.callTypes) {
        if (this.matchesCallType(callData, typeConfig)) {
          matchedTypes.push({ name: typeName, config: typeConfig })
          console.log(`✅ Matched type: ${typeName} (priority: ${typeConfig.priority})`)
        }
      }

      // Sort by priority (higher priority first)
      matchedTypes.sort((a, b) => (b.config.priority || 0) - (a.config.priority || 0))

      // Apply the highest priority match
      if (matchedTypes.length > 0) {
        const primaryMatch = matchedTypes[0]
        enhancedCall.callType = primaryMatch.name
        enhancedCall.checkoutStage = primaryMatch.config.stage

        console.log(`🎯 Primary match: ${primaryMatch.name} (stage: ${primaryMatch.config.stage})`)

        // Apply all extractors
        for (const [extractorName, extractorFn] of Object.entries(primaryMatch.config.extractors)) {
          try {
            const extractedValue = extractorFn(callData)
            if (extractedValue !== null && extractedValue !== undefined) {
              enhancedCall[extractorName] = extractedValue
              console.log(`📊 Extracted ${extractorName}:`, extractedValue)
            }
          } catch (error) {
            console.warn(`Error in ${primaryMatch.name}.${extractorName} extractor:`, error)
          }
        }

        // Apply validators
        for (const [validatorName, validatorFn] of Object.entries(primaryMatch.config.validators)) {
          try {
            enhancedCall[validatorName] = validatorFn(callData)
          } catch (error) {
            console.warn(`Error in ${primaryMatch.name}.${validatorName} validator:`, error)
          }
        }

        console.log(`✅ Analyzed ${primaryMatch.name} call:`, {
          url: callData.url.split("/").pop(),
          stage: enhancedCall.checkoutStage,
          successful: enhancedCall.isSuccessful,
          updateType: enhancedCall.updateType,
        })
      } else {
        console.log(`❓ No matches found for:`, callData.method, callData.url)
      }

      return enhancedCall
    }

    // Update the matchesCallType method to include payload matching
    matchesCallType(callData, typeConfig) {
      const url = callData.url.toLowerCase()
      const method = callData.method.toUpperCase()

      console.log(`🔍 Checking ${typeConfig.name}:`, {
        url: url.split("/").pop(),
        method,
        urlPatterns: typeConfig.urlPatterns,
        methods: typeConfig.methods,
      })

      // Check URL patterns
      const urlMatches = typeConfig.urlPatterns.some((pattern) => {
        const matches = url.includes(pattern.toLowerCase())
        if (matches) console.log(`✅ URL pattern matched: ${pattern}`)
        return matches
      })

      // Check HTTP methods
      const methodMatches = typeConfig.methods.includes(method)
      if (methodMatches) console.log(`✅ Method matched: ${method}`)

      // Check payload matchers if URL and method match, or if we have payload-only matchers
      let payloadMatches = true
      if (typeConfig.payloadMatchers && typeConfig.payloadMatchers.length > 0) {
        payloadMatches = typeConfig.payloadMatchers.some((matcher) => {
          try {
            const result = matcher(callData)
            if (result) console.log(`✅ Payload matcher succeeded for ${typeConfig.name}`)
            return result
          } catch (error) {
            console.warn(`Payload matcher error for ${typeConfig.name}:`, error)
            return false
          }
        })
      }

      // For URL-based matching, require both URL and method match
      // For payload-based matching, allow payload match to override URL requirement
      const finalMatch =
        (urlMatches && methodMatches && payloadMatches) ||
        (typeConfig.payloadMatchers && payloadMatches && methodMatches)

      console.log(`🎯 Final match result for ${typeConfig.name}:`, finalMatch)
      return finalMatch
    }

    // Helper method to extract payment token from request body
    extractPaymentToken(requestBody) {
      try {
        const body = this.parseRequestBody(requestBody)
        return body?.paymentToken || body?.token || body?.paymentMethodId
      } catch (e) {
        return null
      }
    }

    // Helper method to extract checkout ID from various sources
    extractCheckoutId(callData) {
      // Try URL first
      const checkoutMatch = callData.url.match(/checkouts\/([^/?]+)/)
      if (checkoutMatch) return checkoutMatch[1]

      // Try response
      if (callData.response?.checkoutId) return callData.response.checkoutId
      if (callData.response?.cartSummary?.cartId) return callData.response.cartSummary.cartId

      // Priority 3: Extract from request body - only checkoutId, not cartId
      const requestBody = callData.requestBody
      if (requestBody) {
        let parsedBody = requestBody
        if (typeof requestBody === "string") {
          try {
            parsedBody = JSON.parse(requestBody)
          } catch (e) {
            // Check for checkout ID in string format - only checkoutId
            const stringMatch = requestBody.match(/(?:checkoutId)["':\s]*([a-zA-Z0-9]{15,18})/)
            if (stringMatch) {
              console.log("✅ Found checkout ID in request body string:", stringMatch[1])
              return stringMatch[1]
            }
          }
        }

        if (parsedBody && typeof parsedBody === "object") {
          if (parsedBody.checkoutId) {
            console.log("✅ Found checkout ID in request.checkoutId:", parsedBody.checkoutId)
            return parsedBody.checkoutId
          }
          // Remove cartId and generic id checks - only look for explicit checkoutId
        }
      }

      // Remove Priority 4 entirely - no generic URL pattern matching

      return null
    }

    // Helper method to safely parse request body
    parseRequestBody(requestBody) {
      if (!requestBody) return null

      try {
        return typeof requestBody === "string" ? JSON.parse(requestBody) : requestBody
      } catch (e) {
        console.warn("Failed to parse request body:", e)
        return null
      }
    }

    // Get configuration for a specific call type
    getCallTypeConfig(typeName) {
      return this.callTypes.get(typeName)
    }

    // Get all configured call types
    getAllCallTypes() {
      return Array.from(this.callTypes.keys())
    }

    // Update checkout data based on analyzed calls
    updateCheckoutData(checkoutData, analyzedCall) {
      if (!analyzedCall.callType) return checkoutData

      const updated = { ...checkoutData }

      switch (analyzedCall.callType) {
        case "payment":
          updated.payment = analyzedCall.isSuccessful
          if (!analyzedCall.isSuccessful && analyzedCall.paymentErrors) {
            updated.paymentError = {
              errors: analyzedCall.paymentErrors,
              salesforceResultCode: analyzedCall.salesforceResultCode,
              timestamp: Date.now(),
            }
          }
          break

        case "deliveryMethod":
          updated.deliveryMethod = analyzedCall.isSuccessful
          if (analyzedCall.selectedMethod) {
            updated.selectedDeliveryMethod = analyzedCall.selectedMethod
          }
          if (analyzedCall.availableMethods) {
            updated.availableDeliveryMethods = analyzedCall.availableMethods
          }
          break

        case "address":
          const addressType = analyzedCall.addressType
          if (addressType === "shipping") {
            updated.shippingAddress = analyzedCall.isSuccessful
          } else if (addressType === "billing") {
            updated.billingAddress = analyzedCall.isSuccessful
          }
          if (analyzedCall.addressDetails) {
            updated[`${addressType}AddressDetails`] = analyzedCall.addressDetails
          }
          break

        case "taxes":
          updated.taxes = analyzedCall.isSuccessful
          if (analyzedCall.taxAmount) {
            updated.taxAmount = analyzedCall.taxAmount
          }
          break

        case "inventory":
          updated.inventory = analyzedCall.isSuccessful
          break

        case "checkout":
          if (analyzedCall.checkoutId) {
            updated.checkoutId = analyzedCall.checkoutId
          }
          if (analyzedCall.cartSummary) {
            updated.cartSummary = analyzedCall.cartSummary
          }
          break

        case "activeCheckout":
          const updateType = analyzedCall.updateType
          console.log("🔄 Processing activeCheckout update:", updateType)

          if (
            updateType.includes("delivery-address") ||
            updateType === "delivery-date" ||
            updateType === "shipping-instructions"
          ) {
            updated.shippingAddress = analyzedCall.isSuccessful
            if (analyzedCall.deliveryAddressId) {
              updated.deliveryAddressId = analyzedCall.deliveryAddressId
            }
            if (analyzedCall.desiredDeliveryDate) {
              updated.desiredDeliveryDate = analyzedCall.desiredDeliveryDate
            }
          }

          if (updateType === "delivery-method") {
            updated.deliveryMethod = analyzedCall.isSuccessful
            if (analyzedCall.deliveryMethodId) {
              updated.selectedDeliveryMethodId = analyzedCall.deliveryMethodId
            }
          }

          if (updateType === "contact-info") {
            updated.contactInfo = analyzedCall.isSuccessful
            if (analyzedCall.contactInfo) {
              updated.contactDetails = analyzedCall.contactInfo
            }
          }

          if (updateType === "payment-info") {
            updated.payment = analyzedCall.isSuccessful
          }

          // Store the specific update type for debugging
          updated.lastActiveUpdateType = updateType
          console.log("✅ Updated checkout data for activeCheckout:", updated)
          break
      }

      return updated
    }

    // Add new helper methods for payload analysis
    hasPayloadKeys(call, keys) {
      const payload = this.parseRequestBody(call.requestBody)
      if (!payload) return false

      return keys.some((key) => this.hasNestedKey(payload, key))
    }

    hasResponseKeys(call, keys) {
      const response = call.response
      if (!response) return false

      return keys.some((key) => this.hasNestedKey(response, key))
    }

    hasUrlPath(call, path) {
      const result = call.url.toLowerCase().includes(path.toLowerCase())
      console.log(`🔍 URL path check: "${path}" in "${call.url}" = ${result}`)
      return result
    }

    hasNestedKey(obj, key) {
      if (!obj || typeof obj !== "object") return false

      // Direct key check
      if (obj.hasOwnProperty(key)) return true

      // Nested search
      for (const prop in obj) {
        if (typeof obj[prop] === "object" && this.hasNestedKey(obj[prop], key)) {
          return true
        }
      }

      return false
    }

    hasAddressInPayload(call) {
      const payload = this.parseRequestBody(call.requestBody)
      if (!payload) return false

      // Look for address-related fields
      const addressFields = ["street", "city", "state", "postalCode", "country", "address1", "address2"]
      return addressFields.some((field) => this.hasNestedKey(payload, field))
    }

    hasTaxInResponse(call) {
      const response = call.response
      if (!response) return false

      return (
        this.hasNestedKey(response, "totalTaxAmount") ||
        this.hasNestedKey(response, "taxes") ||
        this.hasNestedKey(response, "taxBreakdown")
      )
    }

    hasInventoryInResponse(call) {
      const response = call.response
      if (!response) return false

      return (
        this.hasNestedKey(response, "inventory") ||
        this.hasNestedKey(response, "stockStatus") ||
        this.hasNestedKey(response, "cartItems")
      )
    }

    hasOrderInResponse(call) {
      const response = call.response
      if (!response) return false

      return (
        this.hasNestedKey(response, "orderId") ||
        this.hasNestedKey(response, "orderNumber") ||
        this.hasNestedKey(response, "orderStatus")
      )
    }

    matchesSpecificType(call) {
      // Check if this call would match any of the more specific types
      const specificTypes = [
        "payment",
        "deliveryMethod",
        "address",
        "taxes",
        "inventory",
        "orderPlacement",
        "activeCheckout",
      ]

      for (const typeName of specificTypes) {
        const typeConfig = this.callTypes.get(typeName)
        if (typeConfig && this.matchesCallType(call, typeConfig)) {
          return true
        }
      }

      return false
    }

    // Add helper method to determine what type of update the /active call is making
    determineActiveUpdateType(call) {
      const body = this.parseRequestBody(call.requestBody)
      if (!body) {
        console.log("❌ No request body found for /active call")
        return "unknown"
      }

      console.log("🔍 Analyzing /active payload:", body)

      // Check for delivery address updates
      if (body.deliveryAddress || body.desiredDeliveryDate || body.shippingInstructions) {
        if (body.deliveryAddress && body.desiredDeliveryDate) {
          console.log("✅ Detected: delivery-address-with-date")
          return "delivery-address-with-date"
        } else if (body.deliveryAddress) {
          console.log("✅ Detected: delivery-address")
          return "delivery-address"
        } else if (body.desiredDeliveryDate) {
          console.log("✅ Detected: delivery-date")
          return "delivery-date"
        } else if (body.shippingInstructions) {
          console.log("✅ Detected: shipping-instructions")
          return "shipping-instructions"
        }
      }

      // Check for delivery method updates
      if (body.deliveryMethodId) {
        console.log("✅ Detected: delivery-method")
        return "delivery-method"
      }

      // Check for contact info updates
      if (body.contactInfo) {
        console.log("✅ Detected: contact-info")
        return "contact-info"
      }

      // Check for payment updates
      if (body.paymentDetails || body.paymentMethodId || body.billingAddress) {
        console.log("✅ Detected: payment-info")
        return "payment-info"
      }

      console.log("❓ Unknown /active update type")
      return "unknown"
    }
  }

  // Export for use in content script - make sure it's available immediately
  window.CheckoutCallAnalyzer = CheckoutCallAnalyzer

  // Also log that it's available
  console.log("✅ CheckoutCallAnalyzer class defined and available on window object")

  // Dispatch a custom event to signal the class is ready
  window.dispatchEvent(
    new CustomEvent("CheckoutCallAnalyzerReady", {
      detail: { CheckoutCallAnalyzer },
    }),
  )
})()
