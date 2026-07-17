/**
 * =============================================================================
 * NUTRIENT DIGITAL WORKSPACE (DWS) TOKEN GENERATION API
 * =============================================================================
 * Purpose: Generate secure access tokens for Nutrient DWS digital signing
 * Author: ServiceNow Development Team
 * Version: 1.1
 * API Path: /api/{scope}/nutrient_dws_signing/sign
 * Method: POST
 * Runtime: Enable "ECMAScript 2021 mode" on this Scripted REST resource.
 * Security: API key validation, rate limiting, origin verification
 * =============================================================================
 */

(function process(request, response) {

    // =============================================================================
    // SECURITY & VALIDATION CONSTANTS
    // =============================================================================

    const API_CONFIG = {
        MAX_EXPIRATION_TIME: 7200, // 2 hours maximum
        MIN_EXPIRATION_TIME: 300, // 5 minutes minimum
        DEFAULT_EXPIRATION_TIME: 3600, // 1 hour default
        RATE_LIMIT_PER_HOUR: 100, // Maximum tokens per user per hour
        ALLOWED_ORIGINS_PROPERTY: 'nutrient.dws.allowed.origins',
        API_KEY_PROPERTY: 'nutrient.dws.api.token',
        API_ENDPOINT: 'https://api.nutrient.io/tokens',
        LOG_PREFIX: '[DWS-Token-API]'
    };

    // =============================================================================
    // REQUEST INITIALIZATION & LOGGING
    // =============================================================================

    const logPrefix = API_CONFIG.LOG_PREFIX;
    const requestId = gs.generateGUID();
    const startTime = new Date().getTime();

    gs.info(`${logPrefix} [${requestId}] Token generation request initiated`);
    gs.info(`${logPrefix} [${requestId}] User: ${gs.getUserName()}`);
    gs.info(`${logPrefix} [${requestId}] Origin: ${request.getHeader('Origin')}`);

    try {

        // =============================================================================
        // AUTHENTICATION & AUTHORIZATION
        // =============================================================================

        // Validate user authentication and authorization
        if (!gs.hasRole('nutrient_user') && !gs.hasRole('admin')) {
            gs.warn(`${logPrefix} [${requestId}] Unauthorized access attempt by: ${gs.getUserName()}`);

            response.setStatus(403);
            response.setBody({
                success: false,
                error: 'Insufficient privileges for digital signing',
                requestId: requestId
            });
            return;
        }

        // Rate limiting check
        if (!checkRateLimit(requestId)) {
            return; // Response already set in checkRateLimit function
        }

        // =============================================================================
        // CONFIGURATION VALIDATION
        // =============================================================================

        // Validate API key configuration
        const apiKey = gs.getProperty(API_CONFIG.API_KEY_PROPERTY);
        if (!apiKey || apiKey.trim() === '') {
            gs.error(`${logPrefix} [${requestId}] API key not configured or empty`);

            response.setStatus(500);
            response.setBody({
                success: false,
                error: 'Digital signing service not properly configured',
                requestId: requestId
            });
            return;
        }

        // Validate API key format (basic check)
        if (apiKey.length < 20 || !apiKey.match(/^[a-zA-Z0-9_-]+$/)) {
            gs.error(`${logPrefix} [${requestId}] Invalid API key format`);

            response.setStatus(500);
            response.setBody({
                success: false,
                error: 'Invalid API key configuration',
                requestId: requestId
            });
            return;
        }

        // =============================================================================
        // REQUEST PROCESSING & VALIDATION
        // =============================================================================

        // Parse and validate request body
        const requestBody = request.body ? request.body.data : {};
        const expirationTime = validateExpirationTime(requestBody.expirationTime);
        const allowedOrigins = validateAllowedOrigins(request);

        if (!allowedOrigins || allowedOrigins.length === 0) {
            gs.warn(`${logPrefix} [${requestId}] No valid origins found for token generation`);

            response.setStatus(400);
            response.setBody({
                success: false,
                error: 'Invalid or missing origin configuration',
                requestId: requestId
            });
            return;
        }

        // =============================================================================
        // TOKEN REQUEST PREPARATION
        // =============================================================================

        // Create secure token request payload
        const tokenPayload = {
            allowedOperations: ['digital_signatures_api'],
            allowedOrigins: allowedOrigins,
            expirationTime: expirationTime,
            metadata: {
                requestId: requestId,
                userId: gs.getUserID(),
                userName: gs.getUserName(),
                timestamp: new GlideDateTime().toString(),
                sessionId: gs.getSessionID().substring(0, 8) // First 8 chars only for security
            }
        };

        gs.info(`${logPrefix} [${requestId}] Token payload prepared`);
        gs.debug(`${logPrefix} [${requestId}] Payload: ${JSON.stringify(tokenPayload, null, 2)}`);

        // =============================================================================
        // EXTERNAL API CALL
        // =============================================================================

        // Execute token generation request to Nutrient DWS API
        const tokenData = executeTokenGeneration(requestId, apiKey, tokenPayload);

        if (!tokenData) {
            // Error response already set in executeTokenGeneration
            return;
        }

        // =============================================================================
        // SUCCESS RESPONSE & AUDIT LOGGING
        // =============================================================================

        const processingTime = new Date().getTime() - startTime;

        // Log successful token generation
        logTokenGeneration(requestId, tokenData, processingTime);

        // Return success response
        response.setStatus(200);
        response.setBody({
            success: true,
            accessToken: tokenData.accessToken,
            id: tokenData.id,
            expiresIn: expirationTime,
            requestId: requestId,
            processingTime: processingTime
        });

        gs.info(`${logPrefix} [${requestId}] Token generation completed successfully in ${processingTime}ms`);

    } catch (error) {

        // =============================================================================
        // ERROR HANDLING & LOGGING
        // =============================================================================

        handleUnexpectedError(requestId, error);
    }

    // =============================================================================
    // HELPER FUNCTIONS
    // (declared with `function` so the main body above can call them via hoisting)
    // =============================================================================

    /**
     * Check rate limiting for token generation.
     * @param {string} requestId - Unique request identifier
     * @returns {boolean} True if within rate limit, false otherwise
     */
    function checkRateLimit(requestId) {
        try {
            const userId = gs.getUserID();
            const currentHour = Math.floor(new Date().getTime() / (1000 * 60 * 60));
            const rateLimitKey = `nutrient_token_rate_${userId}_${currentHour}`;

            const rateLimitGR = new GlideRecord('sys_cache');
            rateLimitGR.addQuery('name', rateLimitKey);
            rateLimitGR.query();

            const recordExists = rateLimitGR.next();
            const currentCount = recordExists ? parseInt(rateLimitGR.getValue('value') || '0', 10) : 0;

            if (currentCount >= API_CONFIG.RATE_LIMIT_PER_HOUR) {
                gs.warn(`${logPrefix} [${requestId}] Rate limit exceeded for user: ${gs.getUserName()}`);

                response.setStatus(429);
                response.setBody({
                    success: false,
                    error: `Rate limit exceeded. Maximum ${API_CONFIG.RATE_LIMIT_PER_HOUR} tokens per hour`,
                    requestId: requestId,
                    retryAfter: 3600 // 1 hour
                });
                return false;
            }

            // Update rate limit counter (increment the existing row rather than inserting a new one each call)
            if (recordExists) {
                rateLimitGR.setValue('value', (currentCount + 1).toString());
                rateLimitGR.update();
            } else {
                rateLimitGR.initialize();
                rateLimitGR.setValue('name', rateLimitKey);
                rateLimitGR.setValue('value', '1');
                rateLimitGR.setValue('expires', new GlideDateTime(new Date(Date.now() + 3600000))); // 1 hour from now
                rateLimitGR.insert();
            }

            return true;

        } catch (error) {
            gs.warn(`${logPrefix} [${requestId}] Rate limit check failed: ${error.message}`);
            return true; // Allow request if rate limit check fails
        }
    }

    /**
     * Validate and sanitize expiration time.
     * @param {number} requestedTime - Requested expiration time in seconds
     * @returns {number} Validated expiration time
     */
    function validateExpirationTime(requestedTime) {
        let expiration = parseInt(requestedTime, 10);

        if (isNaN(expiration) || expiration <= 0) {
            expiration = API_CONFIG.DEFAULT_EXPIRATION_TIME;
        }

        // Enforce minimum and maximum limits
        if (expiration < API_CONFIG.MIN_EXPIRATION_TIME) {
            expiration = API_CONFIG.MIN_EXPIRATION_TIME;
        } else if (expiration > API_CONFIG.MAX_EXPIRATION_TIME) {
            expiration = API_CONFIG.MAX_EXPIRATION_TIME;
        }

        return expiration;
    }

    /**
     * Validate and build allowed origins list.
     * @param {Object} request - HTTP request object
     * @returns {Array} Array of validated origins
     */
    function validateAllowedOrigins(request) {
        const origins = [];

        // Get current request origin
        const requestOrigin = request.getHeader('Origin');
        const requestHost = request.getHeader('Host');

        if (requestOrigin) {
            origins.push(requestOrigin);
        } else if (requestHost) {
            origins.push(`https://${requestHost}`);
            origins.push(`http://${requestHost}`); // For development
        }

        // Add configured allowed origins
        const configuredOrigins = gs.getProperty(API_CONFIG.ALLOWED_ORIGINS_PROPERTY);
        if (configuredOrigins) {
            for (const raw of configuredOrigins.split(',')) {
                const origin = raw.trim();
                if (origin && origins.indexOf(origin) === -1) {
                    origins.push(origin);
                }
            }
        }

        // Validate each origin
        return origins.filter((origin) => isValidOrigin(origin));
    }

    /**
     * Validate origin URL format and security.
     * @param {string} origin - Origin URL to validate
     * @returns {boolean} True if valid and secure
     */
    function isValidOrigin(origin) {
        if (!origin || typeof origin !== 'string') {
            return false;
        }

        // Basic URL format validation
        const urlRegex = /^https?:\/\/[a-zA-Z0-9.-]+(:[0-9]+)?$/;
        if (!urlRegex.test(origin)) {
            return false;
        }

        // Security checks
        const lowercaseOrigin = origin.toLowerCase();
        const blacklistedDomains = ['localhost', '127.0.0.1', '0.0.0.0'];

        // Allow localhost only in development
        const isDevelopment = gs.getProperty('glide.servlet.uri').indexOf('localhost') !== -1;
        if (!isDevelopment) {
            return !blacklistedDomains.some((domain) => lowercaseOrigin.indexOf(domain) !== -1);
        }

        return true;
    }

    /**
     * Execute token generation request to external API.
     * @param {string} requestId - Request identifier
     * @param {string} apiKey - Nutrient API key
     * @param {Object} payload - Token request payload
     * @returns {Object|null} Token data or null on failure
     */
    function executeTokenGeneration(requestId, apiKey, payload) {
        try {
            gs.info(`${logPrefix} [${requestId}] Initiating external API call to Nutrient DWS`);

            const tokenRequest = new sn_ws.RESTMessageV2();
            tokenRequest.setEndpoint(API_CONFIG.API_ENDPOINT);
            tokenRequest.setHttpMethod('POST');
            tokenRequest.setRequestHeader('Authorization', `Bearer ${apiKey}`);
            tokenRequest.setRequestHeader('Content-Type', 'application/json');
            tokenRequest.setRequestHeader('User-Agent', 'ServiceNow-Nutrient-Integration/1.0');
            tokenRequest.setRequestHeader('X-Request-ID', requestId);

            // Set timeout (30 seconds)
            tokenRequest.setHttpTimeout(30000);

            tokenRequest.setRequestBody(JSON.stringify(payload));

            const tokenResponse = tokenRequest.execute();
            const statusCode = tokenResponse.getStatusCode();
            const responseBody = tokenResponse.getBody();

            gs.info(`${logPrefix} [${requestId}] External API response - Status: ${statusCode}`);

            if (statusCode === 200 || statusCode === 201) {
                const tokenData = JSON.parse(responseBody);

                // Validate response structure
                if (!tokenData.accessToken || !tokenData.id) {
                    gs.error(`${logPrefix} [${requestId}] Invalid token response structure`);

                    response.setStatus(502);
                    response.setBody({
                        success: false,
                        error: 'Invalid response from digital signing service',
                        requestId: requestId
                    });
                    return null;
                }

                return tokenData;
            }

            gs.error(`${logPrefix} [${requestId}] External API error - Status: ${statusCode}`);
            gs.error(`${logPrefix} [${requestId}] Error Response: ${responseBody}`);

            let errorMessage = 'Digital signing service temporarily unavailable';
            try {
                const errorData = JSON.parse(responseBody);
                if (errorData.message) {
                    errorMessage = `Service error: ${errorData.message}`;
                }
            } catch (parseError) {
                // Use default error message
            }

            response.setStatus(502);
            response.setBody({
                success: false,
                error: errorMessage,
                statusCode: statusCode,
                requestId: requestId
            });
            return null;

        } catch (error) {
            gs.error(`${logPrefix} [${requestId}] External API call exception: ${error.message}`);

            response.setStatus(503);
            response.setBody({
                success: false,
                error: 'Failed to connect to digital signing service',
                requestId: requestId
            });
            return null;
        }
    }

    /**
     * Log successful token generation for audit purposes.
     * @param {string} requestId - Request identifier
     * @param {Object} tokenData - Generated token data
     * @param {number} processingTime - Processing time in milliseconds
     */
    function logTokenGeneration(requestId, tokenData, processingTime) {
        try {
            // Create audit log entry
            const auditGR = new GlideRecord('sys_audit');
            auditGR.initialize();
            auditGR.setValue('tablename', 'nutrient_dws_tokens');
            auditGR.setValue('documentkey', requestId);
            auditGR.setValue('fieldname', 'token_generated');
            auditGR.setValue('newvalue', `Token generated for user: ${gs.getUserName()}`);
            auditGR.setValue('user', gs.getUserID());
            auditGR.insert();

            gs.info(`${logPrefix} [${requestId}] Audit log created`);

            // Performance metrics
            gs.eventQueue('nutrient.dws.token.generated', null, requestId, gs.getUserID(), processingTime.toString());

        } catch (error) {
            gs.warn(`${logPrefix} [${requestId}] Audit logging failed: ${error.message}`);
            // Don't fail the main request for audit logging issues
        }
    }

    /**
     * Handle unexpected errors with proper logging and response.
     * @param {string} requestId - Request identifier
     * @param {Error} error - The error that occurred
     */
    function handleUnexpectedError(requestId, error) {
        const errorMessage = error.message || 'Unknown error occurred';
        const processingTime = new Date().getTime() - startTime;

        gs.error(`${logPrefix} [${requestId}] Unexpected error after ${processingTime}ms: ${errorMessage}`);
        gs.error(`${logPrefix} [${requestId}] Stack trace: ${error.stack}`);

        // Create error event for monitoring
        gs.eventQueue('nutrient.dws.token.error', null, requestId, gs.getUserID(), errorMessage);

        response.setStatus(500);
        response.setBody({
            success: false,
            error: 'Internal server error occurred',
            requestId: requestId,
            processingTime: processingTime
        });
    }

})(request, response);
