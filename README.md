# SFCC Checkout Debugger

A Chrome extension for debugging Salesforce Commerce Cloud (SFCC) checkout flows by monitoring network calls and correlating them with Salesforce debug logs.

![Checkout Debugger Panel](/assets/Checkout-Panel.png "Checkout Debugger Panel")

## Features

### 🔍 **Real-time Network Monitoring**
- Automatically detects and captures Commerce Cloud API calls
- Monitors checkout flow progression (address, payment, delivery, taxes)
- Tracks checkout requirements completion status
- Displays detailed request/response data

### 🔗 **Salesforce Integration**
- Connect to multiple Salesforce orgs (Production & Sandbox)
- Retrieve and parse Apex debug logs
- Correlate network calls with Salesforce logs
- Support for session-based authentication

### 📊 **Session Management**
- Create and manage debugging sessions
- Auto-save session data during checkout flows
- Load previous sessions for analysis
- Export session data for sharing

### 🎯 **Smart Correlation**
- Intelligent matching of network calls with Salesforce logs
- Time-based correlation with configurable windows
- Commerce Cloud specific pattern recognition
- Confidence scoring for correlations

### 🚀 **User-Friendly Interface**
- Floating debug tab on checkout pages
- Collapsible side panel with organized tabs
- Real-time status indicators
- Filtering and search capabilities

## Installation

### Manual Installation (Development)
![Installing Checkout Debugger](/assets/Installing-Checkout-Debugger.mov "Installing Checkout Debugger")
1. Download the repo from the browser - https://github.com/Saltbox-Mgmt/checkout-extension

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable "Developer mode" in the top right corner

4. Click "Load unpacked" and select the project directory

5. The extension should now appear in your extensions list

## Quick Start

### 1. Setup Salesforce Connection

1. **Open the extension popup** by clicking the extension icon in Chrome
2. **Click "Setup Connection"** to configure your first Salesforce org
3. **Choose instance type**: Production or Sandbox
4. **Enter your Salesforce instance URL**:
   - Production: `https://yourorg.my.salesforce.com`
   - Sandbox: `https://yourorg--sandboxname.sandbox.my.salesforce.com`

### 2. Get Your Session ID

**Method 1: Automatic Cookie Detection**
1. Make sure you're logged into Salesforce in the same browser
2. Click "Find Session Cookies" in the extension popup
3. Click "Use This Session" for your desired org

**Method 2: Manual Extraction**
1. Open your Salesforce org in a new tab
2. Open Developer Tools (F12)
3. Go to **Application** → **Cookies** → Select your Salesforce domain
4. Find the `sid` cookie and copy its value
5. Paste it into the "Session ID" field in the extension

### 3. Start Debugging

1. **Navigate to a checkout page** in your Commerce Cloud storefront
2. **Look for the floating "🛒 Debug" tab** in the bottom-right corner
3. **Click the tab** to open the debug panel
4. **Perform checkout actions** to see network calls captured in real-time
5. **Click "Sync SF"** to retrieve correlated Salesforce logs

## Usage Guide

### Network Monitoring

![Network Overview](/assets/Network.png "Network Overview")

The extension automatically monitors these checkout stages:
- **Address**: Shipping and billing address updates
- **Delivery Method**: Shipping method selection
- **Inventory**: Product availability checks
- **Taxes**: Tax calculation calls
- **Payment**: Payment processing
- **Order Placement**: Final order submission

### Session Management

![Session Overview](/assets/Session.png "Sessions Overview")

**Creating Sessions:**
- Sessions are automatically created when a checkout ID is detected
- Manual session creation via the "Sessions" tab
- Sessions capture all network calls, errors, and Salesforce logs

**Managing Sessions:**
- **Load**: Switch to a previous debugging session
- **Export**: Download session data as JSON
- **Delete**: Remove unwanted sessions

### Correlation Analysis

The extension correlates network calls with Salesforce logs based on:
- **Time proximity** (configurable time windows)
- **Content matching** (URLs, request/response data)
- **Error correlation** (failed calls with error logs)
- **Commerce Cloud patterns** (checkout, payment, cart events)

## Configuration

### Multiple Salesforce Orgs

You can configure multiple Salesforce orgs:

1. **Click "Manage Accounts"** in the extension popup
2. **Add accounts** for different orgs (production, sandbox, etc.)
3. **Switch between accounts** using the dropdown selector
4. **Edit or delete** accounts as needed

### Time Windows

Correlation time windows can be adjusted in the correlation engine:
- **Payment correlations**: 30 seconds (default)
- **Delivery correlations**: 20 seconds (default)
- **General correlations**: 15 seconds (default)

## Troubleshooting

### Common Issues

**"Chrome extension APIs not available"**
- Ensure you're using a supported Chrome version
- Try reloading the extension
- Check that the extension has proper permissions

**"Not connected to Salesforce"**
- Verify your session ID is current and valid
- Check that your Salesforce org allows API access
- Ensure you're logged into Salesforce in the same browser

**"No network calls captured"**
- Confirm you're on a Commerce Cloud checkout page
- Check that the floating debug tab is visible
- Try refreshing the page and performing checkout actions

**"No Salesforce logs found"**
- Ensure debug logging is enabled in your Salesforce org
- Check that you have sufficient API permissions
- Verify the time window includes your checkout activities

### Debug Information

Enable detailed logging by opening Chrome DevTools (F12) and checking the Console tab while using the extension.

## Development

### Project Structure

```
├── manifest.json              # Extension manifest
├── popup.html                 # Extension popup interface
├── popup.js                   # Popup logic and Salesforce connection
├── content.js                 # Main content script and UI injection
├── background.js              # Service worker for extension events
├── sidepanel.css             # Styles for the debug panel
└── analyzer-files/           # Core analysis modules
    ├── checkout-call-analyzer.js    # Network call analysis
    ├── correlation-engine.js        # Log correlation logic
    ├── network-interceptor.js       # Network monitoring
    ├── salesforce-api.js           # Salesforce API integration
    ├── salesforce-logger.js        # Log retrieval and parsing
    └── session-manager.js          # Session management
```

### Key Components

- **PopupController**: Manages Salesforce connections and account configuration
- **SFCCMonitor**: Main content script for network monitoring and UI
- **CheckoutCallAnalyzer**: Analyzes and categorizes network calls
- **CorrelationEngine**: Matches network calls with Salesforce logs
- **SessionManager**: Handles debugging session lifecycle
- **SalesforceAPI**: Interfaces with Salesforce REST APIs

### Building and Testing

1. **Make changes** to the source files
2. **Reload the extension** in `chrome://extensions/`
3. **Test on Commerce Cloud checkout pages**
4. **Check browser console** for debug information

### Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes and test thoroughly
4. Commit your changes: `git commit -am 'Add feature'`
5. Push to the branch: `git push origin feature-name`
6. Submit a pull request

## Permissions

The extension requires these permissions:
- **storage**: Save configuration and session data
- **activeTab**: Access current tab for network monitoring
- **scripting**: Inject monitoring scripts
- **tabs**: Manage tab interactions
- **webRequest**: Monitor network requests
- **cookies**: Access Salesforce session cookies
- **Host permissions**: Access Salesforce and Commerce Cloud domains

## Privacy

- **No data is sent to external servers** (except Salesforce APIs you configure)
- **Session data is stored locally** in Chrome's extension storage
- **Salesforce credentials are encrypted** and stored securely
- **Network data is only processed locally** for debugging purposes

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For issues, questions, or contributions:
- **GitHub Issues**: [Report bugs or request features](https://github.com/Saltbox-Mgmt/checkout-extension/issues)
- **Documentation**: Check this README and inline code comments
- **Salesforce Trailblazer Community**: Search for Commerce Cloud debugging topics

## Changelog

### Version 1.0.0
- Initial release
- Network call monitoring and analysis
- Salesforce log integration
- Session management
- Multi-org support
- Correlation engine
- Export functionality

```