/**
 * =============================================================================
 * NUTRIENT ATTACHMENT HELPER - SCRIPT INCLUDE
 * =============================================================================
 * Purpose: Server-side helper for attachment metadata + trusted certificates
 * Author: ServiceNow Development Team
 * Version: 1.2
 * Runtime: Enable "ECMAScript 2021 mode" on this Script Include record.
 * Security: Input validation, error handling, logging
 * =============================================================================
 */

// NOTE: `var` here is the required ServiceNow class-registration idiom for a
// Script Include (Class.create). Everything else uses modern const/let.
var NutrientAttachmentHelper = Class.create();

NutrientAttachmentHelper.prototype = Object.extendsObject(AbstractAjaxProcessor, {

    /**
     * =============================================================================
     * ATTACHMENT INFORMATION RETRIEVAL
     * =============================================================================
     */

    /**
     * Get attachment information by sys_id.
     * @returns {Object} JSON response with attachment details
     */
    getAttachmentInfo() {
        try {
            const sysId = this.getParameter('sysparm_sys_id');

            if (!sysId) {
                return this.newItem('result').setAttribute('value', JSON.stringify({
                    success: false,
                    error: 'No attachment ID provided'
                }));
            }

            const attachmentGR = new GlideRecord('sys_attachment');
            if (!attachmentGR.get(sysId)) {
                return this.newItem('result').setAttribute('value', JSON.stringify({
                    success: false,
                    error: 'Attachment not found'
                }));
            }

            const result = {
                success: true,
                fileName: attachmentGR.getValue('file_name') || 'Unknown',
                sizeBytes: parseInt(attachmentGR.getValue('size_bytes') || '0', 10),
                contentType: attachmentGR.getValue('content_type') || 'application/octet-stream',
                tableName: attachmentGR.getValue('table_name') || '',
                tableId: attachmentGR.getValue('table_sys_id') || '',
                createdOn: attachmentGR.getValue('sys_created_on') || ''
            };

            return this.newItem('result').setAttribute('value', JSON.stringify(result));

        } catch (error) {
            return this.newItem('result').setAttribute('value', JSON.stringify({
                success: false,
                error: `Server error: ${error.toString()}`
            }));
        }
    },

    /**
     * Return the active trusted CA certificates (PEM) for signature validation.
     * Runs server-side, so it reads sys_certificate with full access regardless
     * of the caller's roles — the browser no longer needs direct sys_certificate
     * access via the Table API. Client access is still gated by this Script
     * Include's ACL (nutrient_user / admin).
     * @returns {Object} JSON { success, certificates: [pem, ...] }
     */
    getTrustedCertificates() {
        try {
            const certificates = [];
            const certGR = new GlideRecord('sys_certificate');
            certGR.addQuery('active', true);
            certGR.query();

            while (certGR.next()) {
                const pem = certGR.getValue('pem_certificate');
                if (pem && pem.trim() !== '') {
                    certificates.push(pem);
                }
            }

            gs.info(`[NutrientAttachmentHelper.getTrustedCertificates] Returning ${certificates.length} certificate(s)`);

            return this.newItem('result').setAttribute('value', JSON.stringify({
                success: true,
                certificates: certificates
            }));

        } catch (error) {
            gs.error(`[NutrientAttachmentHelper.getTrustedCertificates] Error: ${error.toString()}`);
            return this.newItem('result').setAttribute('value', JSON.stringify({
                success: false,
                error: `Server error: ${error.toString()}`,
                certificates: []
            }));
        }
    },

    /**
     * =============================================================================
     * VALIDATION METHODS
     * =============================================================================
     */

    /**
     * Validate sys_id format and content.
     * @param {string} sysId - System ID to validate
     * @returns {boolean} True if valid
     */
    _isValidSysId(sysId) {
        if (!sysId || typeof sysId !== 'string') {
            return false;
        }

        const cleaned = sysId.trim();

        // ServiceNow sys_id format: 32 character hex string
        if (cleaned.length !== 32) {
            return false;
        }

        return /^[a-f0-9]{32}$/i.test(cleaned);
    },

    /**
     * Check if current user has access to attachment.
     * @param {GlideRecord} attachmentGR - Attachment record
     * @returns {boolean} True if user has access
     */
    _hasAttachmentAccess(attachmentGR) {
        try {
            // Basic read check
            if (!attachmentGR.canRead()) {
                gs.warn('[NutrientAttachmentHelper._hasAttachmentAccess] Cannot read attachment');
                return false;
            }

            // Get parent table info
            const tableName = attachmentGR.getValue('table_name');
            const tableSysId = attachmentGR.getValue('table_sys_id');

            // If no parent table, allow access
            if (!tableName || !tableSysId) {
                gs.info('[NutrientAttachmentHelper._hasAttachmentAccess] No parent table, allowing access');
                return true;
            }

            // Check access to parent record
            const parentGR = new GlideRecord(tableName);
            if (parentGR.isValid()) {
                if (parentGR.get(tableSysId)) {
                    const canRead = parentGR.canRead();
                    gs.info(`[NutrientAttachmentHelper._hasAttachmentAccess] Parent record access: ${canRead}`);
                    return canRead;
                }
                gs.warn('[NutrientAttachmentHelper._hasAttachmentAccess] Parent record not found');
                return false;
            }
            gs.warn(`[NutrientAttachmentHelper._hasAttachmentAccess] Invalid parent table: ${tableName}`);
            return false;

        } catch (error) {
            gs.error(`[NutrientAttachmentHelper._hasAttachmentAccess] Error: ${error.toString()}`);
            // If permission check fails, be conservative and deny access
            return false;
        }
    },

    /**
     * =============================================================================
     * RESPONSE BUILDERS
     * =============================================================================
     */

    /**
     * Build attachment information response.
     * @param {GlideRecord} attachmentGR - Attachment record
     * @returns {Object} Attachment information
     */
    _buildAttachmentResponse(attachmentGR) {
        const fileName = attachmentGR.getValue('file_name');
        const sizeBytes = attachmentGR.getValue('size_bytes');
        const contentType = attachmentGR.getValue('content_type');
        const tableName = attachmentGR.getValue('table_name');
        const tableSysId = attachmentGR.getValue('table_sys_id');
        const createdOn = attachmentGR.getValue('sys_created_on');

        gs.info(`[NutrientAttachmentHelper._buildAttachmentResponse] fileName: ${fileName}`);
        gs.info(`[NutrientAttachmentHelper._buildAttachmentResponse] sizeBytes: ${sizeBytes}`);
        gs.info(`[NutrientAttachmentHelper._buildAttachmentResponse] contentType: ${contentType}`);

        return {
            success: true,
            fileName: this._sanitizeString(fileName) || 'Unknown Document',
            sizeBytes: parseInt(sizeBytes || '0', 10),
            contentType: this._sanitizeString(contentType) || 'application/octet-stream',
            tableName: this._sanitizeString(tableName) || '',
            tableId: this._sanitizeString(tableSysId) || '',
            createdOn: this._sanitizeString(createdOn) || '',
            sysId: attachmentGR.getUniqueValue()
        };
    },

    /**
     * Create success response.
     * @param {Object} data - Response data
     * @returns {Object} Formatted success response
     */
    _createSuccessResponse(data) {
        const jsonString = JSON.stringify(data);
        gs.info(`[NutrientAttachmentHelper._createSuccessResponse] Response: ${jsonString}`);
        return this.newItem('result').setAttribute('value', jsonString);
    },

    /**
     * Create error response.
     * @param {string} errorMessage - Error message
     * @returns {Object} Formatted error response
     */
    _createErrorResponse(errorMessage) {
        const response = {
            success: false,
            error: this._sanitizeString(errorMessage),
            timestamp: new GlideDateTime().toString()
        };
        const jsonString = JSON.stringify(response);
        gs.warn(`[NutrientAttachmentHelper._createErrorResponse] Error response: ${jsonString}`);
        return this.newItem('result').setAttribute('value', jsonString);
    },

    /**
     * =============================================================================
     * UTILITY METHODS
     * =============================================================================
     */

    /**
     * Sanitize string input to prevent XSS.
     * @param {string} input - Input string
     * @returns {string} Sanitized string
     */
    _sanitizeString(input) {
        if (!input) {
            return '';
        }

        // Basic XSS prevention - encode dangerous characters
        const replacements = {
            '<': '&lt;',
            '>': '&gt;',
            '&': '&amp;',
            '"': '&quot;',
            "'": '&#x27;'
        };

        return String(input).replace(/[<>&"']/g, (match) => replacements[match]);
    },

    /**
     * =============================================================================
     * DEBUG METHOD (Remove in production)
     * =============================================================================
     */

    /**
     * Debug method to check an attachment exists.
     */
    debugAttachment() {
        const sysId = this.getParameter('sysparm_sys_id');
        gs.info(`[DEBUG] Looking for attachment: ${sysId}`);

        const attachmentGR = new GlideRecord('sys_attachment');
        attachmentGR.query();

        let count = 0;
        while (attachmentGR.next() && count < 5) {
            gs.info(`[DEBUG] Found attachment: ${attachmentGR.getUniqueValue()} - ${attachmentGR.getValue('file_name')}`);
            count++;
        }

        // Now try specific lookup
        const testGR = new GlideRecord('sys_attachment');
        if (testGR.get(sysId)) {
            gs.info(`[DEBUG] Found specific attachment: ${testGR.getValue('file_name')}`);
            return this._createSuccessResponse({
                debug: 'found',
                fileName: testGR.getValue('file_name')
            });
        }
        gs.info('[DEBUG] Specific attachment not found');
        return this._createErrorResponse('Debug: Attachment not found');
    },

    /**
     * =============================================================================
     * CLASS DEFINITION
     * =============================================================================
     */

    type: 'NutrientAttachmentHelper'
});
