export class UrlFetchError extends Error {
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'UrlFetchError';
    }
}
export function classifyUrlFailure(error) {
    if (error instanceof UrlFetchError) {
        return {
            category: 'http',
            statusCode: error.statusCode,
            retryable: isRetryableHttpStatus(error.statusCode),
        };
    }
    if (isTimeoutError(error)) {
        return { category: 'timeout', retryable: true };
    }
    if (isNetworkError(error)) {
        return { category: 'network', retryable: true };
    }
    return { category: 'unknown', retryable: false };
}
export async function fetchCleanedUrlContent(url, timeoutMs) {
    const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
        throw new UrlFetchError(`Failed to fetch URL source: ${response.status} ${response.statusText}`, response.status);
    }
    const body = await response.text();
    const title = decodeHtmlEntities(body.match(/<title[^>]*>(.*?)<\/title>/i)?.[1]?.trim() ?? url);
    return {
        title,
        body: htmlToReadableText(body),
    };
}
function isRetryableHttpStatus(statusCode) {
    return statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500;
}
function isTimeoutError(error) {
    return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}
function isNetworkError(error) {
    if (error instanceof TypeError) {
        return true;
    }
    const systemErrorCode = findSystemErrorCode(error);
    return systemErrorCode !== null && RETRYABLE_NETWORK_ERROR_CODES.has(systemErrorCode);
}
const RETRYABLE_NETWORK_ERROR_CODES = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ETIMEDOUT',
]);
function findSystemErrorCode(error) {
    if (!error || typeof error !== 'object') {
        return null;
    }
    const candidate = error;
    if (typeof candidate.code === 'string') {
        return candidate.code.toUpperCase();
    }
    return findSystemErrorCode(candidate.cause);
}
function htmlToReadableText(value) {
    return decodeHtmlEntities(value
        .replace(/<script[\s\S]*?<\/script>/gi, '\n')
        .replace(/<style[\s\S]*?<\/style>/gi, '\n')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, '\n')
        .replace(/<(?:br|\/p|\/div|\/section|\/article|\/main|\/header|\/footer|\/nav|\/aside|\/ul|\/ol|\/li|\/table|\/thead|\/tbody|\/tfoot|\/tr|\/td|\/th|\/blockquote|\/pre|\/h[1-6])\b[^>]*>/gi, '\n')
        .replace(/<(?:p|div|section|article|main|header|footer|nav|aside|ul|ol|li|table|thead|tbody|tfoot|tr|td|th|blockquote|pre|h[1-6])\b[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .filter(Boolean)
        .join('\n'));
}
function decodeHtmlEntities(value) {
    return value
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'");
}
