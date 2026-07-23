/**
 * =============================================================================
 * NUTRIENT DOCUMENT VIEWER - CLIENT SCRIPT
 * =============================================================================
 * Purpose: Document viewer with digital signing capabilities
 * Author: ServiceNow Development Team
 * Version: 1.1
 * Target: ES2020+ (modern browsers)
 * ServiceNow Standards: Compliant
 * UI Page (Jelly): use string concatenation, NOT backtick template literals.
 *   Jelly evaluates template-literal placeholders server-side and blanks them
 *   before the script reaches the browser. const/let/arrow functions are safe.
 * =============================================================================
 */

// =============================================================================
// SERVICENOW COMPATIBILITY LAYER
// =============================================================================
(function() {
    console.log('STEP 1: Disabling ServiceNow interference');

    // Store original functions for restoration
    window._originalPrototype = window.Prototype;
    window._originalEffect = window.Effect;
    window._originaljQuery = window.jQuery;

    // Temporarily disable problematic ServiceNow libraries
    if (window.Prototype) {
        window.Prototype = null;
    }

    if (window.Effect) {
        window.Effect = null;
    }

    if (window.jQuery && window.jQuery.fn) {
        // Store original jQuery functions
        window._jQueryOriginal = {
            animate: window.jQuery.fn.animate,
            fadeIn: window.jQuery.fn.fadeIn,
            fadeOut: window.jQuery.fn.fadeOut
        };

        // Replace with no-ops to prevent conflicts
        window.jQuery.fn.animate = function() {
            return this;
        };
        window.jQuery.fn.fadeIn = function() {
            return this.show();
        };
        window.jQuery.fn.fadeOut = function() {
            return this.hide();
        };
    }

    console.log('STEP 2: ServiceNow interference disabled');
})();

// =============================================================================
// CONFIGURATION & GLOBAL VARIABLES
// =============================================================================

// Configuration constants
const CONFIG = {
    debug: true,
    supportedFormats: ['pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'jpg', 'jpeg', 'png', 'tiff', 'gif', 'bmp'],
    maxFileSize: 100 * 1024 * 1024, // 100MB limit
    apiTimeout: 30000 // 30 seconds
};

// Global state variables
let attachmentSysId = null;
let nutrientInstance = null;
let attachmentInfo = null;
let saveInProgress = false;
let hasChanges = false;
let documentsigned = false;

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Extract URL parameter value
 * @param {string} name - Parameter name
 * @returns {string|null} Parameter value or null
 */
function getUrlParameter(name) {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get(name);
    } catch (error) {
        console.error('Error parsing URL parameters:', error);
        return null;
    }
}

/**
 * Update loading status message
 * @param {string} message - Status message to display
 */
function updateStatus(message) {
    console.log('STATUS: ' + message);

    try {
        const loadingDiv = document.getElementById('loading-status');
        if (loadingDiv) {
            const messageDiv = loadingDiv.querySelector('div:last-child');
            if (messageDiv) {
                messageDiv.textContent = message;
            }
        }
    } catch (error) {
        console.error('Error updating status:', error);
    }
}

/**
 * Display error message to user
 * @param {string} title - Error title
 * @param {string} message - Error message
 */
function showError(title, message) {
    console.error('ERROR: ' + title + ' - ' + message);

    try {
        const container = document.getElementById('nutrient-container');
        if (container) {
            // Build via DOM + textContent so title/message can never inject markup
            const box = document.createElement('div');
            box.className = 'error-container';
            const heading = document.createElement('h3');
            heading.textContent = title;
            const para = document.createElement('p');
            para.textContent = message;
            box.appendChild(heading);
            box.appendChild(para);
            container.innerHTML = '';
            container.appendChild(box);
        }
    } catch (error) {
        console.error('Error displaying error message:', error);
    }
}

/**
 * Format file size for display
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted file size
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Check if file format is supported
 * @param {string} fileName - File name to check
 * @returns {boolean} True if supported
 */
function isSupportedFormat(fileName) {
    if (!fileName) return false;

    const extension = fileName.split('.').pop().toLowerCase();
    const isSupported = CONFIG.supportedFormats.indexOf(extension) !== -1;

    console.log('FORMAT CHECK: ' + fileName + ' (' + extension + ') - Supported: ' + isSupported);
    return isSupported;
}

/**
 * Convert Blob to ArrayBuffer
 * @param {Blob} blob - Blob to convert
 * @returns {Promise<ArrayBuffer>} Promise resolving to ArrayBuffer
 */
function blobToArrayBuffer(blob) {
    console.log('STEP 6: Converting blob to ArrayBuffer - Size: ' + blob.size + ' bytes');

    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
            console.log('STEP 7: Conversion complete - ByteLength: ' + reader.result.byteLength);
            resolve(reader.result);
        };

        reader.onerror = () => {
            reject(new Error('Failed to convert blob to ArrayBuffer'));
        };

        reader.readAsArrayBuffer(blob);
    });
}

/**
 * Convert ArrayBuffer to Base64 string
 * @param {ArrayBuffer} buffer - Buffer to convert
 * @returns {string} Base64 encoded string
 */
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);

    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }

    return window.btoa(binary);
}

// =============================================================================
// ATTACHMENT MANAGEMENT
// =============================================================================

/**
 * Load attachment information from server
 */
function loadAttachmentInfo() {
    console.log('STEP 4: Loading attachment info for sys_id: ' + attachmentSysId);
    updateStatus('Getting document information...');

    // Restore GlideAjax temporarily for the API call
    if (window._originalPrototype && typeof GlideAjax === 'undefined') {
        window.Prototype = window._originalPrototype;
    }

    if (typeof GlideAjax === 'undefined') {
        console.error('ERROR: GlideAjax is not available');
        showError('ServiceNow API Error', 'GlideAjax is not available.');
        return;
    }

    const ga = new GlideAjax('NutrientAttachmentHelper');
    ga.addParam('sysparm_name', 'getAttachmentInfo');
    ga.addParam('sysparm_sys_id', attachmentSysId);

    ga.getXML((response) => {
        console.log('STEP 4a: GlideAjax response received');

        // Disable Prototype again after API call
        window.Prototype = null;

        try {
            let responseText = response.responseText;

            if (!responseText && response.responseXML) {
                const resultElements = response.responseXML.getElementsByTagName('result');
                if (resultElements.length > 0) {
                    const valueAttr = resultElements[0].getAttribute('value');
                    if (valueAttr) {
                        responseText = valueAttr;
                    }
                }
            }

            if (!responseText) {
                throw new Error('Empty response from server');
            }

            attachmentInfo = JSON.parse(responseText);
            console.log('STEP 4b: File Name:', attachmentInfo.fileName);
            console.log('Size:', attachmentInfo.sizeBytes + ' bytes');

            if (!attachmentInfo.success) {
                showError('Document Not Found', attachmentInfo.error || 'Document not found.');
                return;
            }

            if (!isSupportedFormat(attachmentInfo.fileName)) {
                const extension = attachmentInfo.fileName.split('.').pop();
                showError('Unsupported Format', 'Format (' + extension + ') not supported.');
                return;
            }

            // Check file size limit
            if (attachmentInfo.sizeBytes > CONFIG.maxFileSize) {
                showError('File Too Large', 'File size exceeds maximum limit of ' + formatFileSize(CONFIG.maxFileSize));
                return;
            }

            loadDocument();

        } catch (error) {
            console.error('ERROR: Parse failed - ' + error.message);
            showError('Server Error', 'Failed to get document information.');
        }
    });
}

/**
 * Load document content from server
 */
function loadDocument() {
    console.log('STEP 5: Loading document blob');
    updateStatus('Loading document content...');

    const attachmentUrl = '/sys_attachment.do?sys_id=' + attachmentSysId;
    const headers = {};

    // Add security token if available
    if (window.g_ck) {
        headers['X-UserToken'] = window.g_ck;
    }

    fetch(attachmentUrl, {
            method: 'GET',
            headers: headers,
            credentials: 'same-origin'
        })
        .then((response) => {
            console.log('STEP 5a: Fetch response - Status: ' + response.status);

            if (!response.ok) {
                return response.text().then((errorText) => {
                    throw new Error('HTTP ' + response.status + ': ' + errorText);
                });
            }

            return response.blob();
        })
        .then((blob) => {
            console.log('STEP 5b: Blob received - Size: ' + blob.size + ' bytes');

            if (blob.size === 0) {
                throw new Error('Document is empty');
            }

            console.log('STEP 8: Initializing Nutrient');
            return blobToArrayBuffer(blob);
        })
        .then((arrayBuffer) => {
            initializeNutrient(arrayBuffer);
        })
        .catch((error) => {
            console.error('ERROR: Load failed - ' + error.message);
            showError('Load Failed', 'Failed to load document: ' + error.message);
        });
}

// =============================================================================
// NUTRIENT VIEWER INITIALIZATION
// =============================================================================

/**
 * Initialize Nutrient viewer with document
 * @param {ArrayBuffer} documentArrayBuffer - Document data
 */
function initializeNutrient(documentArrayBuffer) {
    console.log('STEP 8a: ArrayBuffer size: ' + documentArrayBuffer.byteLength + ' bytes');
    updateStatus('Initializing viewer...');

    // Initialize global variables
    if (typeof documentsigned === 'undefined') {
        window.documentsigned = false;
    }

    // Clean up existing instance if needed
    if (nutrientInstance && hasChanges === true && documentsigned === true) {
        window.NutrientViewer.unload("#nutrient");
        console.log('Container unloaded - need to reload new document');
    }

    // Setup container and floating elements
    setupViewerContainer();

    // Check if NutrientViewer is available
    if (typeof window.NutrientViewer === 'undefined') {
        console.error('ERROR: NutrientViewer not available');
        showError('Viewer Error', 'Nutrient Viewer library not loaded.');
        return;
    }

    // Initialize viewer
    const viewerConfig = {
        // Domain-locked Web SDK license key. Paste your instance-matched key here
        // (see classic-ui/README.md §2). Left blank in source so no key is committed.
        licenseKey: "",
        container: "#nutrient",
        document: documentArrayBuffer,
        useCDN: true,
        toolbarItems: [...NutrientViewer.defaultToolbarItems, ],
        trustedCAsCallback: loadTrustedCertificates
    };

    console.log('STEP 8b: Loading with NutrientViewer');

    window.NutrientViewer.load(viewerConfig)
        .then((instance) => {
            nutrientInstance = instance;
            console.log('STEP 9: SUCCESS - Nutrient loaded');
            console.log('Document: ' + (attachmentInfo ? attachmentInfo.fileName : 'Unknown'));
            console.log('Pages: ' + (instance.totalPageCount || 'Unknown'));
            setupViewerInstance(instance);
            console.log('STEP 10: Ready for use');
        })
        .catch((error) => {
            console.error('ERROR: Nutrient failed - ' + error.message);
            showError('Viewer Error', 'Failed to initialize: ' + error.message);
        });
}

/**
 * Setup viewer container and floating elements
 */
function setupViewerContainer() {
    const container = document.getElementById('nutrient-container');
    container.innerHTML = '<div id="nutrient" style="width: 100%; height: 100vh;"></div>';
}

/**
 * Setup viewer instance with custom functionality
 * @param {Object} instance - Nutrient viewer instance
 */
function setupViewerInstance(instance) {
    // Enable signature validation display
    instance.setViewState((viewState) => {
        return viewState.set(
            "showSignatureValidationStatus",
            window.NutrientViewer.ShowSignatureValidationStatusMode.IF_SIGNED
        );
    });

    // Add custom toolbar buttons
    setupCustomToolbarButtons(instance);

    // Setup event listeners
    setupEventListeners(instance);

    // Check for existing signatures
    displaySignatureValidationInfo(instance);

    // Set document title
    if (attachmentInfo) {
        document.title = 'Nutrient Viewer - ' + attachmentInfo.fileName;
    }
}

/**
 * Close the viewer
 */
function closeViewer() {
    if (window.parent && window.parent !== window) {
        // Send message to parent to close
        window.parent.postMessage({
            type: 'CLOSE_VIEWER'
        }, '*');
    } else {
        window.close();
    }
}

// =============================================================================
// CUSTOM TOOLBAR BUTTONS
// =============================================================================

/**
 * Setup custom toolbar buttons
 * @param {Object} instance - Nutrient viewer instance
 */
function setupCustomToolbarButtons(instance) {
    const customButtons = [];

    // Digital sign button
    customButtons.push(createDigitalSignButton(instance));

    // Save button
    customButtons.push(createSaveButton(instance));

    // Window close button
    customButtons.push(createCloseButton());

    // Add buttons to toolbar
    instance.setToolbarItems((items) => {
        return items.concat(customButtons);
    });

    // Rearranging the toolbar items

    instance.setToolbarItems((items) => {
        items.splice(32, 0, {
            type: "form-creator"
        });
        items.splice(33, 0, {
            type: "content-editor"
        });
        items.splice(34, 0, {
            type: "document-editor"
        });
        return items;
    });
    console.log("Final Toolbar Item list: ", instance.toolbarItems);
    nutrientInstance.setToolbarItems((items) => {
        items.splice(21, 0, items.splice(43, 1)[0]);
        return items;
    });
}

/**
 * Create save document button
 * @param {Object} instance - Nutrient viewer instance
 * @returns {Object} Save button configuration
 */
function createSaveButton(instance) {
    return {
        type: "custom",
        id: "save-document",
        title: "Save Document",
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="10" viewBox="0 0 28 10" fill="none"><path d="M24.6121 9.35059C23.991 9.35059 23.4578 9.21777 23.0125 8.95215C22.5671 8.68262 22.2234 8.30176 21.9812 7.80957C21.7429 7.31738 21.6238 6.73535 21.6238 6.06348V6.05762C21.6238 5.39355 21.7429 4.81348 21.9812 4.31738C22.2234 3.82129 22.5632 3.43457 23.0007 3.15723C23.4421 2.87988 23.9578 2.74121 24.5476 2.74121C25.1414 2.74121 25.6511 2.87402 26.0769 3.13965C26.5066 3.40527 26.8367 3.77832 27.0671 4.25879C27.2976 4.73535 27.4128 5.29395 27.4128 5.93457V6.37988H22.2683V5.47168H26.78L26.1707 6.31543V5.80566C26.1707 5.35254 26.1003 4.97754 25.9597 4.68066C25.823 4.37988 25.6335 4.15527 25.3914 4.00684C25.1492 3.8584 24.8699 3.78418 24.5535 3.78418C24.2371 3.78418 23.9539 3.8623 23.7039 4.01855C23.4578 4.1709 23.2625 4.39746 23.1179 4.69824C22.9773 4.99902 22.907 5.36816 22.907 5.80566V6.31543C22.907 6.7334 22.9773 7.09082 23.1179 7.3877C23.2585 7.68457 23.4578 7.91113 23.7156 8.06738C23.9773 8.22363 24.2859 8.30176 24.6414 8.30176C24.9148 8.30176 25.1492 8.26465 25.3445 8.19043C25.5437 8.1123 25.7058 8.0166 25.8308 7.90332C25.9597 7.79004 26.0476 7.67871 26.0945 7.56934L26.1179 7.52246H27.3484L27.3367 7.5752C27.282 7.78613 27.1863 7.99707 27.0496 8.20801C26.9128 8.41504 26.7312 8.60449 26.5046 8.77637C26.282 8.94824 26.0125 9.08691 25.696 9.19238C25.3835 9.29785 25.0222 9.35059 24.6121 9.35059Z" fill="blue"/><path d="M17.1467 9.22754L14.844 2.86426H16.1975L17.7854 7.93848H17.8792L19.4612 2.86426H20.803L18.5061 9.22754H17.1467Z" fill="blue"/><path d="M10.4668 9.33301C10.0645 9.33301 9.70312 9.25684 9.38281 9.10449C9.06641 8.94824 8.81641 8.72754 8.63281 8.44238C8.44922 8.15723 8.35742 7.82324 8.35742 7.44043V7.42871C8.35742 7.0459 8.44922 6.71973 8.63281 6.4502C8.82031 6.18066 9.08984 5.96973 9.44141 5.81738C9.79688 5.66113 10.2266 5.56738 10.7305 5.53613L13.0801 5.39551V6.29199L10.9062 6.43262C10.4688 6.45996 10.1465 6.55371 9.93945 6.71387C9.73242 6.87012 9.62891 7.09082 9.62891 7.37598V7.3877C9.62891 7.67676 9.74023 7.90527 9.96289 8.07324C10.1855 8.2373 10.4668 8.31934 10.8066 8.31934C11.123 8.31934 11.4043 8.25684 11.6504 8.13184C11.9004 8.00293 12.0957 7.83105 12.2363 7.61621C12.377 7.39746 12.4473 7.15137 12.4473 6.87793V4.87402C12.4473 4.52246 12.3379 4.25488 12.1191 4.07129C11.9043 3.88379 11.584 3.79004 11.1582 3.79004C10.8027 3.79004 10.5117 3.85254 10.2852 3.97754C10.0625 4.10254 9.91406 4.27832 9.83984 4.50488L9.82812 4.52246H8.60352L8.60938 4.48145C8.66016 4.12988 8.79883 3.8252 9.02539 3.56738C9.25586 3.30566 9.55664 3.10254 9.92773 2.95801C10.3027 2.81348 10.7305 2.74121 11.2109 2.74121C11.7461 2.74121 12.1992 2.82715 12.5703 2.99902C12.9453 3.16699 13.2285 3.41113 13.4199 3.73145C13.6152 4.04785 13.7129 4.42871 13.7129 4.87402V9.22754H12.4473V8.3252H12.3535C12.2285 8.54004 12.0723 8.72363 11.8848 8.87598C11.6973 9.02441 11.4844 9.1377 11.2461 9.21582C11.0078 9.29395 10.748 9.33301 10.4668 9.33301Z" fill="blue"/><path d="M3.84521 9.43262C3.2085 9.43262 2.65381 9.33301 2.18115 9.13379C1.7085 8.93066 1.33545 8.64941 1.06201 8.29004C0.788574 7.93066 0.632324 7.51465 0.593262 7.04199L0.587402 6.96582H1.88232L1.88818 7.03027C1.91553 7.28418 2.01514 7.50488 2.18701 7.69238C2.36279 7.87988 2.59717 8.02637 2.89014 8.13184C3.18701 8.2373 3.5249 8.29004 3.90381 8.29004C4.25928 8.29004 4.57568 8.2334 4.85303 8.12012C5.13037 8.00684 5.34717 7.85059 5.50342 7.65137C5.66357 7.45215 5.74365 7.22363 5.74365 6.96582V6.95996C5.74365 6.63574 5.62061 6.36621 5.37451 6.15137C5.12842 5.93652 4.72607 5.76855 4.16748 5.64746L3.2417 5.4541C2.38623 5.27051 1.76318 4.97949 1.37256 4.58105C0.981934 4.17871 0.786621 3.66504 0.786621 3.04004V3.03418C0.790527 2.5459 0.921387 2.11621 1.1792 1.74512C1.44092 1.37402 1.80225 1.08496 2.26318 0.87793C2.72412 0.670898 3.25342 0.567383 3.85107 0.567383C4.44873 0.567383 4.97021 0.670898 5.41553 0.87793C5.86475 1.08105 6.21826 1.3584 6.47607 1.70996C6.73779 2.06152 6.88428 2.45801 6.91553 2.89941L6.92139 2.97559H5.63818L5.62646 2.89941C5.59131 2.66895 5.49561 2.46387 5.33936 2.28418C5.18701 2.10449 4.98193 1.96387 4.72412 1.8623C4.47021 1.75684 4.17334 1.70605 3.8335 1.70996C3.50537 1.70996 3.2124 1.76074 2.95459 1.8623C2.69678 1.95996 2.4917 2.10254 2.33936 2.29004C2.19092 2.47754 2.1167 2.7041 2.1167 2.96973V2.97559C2.1167 3.28809 2.23584 3.5498 2.47412 3.76074C2.71631 3.96777 3.10889 4.12988 3.65186 4.24707L4.57764 4.45215C5.16748 4.57715 5.646 4.74316 6.01318 4.9502C6.38037 5.15723 6.64795 5.41309 6.81592 5.71777C6.98779 6.01855 7.07373 6.37793 7.07373 6.7959V6.80176C7.07373 7.34082 6.94092 7.80762 6.67529 8.20215C6.41357 8.59277 6.04053 8.89551 5.55615 9.11035C5.07178 9.3252 4.50146 9.43262 3.84521 9.43262Z" fill="blue"/></svg>',
        onPress: () => {
            handleSaveDocument(instance);
        }
    };
}

/**
 * Create digital sign button
 * @param {Object} instance - Nutrient viewer instance
 * @returns {Object} Digital sign button configuration
 */
function createDigitalSignButton(instance) {
    return {
        type: "custom",
        id: "digitally-sign",
        title: "Digitally Sign",
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 24 24" style="color: var(--bui-color-icon-primary);"><path d="M16.32 10.318c.29-.29.29-.77 0-1.06a.754.754 0 0 0-1.06 0l-4.72 4.72-2.26-2.26a.754.754 0 0 0-1.06 0c-.29.29-.29.77 0 1.06l3.32 3.32zm5.37 1.79a.22.22 0 0 1 0-.22l1.02-2.09c.42-.85.08-1.87-.75-2.32l-2.06-1.09c-.07-.03-.11-.1-.13-.17l-.4-2.3a1.75 1.75 0 0 0-1.97-1.43l-2.3.33c-.08.01-.16-.01-.21-.07l-1.67-1.62a1.77 1.77 0 0 0-2.44 0l-1.67 1.62c-.05.06-.13.08-.21.07l-2.3-.33c-.94-.13-1.81.5-1.97 1.43l-.4 2.3c-.02.07-.06.14-.13.17l-2.06 1.09c-.83.45-1.17 1.47-.75 2.32l1.02 2.09c.04.07.04.15 0 .22l-1.02 2.09c-.42.85-.08 1.87.75 2.32l2.06 1.09c.07.03.11.1.13.17l.4 2.3c.16.93 1.03 1.56 1.97 1.43l2.3-.33c.08-.01.16.01.21.07l1.67 1.62c.68.65 1.76.65 2.44 0l1.67-1.62c.05-.06.13-.08.21-.07l2.3.33c.94.13 1.81-.5 1.97-1.43l.4-2.3c.02-.07.06-.14.13-.17l2.06-1.09c.83-.45 1.17-1.47.75-2.32zm-1.35.66 1.02 2.09c.06.12.01.27-.1.33l-2.06 1.09c-.48.25-.81.71-.9 1.24l-.41 2.3c-.02.13-.14.22-.28.2l-2.3-.32c-.54-.08-1.08.09-1.46.47l-1.68 1.62c-.09.09-.25.09-.34 0l-1.68-1.62c-.38-.38-.92-.55-1.46-.47l-2.3.32a.24.24 0 0 1-.28-.2l-.41-2.3a1.72 1.72 0 0 0-.9-1.24l-2.06-1.09a.254.254 0 0 1-.1-.33l1.02-2.09c.24-.49.24-1.05 0-1.54l-1.02-2.09a.254.254 0 0 1 .1-.33l2.06-1.09c.48-.25.81-.71.9-1.24l.41-2.3c.02-.13.14-.22.28-.2l2.3.32c.54.08 1.08-.09 1.46-.47l1.68-1.62c.09-.09.25-.09.34 0l1.68 1.62c.38.38.92.55 1.46.47l2.3-.32c.14-.02.26.07.28.2l.41 2.3c.09.53.42.99.9 1.24l2.06 1.09c.11.06.16.21.1.33l-1.02 2.09c-.24.49-.24 1.05 0 1.54"></path></svg>',
        onPress: () => {
            handleDigitalSign(instance);
        }
    };
}

function createCloseButton(instance) {
    return {
        type: "custom",
        id: "floating-close-btn",
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 24 24" style="color: var(--bui-color-icon-primary);"><path fill-rule="evenodd" d="M12 23c6.075 0 11-4.925 11-11S18.075 1 12 1 1 5.925 1 12s4.925 11 11 11M9.03 7.97a.75.75 0 0 0-1.06 1.06L10.94 12l-2.97 2.97a.75.75 0 1 0 1.06 1.06L12 13.06l2.97 2.97a.75.75 0 1 0 1.06-1.06L13.06 12l2.97-2.97a.75.75 0 0 0-1.06-1.06L12 10.94z" clip-rule="evenodd"></path></svg>',
        onPress: (e) => {
            handleCloseDocument(e);
        }
    };
}

// =============================================================================
// DOCUMENT OPERATIONS
// =============================================================================

/**
 * Handle document save operation
 * @param {Object} instance - Nutrient viewer instance
 */
function handleSaveDocument(instance) {
    if (saveInProgress) {
        showNotification("Save already in progress...", "warning");
        return;
    }

    saveInProgress = true;
    showNotification("Saving document...", "info", 0); // Persistent notification

    // Generate new filename
    const originalFileName = attachmentInfo.fileName;
    const newPdfFileName = generatePdfFileName(originalFileName);

    const params = new URLSearchParams({
        table_name: attachmentInfo.tableName,
        table_sys_id: attachmentInfo.tableId,
        file_name: newPdfFileName
    });

    instance.exportPDF()
        .then((arrayBuffer) => {
            const apiUrl = '/api/now/attachment/file?' + params.toString();
            return fetch(apiUrl, {
                method: "POST",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/pdf",
                    "X-UserToken": window.g_ck
                },
                body: arrayBuffer
            });
        })
        .then((response) => {
            if (!response.ok) {
                throw new Error('HTTP error! status: ' + response.status);
            }
            return response.json();
        })
        .then((jsonResponse) => {
            if (jsonResponse.result && jsonResponse.result.sys_id) {
                const newId = jsonResponse.result.sys_id;
                return deleteOldAttachment().then(() => {
                    attachmentSysId = newId;
                    hideAllNotifications();
                    showNotification("Document saved successfully!", "success", 4000);
                    hasChanges = false;

                    // Notify parent
                    notifyParent('DOCUMENT_SAVED', {
                        newSysId: newId
                    });
                });
            } else {
                throw new Error("No sys_id found in the response");
            }
        })
        .catch((error) => {
            console.error("Error during save operation:", error);
            hideAllNotifications();
            showNotification('Failed to save: ' + error.message, "error", 5000);
        })
        .finally(() => {
            saveInProgress = false;
        });
}

// =============================================================================
// DOCUMENT CLOSE OPERATIONS
// =============================================================================

/**
 * Handle document close operation
 * @param {Object} e - Dom event
 */
function handleCloseDocument(e) {
    if (e && typeof e.preventDefault === 'function' && typeof e.stopPropagation === 'function') {
        e.preventDefault();
        e.stopPropagation();
    }
    if (window.parent && window.parent !== window) {
        window.parent.postMessage({
            type: 'CLOSE_VIEWER'
        }, '*');
    } else {
        window.close();
    }
}

/**
 * Generate PDF filename from original filename
 * @param {string} originalFileName - Original filename
 * @returns {string} PDF filename
 */
function generatePdfFileName(originalFileName) {
    const lastDotIndex = originalFileName.lastIndexOf('.');
    if (lastDotIndex !== -1) {
        const nameWithoutExtension = originalFileName.substring(0, lastDotIndex);
        return nameWithoutExtension + '.pdf';
    }
    return originalFileName + '.pdf';
}

/**
 * Delete old attachment
 * @returns {Promise} Promise resolving when deletion is complete
 */
function deleteOldAttachment() {
    return fetch('/api/now/attachment/' + attachmentSysId, {
        method: "DELETE",
        headers: {
            "X-UserToken": window.g_ck
        }
    }).then((response) => {
        if (!response.ok) {
            throw new Error('DELETE request failed with status: ' + response.status);
        }
        console.log("Old attachment deleted successfully.");
    });
}

/**
 * Handle digital signing operation
 * @param {Object} instance - Nutrient viewer instance
 */
function handleDigitalSign(instance) {
    showNotification("Generating signing token...", "info", 2000);

    fetch(window.g_nutrientSignUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "X-UserToken": window.g_ck
            },
            body: JSON.stringify({})
        })
        .then((response) => {
            if (!response.ok) {
                return response.text().then((errorText) => {
                    throw new Error('Token generation failed (' + response.status + '): ' + errorText);
                });
            }
            return response.json();
        })
        .then((tokenData) => {
            const actualTokenData = tokenData.result || tokenData;

            if (!actualTokenData.success || !actualTokenData.accessToken) {
                throw new Error(actualTokenData.error || 'Failed to get access token');
            }

            showNotification("Signing document...", "info", 0);

            return instance.signDocument({
                signingData: {
                    signatureType: window.NutrientViewer.SignatureType.CAdES,
                    padesLevel: window.NutrientViewer.PAdESLevel.b_lt
                }
            }, {
                jwt: actualTokenData.accessToken
            });
        })
        .then(() => {
            hideAllNotifications();
            documentsigned = true;
            hasChanges = true;

            displaySignatureValidationInfo(instance);
            showNotification("Document digitally signed successfully!", "success", 4000);
        })
        .catch((error) => {
            hideAllNotifications();
            console.error("Signing error:", error);
            showNotification('Signing failed: ' + error.message, "error", 5000);
        });
}

// =============================================================================
// CERTIFICATE MANAGEMENT
// =============================================================================

/**
 * Load trusted certificates for signature validation
 * @returns {Promise<Array>} Promise resolving to array of certificate buffers
 */
function loadTrustedCertificates() {
    // Load the trusted CA chain server-side via the Script Include (GlideAjax)
    // rather than hitting the sys_certificate Table API from the browser. This
    // avoids requiring end users to have read access to the certificate store —
    // the Script Include reads it with server privileges and returns the PEMs.
    return new Promise((resolve) => {
        try {
            // GlideAjax relies on Prototype; temporarily restore it (mirrors loadAttachmentInfo)
            if (window._originalPrototype) {
                window.Prototype = window._originalPrototype;
            }

            if (typeof GlideAjax === 'undefined') {
                console.warn('GlideAjax not available; no trusted certificates loaded');
                resolve([]);
                return;
            }

            const ga = new GlideAjax('NutrientAttachmentHelper');
            ga.addParam('sysparm_name', 'getTrustedCertificates');

            ga.getXML((response) => {
                // Disable Prototype again to prevent conflicts with the SDK
                window.Prototype = null;

                const certificateBuffers = [];
                try {
                    let responseText = response.responseText;
                    if (!responseText && response.responseXML) {
                        const resultElements = response.responseXML.getElementsByTagName('result');
                        if (resultElements.length > 0) {
                            responseText = resultElements[0].getAttribute('value');
                        }
                    }

                    const data = responseText ? JSON.parse(responseText) : null;
                    if (data && data.certificates && data.certificates.length) {
                        for (let i = 0; i < data.certificates.length; i++) {
                            try {
                                const certData = data.certificates[i];
                                if (!certData || certData.trim() === '') {
                                    continue;
                                }

                                const base64Cert = cleanPemData(certData);
                                if (base64Cert && validateBase64(base64Cert)) {
                                    const buffer = base64ToArrayBuffer(base64Cert);
                                    if (buffer) {
                                        certificateBuffers.push(buffer);
                                    }
                                }
                            } catch (certError) {
                                console.warn('Error processing certificate:', certError);
                            }
                        }
                    }
                } catch (parseError) {
                    console.error('Error parsing trusted certificates:', parseError);
                }

                console.log('Loaded ' + certificateBuffers.length + ' certificates');
                resolve(certificateBuffers);
            });
        } catch (error) {
            console.error('Error loading certificates:', error);
            resolve([]);
        }
    });
}

/**
 * Clean PEM certificate data
 * @param {string} certData - Raw certificate data
 * @returns {string} Clean base64 certificate data
 */
function cleanPemData(certData) {
    if (certData.indexOf('-----BEGIN CERTIFICATE-----') !== -1) {
        return certData
            .replace(/-----BEGIN CERTIFICATE-----/g, '')
            .replace(/-----END CERTIFICATE-----/g, '')
            .replace(/[\r\n\s]/g, '');
    }
    return certData.replace(/\s/g, '');
}

/**
 * Validate base64 format
 * @param {string} base64Cert - Base64 certificate data
 * @returns {boolean} True if valid base64
 */
function validateBase64(base64Cert) {
    return /^[A-Za-z0-9+/]*={0,2}$/.test(base64Cert);
}

/**
 * Convert base64 to ArrayBuffer
 * @param {string} base64Cert - Base64 certificate data
 * @returns {ArrayBuffer|null} ArrayBuffer or null if conversion fails
 */
function base64ToArrayBuffer(base64Cert) {
    try {
        const binaryString = window.atob(base64Cert);
        const bytes = new Uint8Array(binaryString.length);

        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        return bytes.buffer;
    } catch (error) {
        console.warn('Failed to decode base64 certificate:', error);
        return null;
    }
}

// =============================================================================
// SIGNATURE VALIDATION
// =============================================================================

/**
 * Display signature validation information
 * @param {Object} instance - Nutrient viewer instance
 */
function displaySignatureValidationInfo(instance) {
    instance.getSignaturesInfo()
        .then((signaturesInfo) => {
            if (signaturesInfo && signaturesInfo.signatures && signaturesInfo.signatures.length > 0) {
                console.log('Digital signatures found:', signaturesInfo);
                window.digitallySigned = signaturesInfo;

                const validSignatures = signaturesInfo.signatures.filter((sig) => {
                    return sig.signatureValidationStatus === window.NutrientViewer.SignatureValidationStatus.valid;
                });

                const statusMessage = 'Found ' + signaturesInfo.signatures.length +
                    ' signature(s): ' + validSignatures.length + ' valid';

                showNotification(statusMessage, validSignatures.length > 0 ? "success" : "warning", 4000);
            } else {
                console.log('No digital signatures found in document');
                window.digitallySigned = false;
            }
        })
        .catch((error) => {
            console.error('Error checking signature validation:', error);
        });
}

// =============================================================================
// EVENT LISTENERS
// =============================================================================

/**
 * Setup event listeners
 * @param {Object} instance - Nutrient viewer instance
 */
function setupEventListeners(instance) {
    // Track document changes
    instance.addEventListener("annotations.change", () => {
        hasChanges = true;
    });

    // ESC key handler
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeViewer();
        }
    });
}

// =============================================================================
// NOTIFICATION SYSTEM
// =============================================================================

/**
 * Show notification to user
 * @param {string} message - Notification message
 * @param {string} type - Notification type (success, error, warning, info)
 * @param {number} duration - Duration in milliseconds (0 for persistent)
 */
function showNotification(message, type, duration) {
    type = type || 'success';
    duration = duration === undefined ? 3000 : duration;

    // Remove existing notifications
    hideAllNotifications();

    const notification = document.createElement('div');
    notification.className = 'save-notification ' + type;

    // Icon markup is a trusted static constant; the dynamic message goes in via textContent
    notification.innerHTML = getNotificationIcon(type);
    const textSpan = document.createElement('span');
    textSpan.className = 'notification-text';
    textSpan.textContent = message;
    notification.appendChild(textSpan);

    if (type === 'info' && duration === 0) {
        const spinner = document.createElement('div');
        spinner.className = 'notification-spinner';
        notification.appendChild(spinner);
    }

    document.body.appendChild(notification);

    // Trigger animation
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);

    // Auto-remove if duration is set
    if (duration > 0) {
        setTimeout(() => {
            removeNotification(notification);
        }, duration);
    }
}

/**
 * Get notification icon SVG
 * @param {string} type - Notification type
 * @returns {string} SVG icon HTML
 */
function getNotificationIcon(type) {
    const icons = {
        success: '<svg class="notification-icon" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>',
        error: '<svg class="notification-icon" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>',
        warning: '<svg class="notification-icon" viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
        info: '<svg class="notification-icon" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>'
    };
    return icons[type] || icons.info;
}

/**
 * Remove specific notification
 * @param {HTMLElement} notification - Notification element to remove
 */
function removeNotification(notification) {
    if (notification && notification.parentNode) {
        notification.classList.remove('show');
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }
}

/**
 * Hide all notifications
 */
function hideAllNotifications() {
    const notifications = document.querySelectorAll('.save-notification');
    for (let i = 0; i < notifications.length; i++) {
        removeNotification(notifications[i]);
    }
}

// =============================================================================
// PARENT COMMUNICATION
// =============================================================================

/**
 * Send message to parent window
 * @param {string} type - Message type
 * @param {Object} data - Additional data
 */
function notifyParent(type, data) {
    if (window.parent && window.parent !== window) {
        const message = {
            type: type
        };
        if (data) {
            Object.keys(data).forEach((key) => {
                message[key] = data[key];
            });
        }
        window.parent.postMessage(message, '*');
    }
}

// =============================================================================
// INITIALIZATION & CLEANUP
// =============================================================================

/**
 * Initialize application when DOM is ready
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log('STEP 3: DOM loaded');

    // Get attachment sys_id from URL
    attachmentSysId = getUrlParameter('sysparm_sys_id');
    console.log('STEP 3a: sys_id: ' + attachmentSysId);

    if (!attachmentSysId) {
        showError('No Attachment ID', 'Invalid document link.');
        return;
    }

    // Wait for NutrientViewer to load
    if (typeof window.NutrientViewer === 'undefined') {
        console.log('STEP 3b: Waiting for NutrientViewer...');
        updateStatus('Loading viewer library...');

        let attempts = 0;
        const checkNutrient = setInterval(() => {
            attempts++;

            if (typeof window.NutrientViewer !== 'undefined') {
                console.log('STEP 3c: NutrientViewer ready');
                clearInterval(checkNutrient);
                loadAttachmentInfo();
            } else if (attempts > 20) { // Increased timeout
                console.error('ERROR: NutrientViewer load timeout');
                clearInterval(checkNutrient);
                showError('Library Error', 'Viewer library failed to load.');
            }
        }, 500);
    } else {
        console.log('STEP 3c: NutrientViewer already available');
        loadAttachmentInfo();
    }
});

/**
 * Cleanup on page unload
 */
window.addEventListener('beforeunload', (event) => {
    console.log('CLEANUP: Browser closing');

    // Cleanup Nutrient instance
    if (nutrientInstance && typeof nutrientInstance.destroy === 'function') {
        try {
            nutrientInstance.destroy();
        } catch (error) {
            console.warn('CLEANUP ERROR: ' + error.message);
        }
    }

    // Refresh parent if needed
    if (window.opener && !window.opener.closed) {
        try {
            window.opener.location.reload();
        } catch (error) {
            console.warn('Could not refresh parent window:', error);
        }
    }
});

// =============================================================================
// ERROR SUPPRESSION
// =============================================================================

/**
 * Global error handler to suppress ServiceNow conflicts
 */
window.addEventListener('error', (event) => {
    const message = event.message || '';

    const suppressedMessages = [
        'Prototype',
        'Effect',
        'Cannot read properties of null'
    ];

    for (let i = 0; i < suppressedMessages.length; i++) {
        if (message.indexOf(suppressedMessages[i]) !== -1) {
            console.log('SUPPRESSED: ' + message);
            event.preventDefault();
            return false;
        }
    }
});

// =============================================================================
// DEBUG INFO
// =============================================================================

console.log('NUTRIENT SCRIPT: Ready');
