import "./dist/worker/worker.js";

self.addEventListener('install', function(event) {
    console.log("Service worker installed");
    event.waitUntil(self.skipWaiting()); // Activate worker immediately
});

self.addEventListener('activate', function(event) {
    console.log("Service worker activated");
    event.waitUntil(self.clients.claim()); // Become available to all pages
});