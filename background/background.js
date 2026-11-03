// Background Service Worker for Switch Account
console.log("[Switch Account] Background service worker initialized.");

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Switch Account] Extension installed successfully.");
});
