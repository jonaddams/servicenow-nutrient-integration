/**
 * =============================================================================
 * NUTRIENT ATTACHMENT METADATA API
 * =============================================================================
 * Purpose: Expose attachment metadata to UX Framework (Workspace) clients,
 *          which cannot use GlideAjax. Thin wrapper over NutrientAttachmentHelper.
 * API Path: GET /api/<ns>/nutrient_dws_signing/metadata?sys_id=<attachmentSysId>
 * Runtime: Enable "ECMAScript 2021 mode" on this Scripted REST resource.
 * Security: role-gated (nutrient_user | admin); per-record access enforced by the Script Include.
 * =============================================================================
 */
(function process(request, response) {
    const LOG_PREFIX = '[Nutrient-Metadata-API]';

    if (!gs.hasRole('nutrient_user') && !gs.hasRole('admin')) {
        gs.warn(`${LOG_PREFIX} Unauthorized access by: ${gs.getUserName()}`);
        response.setStatus(403);
        response.setBody({ success: false, error: 'Insufficient privileges' });
        return;
    }

    const sysId = request.queryParams.sys_id ? String(request.queryParams.sys_id) : '';

    try {
        const helper = new NutrientAttachmentHelper();
        const result = helper.getAttachmentDetails(sysId);
        response.setStatus(result.success ? 200 : 400);
        response.setBody(result);
    } catch (error) {
        gs.error(`${LOG_PREFIX} Error: ${error.toString()}`);
        response.setStatus(500);
        response.setBody({ success: false, error: 'Internal server error' });
    }
})(request, response);
