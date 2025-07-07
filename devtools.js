// Create the SFCC Debugger panel in DevTools
chrome.devtools.panels.create("SFCC Debugger", null, "panel.html", (panel) => {
  console.log("SFCC Debugger panel created")
})
