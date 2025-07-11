// Session Manager for storing and retrieving checkout sessions
;(() => {
  
    // Session Manager - Handles session creation, storage, and management
    class SessionManager {
      constructor() {
        this.sessions = []
        this.currentSessionId = null
        this.storageKey = "sfcc_debug_sessions"
        this.maxSessions = 50 // Limit to prevent storage bloat
        this.chrome = typeof chrome !== "undefined" && chrome.storage ? chrome : null // Declare chrome variable
        this.init()
      }
  
      async init() {
        await this.loadSessions()
        //console.log(`📋 SessionManager initialized with ${this.sessions.length} sessions`)
  
        // Dispatch ready event
        window.dispatchEvent(new CustomEvent("SessionManagerReady"))
      }
  
      // Create a new session with the provided data
      createSession(sessionData) {
        //console.log("📝 Creating new session with data:", sessionData)
  
        const session = {
          id: this.generateSessionId(),
          name: sessionData.name || `Session ${new Date().toLocaleTimeString()}`,
          checkoutId: sessionData.checkoutId || null,
          startTime: sessionData.startTime || Date.now(),
          endTime: null,
          networkCalls: sessionData.networkCalls || [],
          errors: sessionData.errors || [],
          salesforceLogs: sessionData.salesforceLogs || [],
          correlations: sessionData.correlations || [],
          checkoutData: sessionData.checkoutData || {},
          metadata: {
            url: window.location.href,
            userAgent: navigator.userAgent,
            timestamp: Date.now(),
          },
        }
  
        this.sessions.unshift(session) // Add to beginning for most recent first
        this.currentSessionId = session.id
  
        // Limit sessions to prevent storage bloat
        if (this.sessions.length > this.maxSessions) {
          this.sessions = this.sessions.slice(0, this.maxSessions)
        }
  
        this.saveSessions()
        //console.log("✅ Created session:", session.id, "with checkout ID:", session.checkoutId)
        return session
      }
  
      // Enhanced session creation with duplicate prevention
      createNewSession(sessionData) {
        /* console.log("Session data:", {
          checkoutId: sessionData.checkoutId,
          name: sessionData.name,
          networkCallsCount: sessionData.networkCalls?.length || 0,
        }) */
  
        // Check if there's already an active session with the same checkout ID
        if (sessionData.checkoutId) {
          const existingSession = this.findSessionByCheckoutId(sessionData.checkoutId)
          if (existingSession && !existingSession.endTime) {
            /* console.log("🔄 Found existing active session for checkout ID, returning existing session:", {
              sessionId: existingSession.id,
              checkoutId: existingSession.checkoutId,
              sessionName: existingSession.name,
            }) */
            this.currentSessionId = existingSession.id
            return existingSession
          }
        }
  
        // No duplicate found, create new session
        return this.createSession(sessionData)
      }
  
      // Find session by checkout ID
      findSessionByCheckoutId(checkoutId) {
        if (!checkoutId) {
          return null
        }
  
        const session = this.sessions.find((s) => s.checkoutId === checkoutId)
        return session
      }
  
      // Load a specific session by ID
      loadSession(sessionId) {
        const session = this.sessions.find((s) => s.id === sessionId)
        if (session) {
          this.currentSessionId = sessionId
          //console.log("📂 Loaded session:", sessionId, "with checkout ID:", session.checkoutId)
          return { ...session } // Return a copy to prevent direct mutation
        }
        console.warn("Session not found:", sessionId)
        return null
      }
  
      // Save/update a session
      saveSession(sessionData) {
        const index = this.sessions.findIndex((s) => s.id === sessionData.id)
        if (index !== -1) {
          // Update existing session
          this.sessions[index] = { ...sessionData }
          //console.log("💾 Updated session:", sessionData.id, "with checkout ID:", sessionData.checkoutId)
        } else {
          // Add new session
          this.sessions.unshift(sessionData)
          //console.log("💾 Added new session:", sessionData.id, "with checkout ID:", sessionData.checkoutId)
        }
  
        // Limit sessions
        if (this.sessions.length > this.maxSessions) {
          this.sessions = this.sessions.slice(0, this.maxSessions)
        }
  
        this.saveSessions()
      }
  
      // Delete a session
      deleteSession(sessionId) {
        const index = this.sessions.findIndex((s) => s.id === sessionId)
        if (index !== -1) {
          const deletedSession = this.sessions[index]
          this.sessions.splice(index, 1)
          this.saveSessions()
          //console.log("🗑️ Deleted session:", sessionId, "with checkout ID:", deletedSession.checkoutId)
  
          // Clear current session if it was deleted
          if (this.currentSessionId === sessionId) {
            this.currentSessionId = null
          }
        }
      }
  
      // Clear all sessions
      clearAllSessions() {
        this.sessions = []
        this.currentSessionId = null
        this.saveSessions()
      }
  
      // Get current session
      getCurrentSession() {
        if (!this.currentSessionId) return null
        return this.loadSession(this.currentSessionId)
      }
  
      // Get all sessions
      getAllSessions() {
        return [...this.sessions] // Return a copy
      }
  
      // Get sessions by status
      getSessionsByStatus(status) {
        switch (status) {
          case "active":
            return this.sessions.filter((s) => !s.endTime)
          case "completed":
            return this.sessions.filter((s) => s.endTime)
          default:
            return this.getAllSessions()
        }
      }
  
      // Get sessions by checkout ID
      getSessionsByCheckoutId(checkoutId) {
        return this.sessions.filter((s) => s.checkoutId === checkoutId)
      }
  
      // Search sessions
      searchSessions(query) {
        const lowerQuery = query.toLowerCase()
        return this.sessions.filter(
          (s) =>
            s.name.toLowerCase().includes(lowerQuery) ||
            (s.checkoutId && s.checkoutId.toLowerCase().includes(lowerQuery)) ||
            (s.metadata && s.metadata.url && s.metadata.url.toLowerCase().includes(lowerQuery)),
        )
      }
  
      // Get session statistics
      getSessionStats() {
        const total = this.sessions.length
        const active = this.sessions.filter((s) => !s.endTime).length
        const completed = this.sessions.filter((s) => s.endTime).length
        const totalCalls = this.sessions.reduce((sum, s) => sum + (s.networkCalls?.length || 0), 0)
        const totalErrors = this.sessions.reduce((sum, s) => sum + (s.errors?.length || 0), 0)
  
        return {
          total,
          active,
          completed,
          totalCalls,
          totalErrors,
        }
      }
  
      // Generate unique session ID
      generateSessionId() {
        return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      }
  
      // Load sessions from storage
      async loadSessions() {
        try {
          if (this.chrome) {
            const result = await this.chrome.storage.local.get([this.storageKey])
            if (result[this.storageKey]) {
              this.sessions = result[this.storageKey]
            }
          } else {
            // Fallback to localStorage
            const stored = localStorage.getItem(this.storageKey)
            if (stored) {
              this.sessions = JSON.parse(stored)
            }
          }
        } catch (error) {
          console.error("Error loading sessions:", error)
          this.sessions = []
        }
      }
  
      // Save sessions to storage
      saveSessions() {
        try {
          if (this.chrome) {
            this.chrome.storage.local.set({ [this.storageKey]: this.sessions })
          } else {
            // Fallback to localStorage
            localStorage.setItem(this.storageKey, JSON.stringify(this.sessions))
          }
        } catch (error) {
          console.error("Error saving sessions:", error)
        }
      }
  
      // Export session data
      exportSession(sessionId) {
        const session = this.loadSession(sessionId)
        if (!session) return null
  
        return {
          session,
          exportTime: new Date().toISOString(),
          version: "1.0",
        }
      }
  
      // Import session data
      importSession(sessionData) {
        if (!sessionData || !sessionData.session) {
          throw new Error("Invalid session data")
        }
  
        const session = sessionData.session
        // Generate new ID to avoid conflicts
        session.id = this.generateSessionId()
        session.imported = true
        session.importTime = Date.now()
  
        this.sessions.unshift(session)
        this.saveSessions()
  
        return session
      }
  
      // Cleanup old sessions
      cleanupOldSessions(maxAge = 7 * 24 * 60 * 60 * 1000) {
        // Default: 7 days
        const cutoff = Date.now() - maxAge
        const initialCount = this.sessions.length
  
        this.sessions = this.sessions.filter((session) => {
          // Keep sessions that are newer than cutoff or currently active
          return session.startTime > cutoff || !session.endTime
        })
  
        const removedCount = initialCount - this.sessions.length
        if (removedCount > 0) {
          this.saveSessions()
        }
  
        return removedCount
      }
  
      // Validate session data
      validateSession(session) {
        const required = ["id", "startTime"]
        const missing = required.filter((field) => !session[field])
  
        if (missing.length > 0) {
          throw new Error(`Session missing required fields: ${missing.join(", ")}`)
        }
  
        return true
      }
    }
  
    // Create global instance
    if (typeof window !== "undefined") {
      window.SessionManager = new SessionManager()
    }
  })()
  