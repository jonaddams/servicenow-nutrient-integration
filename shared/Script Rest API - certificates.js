/**
 * =============================================================================
 * NUTRIENT TRUSTED CERTIFICATES API
 * =============================================================================
 * Purpose: Expose active trusted CA certificates (PEM) to UX Framework clients
 *          for signature validation (trustedCAsCallback). GlideAjax-free.
 * API Path: GET /api/<ns>/nutrient_dws_signing/certificates
 * Runtime: Enable "ECMAScript 2021 mode" on this Scripted REST resource.
 * Security: role-gated (nutrient_user | admin).
 * =============================================================================
 */
(function process(request, response) {
    const LOG_PREFIX = '[Nutrient-Certificates-API]';

    if (!gs.hasRole('nutrient_user') && !gs.hasRole('admin')) {
        gs.warn(`${LOG_PREFIX} Unauthorized access by: ${gs.getUserName()}`);
        response.setStatus(403);
        response.setBody({ success: false, error: 'Insufficient privileges', certificates: [] });
        return;
    }

    try {
        const helper = new NutrientAttachmentHelper();
        const result = helper.getTrustedCertificatesData();
        response.setStatus(result.success ? 200 : 500);
        response.setBody(result);
    } catch (error) {
        gs.error(`${LOG_PREFIX} Error: ${error.toString()}`);
        response.setStatus(500);
        response.setBody({ success: false, error: 'Internal server error', certificates: [] });
    }
})(request, response);
