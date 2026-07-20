function onLoad() {
	(function AttachmentInterceptor() {
		console.log("[AttachmentInterceptor] Initialization started");

		// Use capture=true so we run BEFORE any inline onclick handlers
		document.addEventListener(
			"click",
			(evt) => {
				const link = evt.target.closest("a");
				// Only intercept ServiceNow attachment links
				if (
					link &&
					link.href &&
					link.href.indexOf("/sys_attachment.do") !== -1
				) {
					evt.preventDefault();
					evt.stopPropagation();
					evt.stopImmediatePropagation();
					link.removeAttribute("onclick");
					const urlObj = new URL(link.href);
					const sysId = urlObj.searchParams.get("sys_id");
					if (!sysId) {
						console.error("No sys_id found in attachment URL");
						return;
					}
					openNutrientViewerFullscreen(sysId);
				}
			},
			true,
		);

		console.log("[AttachmentInterceptor] Capture-phase listener registered");

		// Function to open Nutrient viewer in fullscreen overlay
		function openNutrientViewerFullscreen(sysId) {
			console.log(
				"[AttachmentInterceptor] Opening fullscreen viewer for sys_id:",
				sysId,
			);
			createFullscreenViewer(sysId);
		}

		// Refresh attachments list using Ajax (called only once on close)
		function refreshAttachmentsList() {
			console.log(
				"[AttachmentInterceptor] Refreshing attachments list after viewer close",
			);

			// Simple page reload to refresh attachments
			// This happens only once when the viewer is closed
			window.location.reload();
		}

		// Create fullscreen overlay viewer
		function createFullscreenViewer(sysId) {
			// Remove existing viewer if present
			const existingViewer = document.getElementById(
				"nutrient-fullscreen-viewer",
			);
			if (existingViewer) {
				existingViewer.remove();
			}

			// Create fullscreen overlay
			const overlay = document.createElement("div");
			overlay.id = "nutrient-fullscreen-viewer";
			overlay.className = "nutrient-fullscreen-overlay";

			// Create iframe for the viewer (no header, full screen)
			const iframe = document.createElement("iframe");
			iframe.src = `/nutrient_pdf_viewer.do?sysparm_sys_id=${encodeURIComponent(sysId)}`;
			iframe.className = "nutrient-viewer-iframe";

			// Create loading overlay for parent
			const loadingOverlay = document.createElement("div");
			loadingOverlay.className = "parent-loading-overlay";
			loadingOverlay.innerHTML =
				'<div class="parent-loading-content">' +
				'<div class="parent-spinner"></div>' +
				'<div class="parent-loading-text">Loading document...</div>' +
				"</div>";

			// Assemble the overlay (no header - just iframe)
			overlay.appendChild(iframe);
			overlay.appendChild(loadingOverlay);

			// Add to body
			document.body.appendChild(overlay);

			// Show overlay with animation
			setTimeout(() => {
				overlay.classList.add("visible");
			}, 10);

			// ESC key handler
			const escHandler = (event) => {
				if (event.key === "Escape") {
					closeFullscreenViewer();
				}
			};
			document.addEventListener("keydown", escHandler);

			// Store escape handler for cleanup
			overlay._escHandler = escHandler;

			// Handle iframe load
			iframe.addEventListener("load", () => {
				console.log("[AttachmentInterceptor] Viewer loaded successfully");
				hideParentLoading(overlay);
				setupIframeCommunication(iframe, overlay);
			});

			console.log("[AttachmentInterceptor] Fullscreen viewer created");
		}

		// Setup communication between iframe and parent
		function setupIframeCommunication(iframe, overlay) {
			// Listen for messages from iframe
			const messageHandler = (event) => {
				// Verify origin for security
				if (event.origin !== window.location.origin) {
					return;
				}

				const data = event.data;
				if (!data || typeof data !== "object") {
					return;
				}

				console.log(
					"[AttachmentInterceptor] Received message from iframe:",
					data,
				);

				switch (data.type) {
					case "CLOSE_VIEWER":
						closeFullscreenViewer();
						break;

					case "DOCUMENT_SAVED":
						// Mark that we need to refresh when closing
						overlay._needsRefresh = true;
						break;

					case "SHOW_LOADING":
						showParentLoading(overlay, data.message);
						break;

					case "HIDE_LOADING":
						hideParentLoading(overlay);
						break;

					case "SHOW_NOTIFICATION":
						showParentNotification(data.message, data.notificationType);
						break;
				}
			};

			window.addEventListener("message", messageHandler);

			// Store message handler for cleanup
			overlay._messageHandler = messageHandler;
		}

		// Show loading in parent overlay
		function showParentLoading(overlay, message) {
			const loadingOverlay = overlay.querySelector(".parent-loading-overlay");
			const loadingText = overlay.querySelector(".parent-loading-text");

			if (loadingText && message) {
				loadingText.textContent = message;
			}

			if (loadingOverlay) {
				loadingOverlay.classList.add("show");
			}
		}

		// Hide loading in parent overlay
		function hideParentLoading(overlay) {
			const loadingOverlay = overlay.querySelector(".parent-loading-overlay");
			if (loadingOverlay) {
				loadingOverlay.classList.remove("show");
			}
		}

		// Show parent notification (modernized)
		function showParentNotification(message, type) {
			type = type || "info";

			const notification = document.createElement("div");
			notification.className = `parent-notification ${type}`;

			let icon = "";
			if (type === "success") {
				// icon = '<svg class="notification-icon" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>';
				icon =
					'<svg class="notification-icon" viewBox="0 0 24 24"><path d="M88.3636 222.612C76.0077 222.612 66 212.604 66 200.248C66 187.892 76.0077 177.885 88.3636 177.885C100.72 177.885 110.727 187.892 110.727 200.248C110.727 212.604 100.72 222.612 88.3636 222.612ZM312 177.885C299.644 177.885 289.636 187.892 289.636 200.248C289.636 212.604 299.644 222.612 312 222.612C324.356 222.612 334.363 212.604 334.363 200.248C334.363 187.892 324.356 177.885 312 177.885ZM100.149 254.994C90.6894 262.933 89.4483 277.045 97.3873 286.505C105.326 295.964 119.438 297.206 128.898 289.267C138.357 281.327 139.599 267.216 131.66 257.756C123.72 248.296 109.609 247.055 100.149 254.994ZM300.214 145.502C309.674 137.563 310.915 123.452 302.976 113.992C295.037 104.532 280.926 103.291 271.466 111.23C262.006 119.169 260.765 133.28 268.704 142.74C276.643 152.2 290.754 153.441 300.214 145.502ZM128.898 111.241C119.438 103.302 105.326 104.532 97.3873 114.003C89.4483 123.474 90.6783 137.574 100.149 145.513C109.62 153.452 123.72 152.222 131.66 142.751C139.599 133.28 138.369 119.18 128.898 111.241ZM300.214 254.994C290.754 247.055 276.643 248.285 268.704 257.756C260.765 267.216 261.995 281.327 271.466 289.267C280.926 297.206 295.037 295.976 302.976 286.505C310.915 277.045 309.685 262.933 300.214 254.994ZM243.109 207.069C233.649 199.13 219.537 200.36 211.598 209.831C203.659 219.302 204.889 233.402 214.36 241.341C223.831 249.28 237.931 248.05 245.871 238.579C253.81 229.108 252.58 215.008 243.109 207.069ZM186.003 159.155C176.543 151.216 162.432 152.446 154.493 161.917C146.554 171.388 147.784 185.488 157.255 193.427C166.726 201.366 180.826 200.136 188.765 190.665C196.704 181.194 195.474 167.094 186.003 159.155Z" fill="white"/></svg>';
			} else if (type === "error") {
				icon =
					'<svg class="notification-icon" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>';
			} else {
				icon =
					'<svg class="notification-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>';
			}

			// icon is a trusted static SVG constant; the message (from postMessage) goes in via textContent
			notification.innerHTML = icon;
			const textSpan = document.createElement("span");
			textSpan.textContent = message;
			notification.appendChild(textSpan);
			document.body.appendChild(notification);

			setTimeout(() => {
				notification.classList.add("show");
			}, 100);

			setTimeout(() => {
				notification.classList.remove("show");
				setTimeout(() => {
					notification.remove();
				}, 300);
			}, 3500);
		}

		// Close fullscreen viewer
		function closeFullscreenViewer() {
			const overlay = document.getElementById("nutrient-fullscreen-viewer");
			if (overlay) {
				// Check if we need to refresh (only if document was saved)
				const needsRefresh = overlay._needsRefresh || false;

				overlay.classList.remove("visible");

				// Remove event handlers
				if (overlay._escHandler) {
					document.removeEventListener("keydown", overlay._escHandler);
				}
				if (overlay._messageHandler) {
					window.removeEventListener("message", overlay._messageHandler);
				}

				setTimeout(() => {
					overlay.remove();

					// Refresh the page only once when viewer is closed
					// This ensures the latest attachments are shown
					if (needsRefresh) {
						console.log(
							"[AttachmentInterceptor] Refreshing page after document save",
						);
						refreshAttachmentsList();
					}
				}, 300);

				console.log("[AttachmentInterceptor] Fullscreen viewer closed");
			}
		}

		// Add CSS styles for fullscreen viewer (modernized, no header)
		function addViewerStyles() {
			const styleId = "nutrient-viewer-styles";
			if (document.getElementById(styleId)) return;

			const styles = document.createElement("style");
			styles.id = styleId;
			styles.textContent =
				".nutrient-fullscreen-overlay {" +
				"    position: fixed;" +
				"    top: 0;" +
				"    left: 0;" +
				"    right: 0;" +
				"    bottom: 0;" +
				"    background: rgba(0, 0, 0, 0.98);" +
				"    z-index: 999999;" +
				"    opacity: 0;" +
				"    visibility: hidden;" +
				"    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);" +
				"}" +
				".nutrient-fullscreen-overlay.visible {" +
				"    opacity: 1;" +
				"    visibility: visible;" +
				"}" +
				".nutrient-viewer-iframe {" +
				"    width: 100%;" +
				"    height: 100%;" +
				"    border: none;" +
				"    background: white;" +
				"}" +
				".parent-loading-overlay {" +
				"    position: absolute;" +
				"    top: 0;" +
				"    left: 0;" +
				"    right: 0;" +
				"    bottom: 0;" +
				"    background: linear-gradient(135deg, rgba(0, 126, 234, 0.95) 0%, rgba(118, 75, 162, 0.95) 100%);" +
				"    display: none;" +
				"    justify-content: center;" +
				"    align-items: center;" +
				"    z-index: 1000;" +
				"    backdrop-filter: blur(10px);" +
				"}" +
				".parent-loading-overlay.show {" +
				"    display: flex;" +
				"}" +
				".parent-loading-content {" +
				"    text-align: center;" +
				"    color: white;" +
				"}" +
				".parent-spinner {" +
				"    width: 50px;" +
				"    height: 50px;" +
				"    border: 3px solid rgba(255, 255, 255, 0.3);" +
				"    border-radius: 50%;" +
				"    border-top: 3px solid white;" +
				"    animation: parentSpin 1s linear infinite;" +
				"    margin: 0 auto 20px;" +
				"}" +
				"@keyframes parentSpin {" +
				"    0% { transform: rotate(0deg); }" +
				"    100% { transform: rotate(360deg); }" +
				"}" +
				".parent-loading-text {" +
				"    font-size: 18px;" +
				"    font-weight: 500;" +
				"    letter-spacing: 0.5px;" +
				"}" +
				".parent-notification {" +
				"    position: fixed;" +
				"    top: 30px;" +
				"    right: 30px;" +
				"    z-index: 10000001;" +
				"    padding: 16px 24px;" +
				"    border-radius: 12px;" +
				"    color: white;" +
				"    font-weight: 500;" +
				"    display: flex;" +
				"    align-items: center;" +
				"    gap: 12px;" +
				"    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);" +
				"    transform: translateX(calc(100% + 40px));" +
				"    transition: all 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55);" +
				"    max-width: 400px;" +
				'    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;' +
				"}" +
				".parent-notification.show {" +
				"    transform: translateX(0);" +
				"}" +
				".parent-notification .notification-icon {" +
				"    width: 24px;" +
				"    height: 24px;" +
				"    fill: currentColor;" +
				"    flex-shrink: 0;" +
				"}" +
				".parent-notification.success {" +
				"    background: linear-gradient(135deg, #00b894, #00cec9);" +
				"}" +
				".parent-notification.error {" +
				"    background: linear-gradient(135deg, #ff6b6b, #ee5a6f);" +
				"}" +
				".parent-notification.info {" +
				"    background: linear-gradient(135deg, #74b9ff, #0984e3);" +
				"}" +
				".parent-notification.warning {" +
				"    background: linear-gradient(135deg, #fdcb6e, #f39c12);" +
				"}";

			document.head.appendChild(styles);
		}

		// Initialize styles
		addViewerStyles();
	})();
}
