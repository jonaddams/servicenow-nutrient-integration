/**
 * =============================================================================
 * NUTRIENT ATTACHMENT HELPER - SCRIPT INCLUDE
 * =============================================================================
 * Purpose: Server-side helper for attachment metadata + trusted certificates
 * Author: ServiceNow Development Team
 * Version: 1.3
 * Runtime: Enable "ECMAScript 2021 mode" on this Script Include record.
 * Security: Input validation, per-record access control, output sanitization.
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
     * Core attachment-metadata logic, callable with an explicit sys_id.
     * Enforces per-record access control. Returns a plain object (no GlideAjax
     * result element) so both GlideAjax and Scripted REST callers can use it.
     * @param {string} sysId
     * @returns {Object}
     */
    getAttachmentDetails(sysId) {
        try {
            if (!this._isValidSysId(sysId)) {
                return { success: false, error: 'Invalid or missing attachment ID' };
            }

            const attachmentGR = new GlideRecord('sys_attachment');
            if (!attachmentGR.get(sysId)) {
                return { success: false, error: 'Attachment not found' };
            }

            if (!this._hasAttachmentAccess(attachmentGR)) {
                gs.warn(`[NutrientAttachmentHelper.getAttachmentDetails] Access denied for ${gs.getUserName()} on attachment ${sysId}`);
                return { success: false, error: 'You do not have access to this attachment' };
            }

            return {
                success: true,
                fileName: this._sanitizeString(attachmentGR.getValue('file_name')) || 'Unknown',
                sizeBytes: parseInt(attachmentGR.getValue('size_bytes') || '0', 10),
                contentType: this._sanitizeString(attachmentGR.getValue('content_type')) || 'application/octet-stream',
                tableName: this._sanitizeString(attachmentGR.getValue('table_name')) || '',
                tableId: this._sanitizeString(attachmentGR.getValue('table_sys_id')) || '',
                createdOn: this._sanitizeString(attachmentGR.getValue('sys_created_on')) || ''
            };
        } catch (error) {
            return { success: false, error: `Server error: ${error.toString()}` };
        }
    },

    /**
     * GlideAjax entry point (classic UI). Contract unchanged.
     */
    getAttachmentInfo() {
        return this._result(this.getAttachmentDetails(this.getParameter('sysparm_sys_id')));
    },

    /**
     * Core trusted-cert logic. Returns a plain object usable by GlideAjax and REST.
     * Runs server-side, reading sys_certificate with full access regardless of caller roles.
     * @returns {Object} { success, certificates: [pem, ...] }
     */
    getTrustedCertificatesData() {
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

            gs.info(`[NutrientAttachmentHelper.getTrustedCertificatesData] Returning ${certificates.length} certificate(s)`);
            return { success: true, certificates: certificates };
        } catch (error) {
            gs.error(`[NutrientAttachmentHelper.getTrustedCertificatesData] Error: ${error.toString()}`);
            return { success: false, error: `Server error: ${error.toString()}`, certificates: [] };
        }
    },

    /**
     * GlideAjax entry point (classic UI). Contract unchanged.
     */
    getTrustedCertificates() {
        return this._result(this.getTrustedCertificatesData());
    },

    /**
     * =============================================================================
     * HELPERS
     * =============================================================================
     */

    /**
     * Serialize a response object into the GlideAjax result element.
     * @param {Object} obj - Response payload
     */
    _result(obj) {
        return this.newItem('result').setAttribute('value', JSON.stringify(obj));
    },

    /**
     * Validate sys_id format (32-char hex).
     * @param {string} sysId - System ID to validate
     * @returns {boolean} True if valid
     */
    _isValidSysId(sysId) {
        // NOTE: getParameter() returns a Java string under Rhino, so `typeof` is
        // 'object' (not 'string'). Coerce with String() before testing.
        if (!sysId) {
            return false;
        }
        return /^[a-f0-9]{32}$/i.test(String(sysId).trim());
    },

    /**
     * Check whether the current user may read this attachment and its parent record.
     * @param {GlideRecord} attachmentGR - Attachment record
     * @returns {boolean} True if the user has access
     */
    _hasAttachmentAccess(attachmentGR) {
        try {
            // Explicit ACL check for the attachment itself
            if (!attachmentGR.canRead()) {
                gs.warn('[NutrientAttachmentHelper._hasAttachmentAccess] Cannot read attachment');
                return false;
            }

            const tableName = attachmentGR.getValue('table_name');
            const tableSysId = attachmentGR.getValue('table_sys_id');

            // No parent record to gate against
            if (!tableName || !tableSysId) {
                return true;
            }

            // The user must be able to read the record the attachment hangs off of
            const parentGR = new GlideRecord(tableName);
            if (!parentGR.isValid()) {
                gs.warn(`[NutrientAttachmentHelper._hasAttachmentAccess] Invalid parent table: ${tableName}`);
                return false;
            }
            if (!parentGR.get(tableSysId)) {
                gs.warn('[NutrientAttachmentHelper._hasAttachmentAccess] Parent record not found');
                return false;
            }
            return parentGR.canRead();

        } catch (error) {
            gs.error(`[NutrientAttachmentHelper._hasAttachmentAccess] Error: ${error.toString()}`);
            // Fail closed: deny on any error
            return false;
        }
    },

    /**
     * Sanitize a string for safe display (encodes HTML-significant characters).
     * @param {string} input - Input string
     * @returns {string} Sanitized string
     */
    _sanitizeString(input) {
        if (!input) {
            return '';
        }
        const replacements = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#x27;' };
        return String(input).replace(/[<>&"']/g, (match) => replacements[match]);
    },

    type: 'NutrientAttachmentHelper'
});
