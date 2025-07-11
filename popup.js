document.addEventListener("DOMContentLoaded", () => {
  try {
    window.popupController = new PopupController(window.chrome)
  } catch (error) {
    console.error("Failed to initialize popup controller:", error)
  }
})

class PopupController {
  constructor(chrome) {
    this.chrome = chrome || window.chrome
    this.salesforceAPI = new window.SalesforceAPI()
    this.correlations = []
    this.lastSync = null
    this.salesforceLogs = []
    this.accounts = []
    this.activeAccountId = null
    this.editingAccountId = null

    // Bind ALL methods to preserve 'this' context
    this.toggleConnectionForm = this.toggleConnectionForm.bind(this)
    this.toggleInstructions = this.toggleInstructions.bind(this)
    this.saveAccount = this.saveAccount.bind(this)
    this.testConnection = this.testConnection.bind(this)
    this.disconnectFromSalesforce = this.disconnectFromSalesforce.bind(this)
    this.syncWithCheckoutData = this.syncWithCheckoutData.bind(this)
    this.showStatus = this.showStatus.bind(this)
    this.selectAccount = this.selectAccount.bind(this)
    this.addAccount = this.addAccount.bind(this)
    this.editAccount = this.editAccount.bind(this)
    this.deleteAccount = this.deleteAccount.bind(this)
    this.toggleAccountManagement = this.toggleAccountManagement.bind(this)
    this.cancelForm = this.cancelForm.bind(this)
    this.updateInstanceTypeUI = this.updateInstanceTypeUI.bind(this)
    this.openSidePanel = this.openSidePanel.bind(this)
    this.showSessionCookies = this.showSessionCookies.bind(this)
    this.findSessionCookiesAnywhere = this.findSessionCookiesAnywhere.bind(this)
    this.clearData = this.clearData.bind(this)
    this.exportData = this.exportData.bind(this)
    this.copySessionId = this.copySessionId.bind(this)
    this.useThisSession = this.useThisSession.bind(this)

    this.init()
  }

  async init() {
    try {
      // Check if Chrome APIs are available
      if (!this.chrome || !this.chrome.storage) {
        this.showStatus("Chrome extension APIs not available", "error")
        return
      }

      await this.loadAccounts()
      await this.loadActiveConnection()
      this.setupEventListeners()
      this.updateUI()
    } catch (error) {
      console.error("Failed to initialize popup:", error)
      this.showStatus("Failed to initialize popup", "error")
    }
  }

  async loadAccounts() {
    try {
      const result = await this.chrome.storage.local.get([
        "salesforceAccounts",
        "activeAccountId",
        "correlations",
        "salesforceLogs",
        "lastSync",
      ])
      this.accounts = result.salesforceAccounts || []
      this.activeAccountId = result.activeAccountId || null
      this.correlations = result.correlations || []
      this.salesforceLogs = result.salesforceLogs || []
      this.lastSync = result.lastSync

      /* console.log(
        "Loaded accounts:",
        this.accounts.length,
        "Active:",
        this.activeAccountId,
        "Correlations:",
        this.correlations.length,
      ) */
    } catch (error) {
      console.error("Failed to load accounts:", error)
    }
  }

  async loadActiveConnection() {
    if (!this.activeAccountId) return

    const activeAccount = this.accounts.find((acc) => acc.id === this.activeAccountId)
    if (!activeAccount) return

    try {
      // Test if the active account is still valid
      const connectResult = await this.salesforceAPI.connect(activeAccount.instanceUrl, activeAccount.sessionId)

      if (connectResult.success) {
        //console.log("Active account connection restored")
      } else {
        console.warn("Active account connection failed, clearing active account")
        this.activeAccountId = null
        await this.chrome.storage.local.remove("activeAccountId")
      }
    } catch (error) {
      console.error("Failed to restore active connection:", error)
      this.activeAccountId = null
    }
  }

  setupEventListeners() {
    // Setup connection button
    const setupBtn = document.getElementById("setup-btn")
    if (setupBtn) {
      setupBtn.addEventListener("click", this.toggleConnectionForm)
    }

    // Save account button
    const saveBtn = document.getElementById("save-account-btn")
    if (saveBtn) {
      saveBtn.addEventListener("click", this.saveAccount)
    }

    // Cancel button
    const cancelBtn = document.getElementById("cancel-btn")
    if (cancelBtn) {
      cancelBtn.addEventListener("click", this.cancelForm)
    }

    // Instructions button
    const instructionsBtn = document.getElementById("instructions-btn")
    if (instructionsBtn) {
      instructionsBtn.addEventListener("click", this.toggleInstructions)
    }

    // Test connection button
    const testBtn = document.getElementById("test-btn")
    if (testBtn) {
      testBtn.addEventListener("click", this.testConnection)
    }

    // Disconnect button
    const disconnectBtn = document.getElementById("disconnect-btn")
    if (disconnectBtn) {
      disconnectBtn.addEventListener("click", this.disconnectFromSalesforce)
    }

    // Sync button
    const syncBtn = document.getElementById("sync-btn")
    if (syncBtn) {
      syncBtn.addEventListener("click", this.syncWithCheckoutData)
    }

    // Account selector
    const accountSelect = document.getElementById("account-select")
    if (accountSelect) {
      accountSelect.addEventListener("change", (e) => {
        if (e.target.value) {
          this.selectAccount(e.target.value)
        }
      })
    }

    // Add account button
    const addAccountBtn = document.getElementById("add-account-btn")
    if (addAccountBtn) {
      addAccountBtn.addEventListener("click", this.addAccount)
    }

    // Instance type radio buttons
    const productionRadio = document.getElementById("instance-production")
    const sandboxRadio = document.getElementById("instance-sandbox")

    if (productionRadio) {
      productionRadio.addEventListener("change", this.updateInstanceTypeUI)
    }
    if (sandboxRadio) {
      sandboxRadio.addEventListener("change", this.updateInstanceTypeUI)
    }

    // Open side panel button
    const openPanelBtn = document.getElementById("open-panel-btn")
    if (openPanelBtn) {
      openPanelBtn.addEventListener("click", this.openSidePanel)
    }

    // Show cookies button
    const showCookiesBtn = document.getElementById("show-cookies-btn")
    if (showCookiesBtn) {
      showCookiesBtn.addEventListener("click", this.findSessionCookiesAnywhere)
    }

    // Clear data button
    const clearDataBtn = document.getElementById("clear-data-btn")
    if (clearDataBtn) {
      clearDataBtn.addEventListener("click", this.clearData)
    }

    // Export data button
    const exportDataBtn = document.getElementById("export-data-btn")
    if (exportDataBtn) {
      exportDataBtn.addEventListener("click", this.exportData)
    }

    // Listen for sync requests from content script
    if (this.chrome && this.chrome.runtime) {
      this.chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === "syncSalesforceData") {
          this.syncWithCheckoutData()
            .then(() => {
              sendResponse({ success: true, logs: this.salesforceLogs })
            })
            .catch((error) => {
              sendResponse({ success: false, error: error.message })
            })
          return true
        }
      })
    }

  }

  updateInstanceTypeUI() {
    const productionRadio = document.getElementById("instance-production")
    const sandboxRadio = document.getElementById("instance-sandbox")
    const urlInput = document.getElementById("instance-url")
    const urlExample = document.getElementById("url-example")

    if (productionRadio && productionRadio.checked) {
      if (urlInput) {
        urlInput.placeholder = "https://yourorg.my.salesforce.com"
      }
      if (urlExample) {
        urlExample.innerHTML = `
          <strong>Production Example:</strong><br>
          https://yourorg.my.salesforce.com
        `
      }
    } else if (sandboxRadio && sandboxRadio.checked) {
      if (urlInput) {
        urlInput.placeholder = "https://yourorg--sandboxname.sandbox.my.salesforce.com"
      }
      if (urlExample) {
        urlExample.innerHTML = `
          <strong>Sandbox Examples:</strong><br>
          https://yourorg--dev.sandbox.my.salesforce.com<br>
          https://yourorg--staging.sandbox.my.salesforce.com
        `
      }
    }
  }

  async selectAccount(accountId) {
    const account = this.accounts.find((acc) => acc.id === accountId)
    if (!account) return

    this.showStatus("Connecting to account...", "info")

    try {
      const result = await this.salesforceAPI.connect(account.instanceUrl, account.sessionId)

      if (result.success) {
        this.activeAccountId = accountId
        await this.chrome.storage.local.set({ activeAccountId: accountId })

        this.showStatus(`Connected to ${account.name}!`, "success")
        this.updateUI()

        // Auto-sync after connecting
        setTimeout(() => this.syncWithCheckoutData(), 1000)
      } else {
        this.showStatus(`Connection failed: ${result.error}`, "error")
      }
    } catch (error) {
      this.showStatus(`Connection error: ${error.message}`, "error")
    }
  }

  addAccount() {
    this.editingAccountId = null
    this.showAccountForm()
  }

  editAccount(accountId) {
    this.editingAccountId = accountId
    const account = this.accounts.find((acc) => acc.id === accountId)

    if (account) {
      document.getElementById("account-name-input").value = account.name
      document.getElementById("instance-url").value = account.instanceUrl
      document.getElementById("session-id").value = account.sessionId

      // Set instance type radio button
      const instanceType = account.instanceType || "production"
      const radioButton = document.getElementById(`instance-${instanceType}`)
      if (radioButton) {
        radioButton.checked = true
        this.updateInstanceTypeUI()
      }
    }

    this.showAccountForm()
  }

  async deleteAccount(accountId) {
    if (!confirm("Are you sure you want to delete this account?")) return

    this.accounts = this.accounts.filter((acc) => acc.id !== accountId)

    // If deleting the active account, clear it
    if (this.activeAccountId === accountId) {
      this.activeAccountId = null
      await this.salesforceAPI.disconnect()
    }

    await this.saveAccounts()
    this.updateUI()
    this.showStatus("Account deleted", "info")
  }

  debugAccountManagement() {
    /* console.log("🔍 Account Management Debug Info:")
    console.log("Total accounts:", this.accounts.length)
    console.log("Active account ID:", this.activeAccountId)
    console.log(
      "Accounts:",
      this.accounts.map((acc) => ({
        id: acc.id,
        name: acc.name,
        instanceType: acc.instanceType,
      })),
    ) */

    // Check if event listeners are properly bound
    const accountList = document.getElementById("account-list")
    if (accountList) {
      const buttons = accountList.querySelectorAll("button")
      console.log("Found buttons in account list:", buttons.length)
      buttons.forEach((btn, index) => {
        console.log(`Button ${index}:`, {
          className: btn.className,
          textContent: btn.textContent,
          hasClickListener: btn.onclick !== null,
          dataAttributes: Object.fromEntries(
            Array.from(btn.attributes)
              .filter((attr) => attr.name.startsWith("data-"))
              .map((attr) => [attr.name, attr.value]),
          ),
        })
      })
    }
  }

  showAccountForm() {
    // Hide other sections
    document.getElementById("account-selector").style.display = "none"
    document.getElementById("account-management").style.display = "none"
    document.getElementById("connection-info").style.display = "none"

    // Show form
    document.getElementById("account-form").classList.add("show")

    // Update buttons
    document.getElementById("setup-btn").style.display = "none"
    document.getElementById("save-account-btn").style.display = "inline-block"
    document.getElementById("cancel-btn").style.display = "inline-block"
    document.getElementById("test-btn").style.display = "none"
    document.getElementById("sync-btn").style.display = "none"
    document.getElementById("disconnect-btn").style.display = "none"

    // Update UI based on selected instance type
    this.updateInstanceTypeUI()
  }

  cancelForm() {
    this.editingAccountId = null

    // Clear form
    document.getElementById("account-name-input").value = ""
    document.getElementById("instance-url").value = ""
    document.getElementById("session-id").value = ""

    // Hide cookie display
    document.getElementById("cookie-display").classList.remove("show")

    // Reset to production
    const productionRadio = document.getElementById("instance-production")
    if (productionRadio) {
      productionRadio.checked = true
      this.updateInstanceTypeUI()
    }

    // Hide form
    document.getElementById("account-form").classList.remove("show")

    this.updateUI()
  }

  getSelectedInstanceType() {
    const productionRadio = document.getElementById("instance-production")
    const sandboxRadio = document.getElementById("instance-sandbox")

    if (sandboxRadio && sandboxRadio.checked) {
      return "sandbox"
    }
    return "production"
  }

  validateInstanceUrl(url, instanceType) {
    try {
      const urlObj = new URL(url)

      // Check if it's a Salesforce domain
      if (!urlObj.hostname.includes("salesforce.com") && !urlObj.hostname.includes("force.com")) {
        return { valid: false, error: "URL must be a Salesforce domain" }
      }

      // Validate based on instance type
      if (instanceType === "sandbox") {
        // Sandbox URLs should contain 'sandbox' and typically have '--' pattern
        if (!urlObj.hostname.includes("sandbox")) {
          return {
            valid: false,
            error: "Sandbox URLs should contain 'sandbox' (e.g., yourorg--dev.sandbox.my.salesforce.com)",
          }
        }
      } else {
        // Production URLs should NOT contain 'sandbox'
        if (urlObj.hostname.includes("sandbox")) {
          return {
            valid: false,
            error: "This appears to be a sandbox URL. Please select 'Sandbox' as the instance type.",
          }
        }
      }

      return { valid: true }
    } catch (error) {
      return { valid: false, error: "Please enter a valid URL" }
    }
  }

  async saveAccount() {
    const name = document.getElementById("account-name-input").value.trim()
    const instanceUrl = document.getElementById("instance-url").value.trim()
    const sessionId = document.getElementById("session-id").value.trim()
    const instanceType = this.getSelectedInstanceType()

    if (!name || !instanceUrl || !sessionId) {
      this.showStatus("Please fill in all fields", "error")
      return
    }

    // Validate session ID format
    const validation = this.salesforceAPI.validateSessionId(sessionId)
    if (!validation.valid) {
      this.showStatus(`Invalid Session ID: ${validation.error}`, "error")
      return
    }

    // Validate instance URL format based on type
    const urlValidation = this.validateInstanceUrl(instanceUrl, instanceType)
    if (!urlValidation.valid) {
      this.showStatus(urlValidation.error, "error")
      return
    }

    this.showStatus("Testing connection...", "info")

    try {
      // Test the connection first
      const result = await this.salesforceAPI.connect(instanceUrl, sessionId)

      if (!result.success) {
        this.showStatus(`Connection test failed: ${result.error}`, "error")
        return
      }

      // Save the account
      const account = {
        id: this.editingAccountId || this.generateId(),
        name,
        instanceUrl: instanceUrl.endsWith("/") ? instanceUrl.slice(0, -1) : instanceUrl,
        sessionId,
        instanceType,
        createdAt: this.editingAccountId
          ? this.accounts.find((acc) => acc.id === this.editingAccountId).createdAt
          : Date.now(),
        updatedAt: Date.now(),
      }

      if (this.editingAccountId) {
        // Update existing account
        const index = this.accounts.findIndex((acc) => acc.id === this.editingAccountId)
        this.accounts[index] = account
        this.showStatus(`Account "${name}" updated!`, "success")
      } else {
        // Add new account
        this.accounts.push(account)
        this.showStatus(`Account "${name}" added!`, "success")
      }

      // Set as active account
      this.activeAccountId = account.id

      await this.saveAccounts()
      this.cancelForm()
      this.updateUI()

      // Auto-sync after saving
      setTimeout(() => this.syncWithCheckoutData(), 1000)
    } catch (error) {
      this.showStatus(`Error saving account: ${error.message}`, "error")
    }
  }

  async saveAccounts() {
    await this.chrome.storage.local.set({
      salesforceAccounts: this.accounts,
      activeAccountId: this.activeAccountId,
    })
  }

  toggleConnectionForm() {
    const hasAccounts = this.accounts.length > 0

    if (hasAccounts) {
      this.toggleAccountManagement()
    } else {
      this.addAccount()
    }
  }

  toggleAccountManagement() {
    const management = document.getElementById("account-management")
    const selector = document.getElementById("account-selector")
    const setupBtn = document.getElementById("setup-btn")

    if (management.style.display === "block") {
      management.style.display = "none"
      if (this.accounts.length > 0) {
        selector.style.display = "block"
      }
      setupBtn.textContent = this.accounts.length > 0 ? "Manage Accounts" : "Setup Connection"
    } else {
      management.style.display = "block"
      selector.style.display = "none"
      setupBtn.textContent = "Close Management"
      this.renderAccountList()
    }
  }

  renderAccountList() {
    const container = document.getElementById("account-list")
    container.innerHTML = ""

    if (this.accounts.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 20px; color: #6b7280;">
          <div>No accounts configured</div>
          <button class="btn btn-primary" onclick="window.popupController.addAccount()" style="margin-top: 8px;">Add First Account</button>
        </div>
      `
      return
    }

    this.accounts.forEach((account) => {
      const item = document.createElement("div")
      item.className = `account-item ${account.id === this.activeAccountId ? "active" : ""}`

      const instanceType = account.instanceType || "production"
      const instanceBadge = `<span class="instance-type-badge instance-${instanceType}">${instanceType}</span>`

      item.innerHTML = `
        <div class="account-info">
          <div class="account-name">
            ${account.name}
            ${instanceBadge}
          </div>
          <div class="account-url">${new URL(account.instanceUrl).hostname}</div>
        </div>
        <div class="account-actions-small">
          ${account.id !== this.activeAccountId ? `<button class="btn btn-small btn-select" data-action="select" data-account-id="${account.id}">Select</button>` : '<span style="font-size: 10px; color: #22c55e; font-weight: 600;">ACTIVE</span>'}
          <button class="btn btn-small btn-edit" data-action="edit" data-account-id="${account.id}">Edit</button>
          <button class="btn btn-small btn-delete" data-action="delete" data-account-id="${account.id}">Delete</button>
        </div>
      `

      // Add event listeners for the buttons
      const selectBtn = item.querySelector('[data-action="select"]')
      const editBtn = item.querySelector('[data-action="edit"]')
      const deleteBtn = item.querySelector('[data-action="delete"]')

      if (selectBtn) {
        selectBtn.addEventListener("click", () => this.selectAccount(account.id))
      }

      if (editBtn) {
        editBtn.addEventListener("click", () => this.editAccount(account.id))
      }

      if (deleteBtn) {
        deleteBtn.addEventListener("click", () => this.deleteAccount(account.id))
      }

      container.appendChild(item)
    })
  }

  updateUI() {
    this.updateAccountSelector()
    this.updateConnectionInfo()
    this.updateSalesforceStatus()
    this.updateCorrelationSummary()

    // Add debug logging
    if (this.accounts.length > 0) {
      this.debugAccountManagement()
    }
  }

  updateAccountSelector() {
    const selector = document.getElementById("account-selector")
    const select = document.getElementById("account-select")

    if (this.accounts.length === 0) {
      selector.style.display = "none"
      return
    }

    selector.style.display = "block"

    // Populate select options
    select.innerHTML = '<option value="">Select an account...</option>'
    this.accounts.forEach((account) => {
      const option = document.createElement("option")
      option.value = account.id
      const instanceType = account.instanceType || "production"
      option.textContent = `${account.name} (${instanceType})`
      option.selected = account.id === this.activeAccountId
      select.appendChild(option)
    })
  }

  updateConnectionInfo() {
    const info = document.getElementById("connection-info")
    const nameEl = document.getElementById("account-name")
    const instanceEl = document.getElementById("connected-instance")
    const typeEl = document.getElementById("instance-type")
    const timeEl = document.getElementById("connected-time")

    const activeAccount = this.accounts.find((acc) => acc.id === this.activeAccountId)

    if (activeAccount && this.salesforceAPI.isConnected) {
      info.style.display = "block"
      nameEl.textContent = activeAccount.name
      instanceEl.textContent = new URL(activeAccount.instanceUrl).hostname

      const instanceType = activeAccount.instanceType || "production"
      typeEl.textContent = instanceType.charAt(0).toUpperCase() + instanceType.slice(1)
      typeEl.className = `instance-type-badge instance-${instanceType}`

      timeEl.textContent = new Date(activeAccount.updatedAt).toLocaleString()
    } else {
      info.style.display = "none"
    }
  }

  updateSalesforceStatus() {
    const statusEl = document.getElementById("salesforce-status")
    const setupBtn = document.getElementById("setup-btn")
    const testBtn = document.getElementById("test-btn")
    const syncBtn = document.getElementById("sync-btn")
    const disconnectBtn = document.getElementById("disconnect-btn")

    const isConnected = this.salesforceAPI.isConnected && this.activeAccountId
    const hasAccounts = this.accounts.length > 0

    if (isConnected) {
      statusEl.textContent = "Connected"
      statusEl.className = "status-badge status-active"
      setupBtn.textContent = "Manage Accounts"
      testBtn.style.display = "inline-block"
      syncBtn.style.display = "inline-block"
      disconnectBtn.style.display = "inline-block"
    } else {
      statusEl.textContent = hasAccounts ? "Select Account" : "No Accounts"
      statusEl.className = "status-badge status-inactive"
      setupBtn.textContent = hasAccounts ? "Manage Accounts" : "Setup Connection"
      testBtn.style.display = "none"
      syncBtn.style.display = "none"
      disconnectBtn.style.display = "none"
    }
  }

  async testConnection() {
    this.showStatus("Testing connection...", "info")

    try {
      const result = await this.salesforceAPI.testConnection()

      if (result.success) {
        this.showStatus("Connection is working!", "success")
      } else {
        this.showStatus(`Connection test failed: ${result.message}`, "error")
      }
    } catch (error) {
      this.showStatus(`Test failed: ${error.message}`, "error")
    }
  }

  async disconnectFromSalesforce() {
    try {
      await this.salesforceAPI.disconnect()
      this.activeAccountId = null
      await this.chrome.storage.local.remove("activeAccountId")

      this.updateUI()
      this.showStatus("Disconnected from Salesforce", "info")

      // Clear correlation data
      this.correlations = []
      this.lastSync = null
      await this.chrome.storage.local.remove(["correlations", "lastSync"])
      this.updateCorrelationSummary()
    } catch (error) {
      console.error("Disconnect error:", error)
      this.showStatus("Error disconnecting", "error")
    }
  }

  async syncWithCheckoutData() {
    if (!this.salesforceAPI.isConnected) {
      this.showStatus("Not connected to Salesforce", "error")
      return
    }

    try {
      this.showStatus("Fetching Salesforce logs...", "info")

      const { logs } = await this.salesforceAPI.getDebugLogs({
        startTime: new Date(Date.now() - 60 * 60 * 1000),
        endTime: new Date(),
        maxRecords: 50,
      })

      this.salesforceLogs = logs
      this.lastSync = Date.now()

      await this.chrome.storage.local.set({
        salesforceLogs: logs,
        lastSync: this.lastSync,
      })

      if (logs.length > 0) {
        this.showStatus(`Found ${logs.length} Salesforce logs!`, "success")
      } else {
        this.showStatus("No Salesforce logs found. Try performing Commerce Cloud actions.", "warning")
      }

      this.updateCorrelationSummary()

      // Send logs to content script for display
      try {
        if (this.chrome.tabs && this.chrome.tabs.query) {
          const tabs = await new Promise((resolve) => {
            this.chrome.tabs.query({ active: true, currentWindow: true }, resolve)
          })

          if (tabs[0]) {
            this.chrome.tabs.sendMessage(tabs[0].id, {
              action: "updateSalesforceLogs",
              logs: logs,
            })
            //console.log("📤 Sent logs to content script")
          }
        }
      } catch (error) {
        console.warn("Could not send logs to content script:", error)
      }
    } catch (error) {
      console.error("❌ Sync failed:", error)
      this.showStatus(`Sync failed: ${error.message}`, "error")
    }
  }

  updateCorrelationSummary() {
    const countEl = document.getElementById("correlation-count")
    const syncEl = document.getElementById("last-sync")

    if (countEl) {
      countEl.textContent = this.salesforceLogs.length
    }

    if (syncEl) {
      if (this.lastSync) {
        syncEl.textContent = new Date(this.lastSync).toLocaleTimeString()
      } else {
        syncEl.textContent = "Never"
      }
    }
  }

  toggleInstructions() {
    const instructions = document.getElementById("instructions")
    const button = document.getElementById("instructions-btn")

    if (instructions && button) {
      if (instructions.classList.contains("show")) {
        instructions.classList.remove("show")
        button.textContent = "Show Instructions"
      } else {
        instructions.classList.add("show")
        button.textContent = "Hide Instructions"
      }
    }
  }

  showStatus(message, type) {
    try {
      // Remove existing status
      const existing = document.querySelector(".temp-status")
      if (existing) existing.remove()

      // Create new status
      const status = document.createElement("div")
      status.className = "temp-status"

      // Set colors based on type
      if (type === "success") {
        status.style.background = "#dcfce7"
        status.style.color = "#166534"
        status.style.border = "1px solid #bbf7d0"
      } else if (type === "error") {
        status.style.background = "#fef2f2"
        status.style.color = "#991b1b"
        status.style.border = "1px solid #fecaca"
      } else if (type === "warning") {
        status.style.background = "#fef3c7"
        status.style.color = "#92400e"
        status.style.border = "1px solid #fde68a"
      } else {
        status.style.background = "#fef3c7"
        status.style.color = "#92400e"
        status.style.border = "1px solid #fde68a"
      }

      status.textContent = message
      document.body.appendChild(status)

      // Auto-remove after 4 seconds
      setTimeout(() => {
        if (status.parentNode) {
          status.remove()
        }
      }, 4000)

      //console.log(`📢 Status: ${message} (${type})`)
    } catch (error) {
      console.error("Failed to show status:", error)
    }
  }

  generateId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
  }

  async openSidePanel() {
    try {
      // Check if Chrome APIs are available
      if (!this.chrome.tabs || !this.chrome.tabs.query) {
        this.showStatus("Chrome tabs API not available", "error")
        return
      }

      // Get the active tab
      const tabs = await new Promise((resolve) => {
        this.chrome.tabs.query({ active: true, currentWindow: true }, resolve)
      })

      if (tabs[0]) {
        // Send message to content script to open panel manually
        this.chrome.tabs.sendMessage(
          tabs[0].id,
          {
            action: "openSidePanelManually",
          },
          (response) => {
            if (this.chrome.runtime.lastError) {
              this.showStatus("Could not open side panel. Make sure you're on a Salesforce page.", "error")
            } else if (response && response.success) {
              this.showStatus("Side panel opened!", "success")
            } else {
              this.showStatus("Failed to open side panel", "error")
            }
          },
        )
      }
    } catch (error) {
      console.error("Error opening side panel:", error)
      this.showStatus("Error opening side panel", "error")
    }
  }

  async findSessionCookiesAnywhere() {
    try {
      this.showStatus("Looking for session cookies...", "info")

      // Check if Chrome APIs are available
      if (!this.chrome.cookies || !this.chrome.cookies.getAll) {
        this.showStatus("Chrome cookies API not available", "error")
        return
      }

      // Get all cookies with name 'sid'
      const sidCookies = await new Promise((resolve, reject) => {
        this.chrome.cookies.getAll({ name: "sid" }, (cookies) => {
          if (this.chrome.runtime.lastError) {
            reject(this.chrome.runtime.lastError)
          } else {
            resolve(cookies)
          }
        })
      })

      //console.log("Found sid cookies:", sidCookies)

      if (sidCookies.length === 0) {
        this.showStatus("No session ID cookies found. Please log in to Salesforce first.", "warning")
        return
      }

      // Display the cookies
      this.displayCookies(sidCookies, "Various domains")
      this.showStatus(`Found ${sidCookies.length} session cookie(s)`, "success")
    } catch (error) {
      console.error("Error reading cookies:", error)
      this.showStatus(`Error reading cookies: ${error.message}`, "error")
    }
  }

  async showSessionCookies() {
    // Just call the findSessionCookiesAnywhere method as it's more robust
    await this.findSessionCookiesAnywhere()
  }

  copySessionId(sessionId) {
    try {
      navigator.clipboard
        .writeText(sessionId)
        .then(() => {
          this.showStatus("Session ID copied to clipboard!", "success")
        })
        .catch(() => {
          // Fallback for older browsers
          const textArea = document.createElement("textarea")
          textArea.value = sessionId
          document.body.appendChild(textArea)
          textArea.select()
          document.execCommand("copy")
          document.body.removeChild(textArea)
          this.showStatus("Session ID copied to clipboard!", "success")
        })
    } catch (error) {
      console.error("Failed to copy session ID:", error)
      this.showStatus("Failed to copy session ID", "error")
    }
  }

  useThisSession(cookie) {
    try {
      // Extract domain and create instance URL
      const domain = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain
      const instanceUrl = `https://${domain}`

      // Detect instance type and generate account name
      const instanceType = this.detectInstanceType(domain)
      let accountName = domain.split(".")[0]

      // Clean up account name
      if (accountName.includes("--")) {
        const parts = accountName.split("--")
        accountName = `${parts[0]} (${parts[1]})`
      }

      // Set the form fields
      document.getElementById("account-name-input").value = accountName
      document.getElementById("instance-url").value = instanceUrl
      document.getElementById("session-id").value = cookie.value

      // Set the correct instance type radio button
      const radioButton = document.getElementById(`instance-${instanceType}`)
      if (radioButton) {
        radioButton.checked = true
        this.updateInstanceTypeUI()
      }

      this.showStatus("Session details filled in form!", "success")
    } catch (error) {
      console.error("Failed to use session:", error)
      this.showStatus("Failed to fill form with session details", "error")
    }
  }

  displayCookies(cookies, hostname) {
    const cookieDisplay = document.getElementById("cookie-display")
    const cookieList = document.getElementById("cookie-list")

    // Clear previous cookies
    cookieList.innerHTML = ""

    cookies.forEach((cookie, index) => {
      const cookieItem = document.createElement("div")
      cookieItem.className = "cookie-item"

      // Use the cookie's actual domain
      const actualHostname = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain
      const instanceType = this.detectInstanceType(actualHostname)
      const cookieTypeClass = instanceType === "sandbox" ? "instance-sandbox" : "instance-production"

      cookieItem.innerHTML = `
        <div class="cookie-header">
          <div class="cookie-domain">${actualHostname}</div>
          <div class="cookie-type ${cookieTypeClass}">${instanceType}</div>
        </div>
        <div class="cookie-value" title="Session ID">
          ${cookie.value.substring(0, 20)}...
        </div>
        <div style="margin-top: 8px;">
          <button class="btn btn-small btn-primary copy-session-btn" data-session-id="${cookie.value}">
            Copy Session ID
          </button>
          <button class="btn btn-small btn-success use-session-btn" data-cookie='${JSON.stringify(cookie)}'>
            Use This Session
          </button>
        </div>
      `

      // Add event listeners for the buttons
      const copyBtn = cookieItem.querySelector(".copy-session-btn")
      const useBtn = cookieItem.querySelector(".use-session-btn")

      if (copyBtn) {
        copyBtn.addEventListener("click", () => {
          this.copySessionId(cookie.value)
        })
      }

      if (useBtn) {
        useBtn.addEventListener("click", () => {
          this.useThisSession(cookie)
        })
      }

      cookieList.appendChild(cookieItem)
    })

    // Show the cookie display
    cookieDisplay.classList.add("show")
  }

  detectInstanceType(hostname) {
    // Check if it's a sandbox based on hostname patterns
    if (
      hostname.includes("sandbox") ||
      hostname.includes("--") ||
      hostname.includes("test") ||
      hostname.includes("dev")
    ) {
      return "sandbox"
    }
    return "production"
  }

  async clearData() {
    try {
      // Check if Chrome APIs are available
      if (!this.chrome.tabs || !this.chrome.tabs.query) {
        this.showStatus("Chrome tabs API not available", "error")
        return
      }

      // Get the active tab
      const tabs = await new Promise((resolve) => {
        this.chrome.tabs.query({ active: true, currentWindow: true }, resolve)
      })

      if (tabs[0]) {
        // Send message to content script to clear data
        this.chrome.tabs.sendMessage(
          tabs[0].id,
          {
            action: "clearData",
          },
          (response) => {
            if (response && response.success) {
              this.showStatus("Data cleared!", "success")
            } else {
              this.showStatus("Failed to clear data", "error")
            }
          },
        )
      }
    } catch (error) {
      console.error("Error clearing data:", error)
      this.showStatus("Error clearing data", "error")
    }
  }

  async exportData() {
    try {
      // Check if Chrome APIs are available
      if (!this.chrome.tabs || !this.chrome.tabs.query) {
        this.showStatus("Chrome tabs API not available", "error")
        return
      }

      // Get the active tab
      const tabs = await new Promise((resolve) => {
        this.chrome.tabs.query({ active: true, currentWindow: true }, resolve)
      })

      if (tabs[0]) {
        // Send message to content script to export data
        this.chrome.tabs.sendMessage(
          tabs[0].id,
          {
            action: "exportData",
          },
          (response) => {
            if (response && response.success) {
              this.showStatus("Data exported!", "success")
            } else {
              this.showStatus("Failed to export data", "error")
            }
          },
        )
      }
    } catch (error) {
      console.error("Error exporting data:", error)
      this.showStatus("Error exporting data", "error")
    }
  }
}
