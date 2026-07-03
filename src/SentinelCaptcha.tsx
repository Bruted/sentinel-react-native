import React, { useCallback, useMemo, useState } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

/**
 * Default origin that serves the Sentinel widget script and verify API.
 */
const DEFAULT_BASE_URL = 'https://redeyed.com';

/**
 * Visual variants supported by the Sentinel widget. These map directly to the
 * `data-widget` attribute on the embedded `<div>`.
 */
export type SentinelWidget =
  | 'checkbox'
  | 'invisible'
  | 'badge'
  | 'inline'
  | 'compact'
  | 'slider';

/**
 * Theme/colour scheme attributes understood by the Sentinel widget.
 */
export type SentinelTheme = string;
export type SentinelScheme = 'light' | 'dark' | 'auto';

/**
 * Challenge difficulty understood by the widget (maps to `data-difficulty`).
 * Named levels or a numeric 1-6. Only raises difficulty above the adaptive
 * baseline — a risky visitor is always challenged hard regardless.
 */
export type SentinelDifficulty = 'easy' | 'medium' | 'hard' | 'max' | number;

export interface SentinelCaptchaProps {
  /**
   * Public Sentinel site key. Create one for free at
   * https://redeyed.com/developers. Required.
   */
  siteKey: string;

  /**
   * Widget visual variant (maps to `data-widget`). Optional.
   */
  widget?: SentinelWidget;

  /**
   * Widget theme (maps to `data-theme`). Optional.
   */
  theme?: SentinelTheme;

  /**
   * Colour scheme (maps to `data-scheme`). Optional.
   */
  scheme?: SentinelScheme;

  /**
   * Challenge difficulty (maps to `data-difficulty`). Optional.
   */
  difficulty?: SentinelDifficulty;

  /**
   * Origin that hosts `sentinel.js` and the verify API.
   * Defaults to https://redeyed.com.
   */
  baseUrl?: string;

  /**
   * Called with the solved token when the user completes the challenge.
   * Send this token to YOUR server, which verifies it against
   * `${baseUrl}/sentinel/siteverify` with JSON body
   * `{ "secret": "<SECRET KEY>", "response": "<token>" }` (optional
   * `"remoteip"`). The Secret Key must never live inside the mobile app.
   */
  onVerify: (token: string) => void;

  /**
   * Called when the widget reports an error or the bridge fails.
   */
  onError?: (error: Error) => void;

  /**
   * Optional style for the underlying WebView container. The component
   * auto-sizes its height to the rendered widget; supplying a height here
   * overrides that behaviour.
   */
  style?: StyleProp<ViewStyle>;
}

/**
 * Message shape posted from the in-WebView bridge back to native.
 */
interface BridgeMessage {
  type: 'sentinel:token' | 'sentinel:error' | 'sentinel:height';
  token?: string;
  message?: string;
  height?: number;
}

/**
 * Escape a string for safe interpolation inside a double-quoted HTML
 * attribute. Prevents a malicious/odd site key from breaking out of the
 * attribute or injecting markup.
 */
function escapeHtmlAttribute(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Build the optional `data-*` attribute string for the widget div.
 */
function buildOptionalAttributes(
  widget?: string,
  theme?: string,
  scheme?: string,
  difficulty?: string | number,
): string {
  const parts: string[] = [];
  if (widget) {
    parts.push(`data-widget="${escapeHtmlAttribute(widget)}"`);
  }
  if (theme) {
    parts.push(`data-theme="${escapeHtmlAttribute(theme)}"`);
  }
  if (scheme) {
    parts.push(`data-scheme="${escapeHtmlAttribute(scheme)}"`);
  }
  if (difficulty !== undefined && difficulty !== null && difficulty !== '') {
    parts.push(`data-difficulty="${escapeHtmlAttribute(String(difficulty))}"`);
  }
  return parts.length ? ' ' + parts.join(' ') : '';
}

/**
 * Produce the full HTML document loaded into the WebView. It:
 *  - loads the Sentinel script from `${baseUrl}/sentinel.js`,
 *  - renders the `.sentinel-captcha` div with the supplied site key/options,
 *  - listens for the bubbling `sentinel:solved` CustomEvent (and, as a
 *    fallback, watches the injected hidden `sentinel-token` input),
 *  - bridges the solved token (plus errors and measured height) to native via
 *    `window.ReactNativeWebView.postMessage`.
 */
export function buildSentinelHtml(props: {
  siteKey: string;
  widget?: string;
  theme?: string;
  scheme?: string;
  difficulty?: string | number;
  baseUrl: string;
}): string {
  const { siteKey, widget, theme, scheme, difficulty, baseUrl } = props;
  const safeSiteKey = escapeHtmlAttribute(siteKey);
  const safeBaseUrl = escapeHtmlAttribute(baseUrl);
  const optionalAttrs = buildOptionalAttributes(widget, theme, scheme, difficulty);

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: transparent;
        overflow: hidden;
      }
      body {
        display: flex;
        justify-content: center;
        align-items: flex-start;
      }
      .sentinel-captcha {
        max-width: 100%;
      }
    </style>
  </head>
  <body>
    <div
      class="sentinel-captcha"
      data-sitekey="${safeSiteKey}"${optionalAttrs}
    ></div>
    <script src="${safeBaseUrl}/sentinel.js" async></script>
    <script>
      (function () {
        var sent = false;

        function post(payload) {
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(JSON.stringify(payload));
          }
        }

        function sendToken(token) {
          if (sent || !token) {
            return;
          }
          sent = true;
          post({ type: 'sentinel:token', token: String(token) });
        }

        // Primary path: the widget bubbles a CustomEvent with the token.
        document.addEventListener('sentinel:solved', function (event) {
          var token = event && event.detail ? event.detail.token : null;
          sendToken(token);
        });

        // Surface widget errors to native.
        document.addEventListener('sentinel:error', function (event) {
          var message =
            event && event.detail && event.detail.message
              ? event.detail.message
              : 'Sentinel widget error';
          post({ type: 'sentinel:error', message: String(message) });
        });

        // Fallback path: poll the injected hidden input that the widget
        // populates with the token (named "sentinel-token").
        var pollHandle = setInterval(function () {
          if (sent) {
            clearInterval(pollHandle);
            return;
          }
          var input =
            document.querySelector('input[name="sentinel-token"]') ||
            document.getElementById('sentinel-token');
          if (input && input.value) {
            clearInterval(pollHandle);
            sendToken(input.value);
          }
        }, 400);

        // Report content height so native can auto-size the WebView.
        function reportHeight() {
          var height = Math.max(
            document.body ? document.body.scrollHeight : 0,
            document.documentElement ? document.documentElement.scrollHeight : 0
          );
          if (height > 0) {
            post({ type: 'sentinel:height', height: height });
          }
        }

        if (window.ResizeObserver) {
          try {
            new ResizeObserver(reportHeight).observe(document.body);
          } catch (e) {
            // ignore — fall back to interval below
          }
        }
        var heightHandle = setInterval(reportHeight, 500);
        window.addEventListener('load', reportHeight);
        // Stop spamming height messages after the widget has settled.
        setTimeout(function () {
          clearInterval(heightHandle);
        }, 8000);
      })();
    </script>
  </body>
</html>`;
}

/**
 * Renders the Redeyed Sentinel CAPTCHA inside a WebView and reports the solved
 * token to `onVerify`. The token must be verified on your own server.
 *
 * @example
 * <SentinelCaptcha
 *   siteKey="pk_live_xxx"
 *   onVerify={(token) => sendToMyServer(token)}
 * />
 */
export function SentinelCaptcha(props: SentinelCaptchaProps): React.ReactElement {
  const {
    siteKey,
    widget,
    theme,
    scheme,
    difficulty,
    baseUrl = DEFAULT_BASE_URL,
    onVerify,
    onError,
    style,
  } = props;

  // Default height before the widget reports its measured size.
  const [height, setHeight] = useState<number>(96);

  const html = useMemo(
    () => buildSentinelHtml({ siteKey, widget, theme, scheme, difficulty, baseUrl }),
    [siteKey, widget, theme, scheme, difficulty, baseUrl],
  );

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let data: BridgeMessage;
      try {
        data = JSON.parse(event.nativeEvent.data) as BridgeMessage;
      } catch (err) {
        onError?.(
          err instanceof Error
            ? err
            : new Error('Failed to parse Sentinel bridge message'),
        );
        return;
      }

      switch (data.type) {
        case 'sentinel:token':
          if (data.token) {
            onVerify(data.token);
          }
          break;
        case 'sentinel:error':
          onError?.(new Error(data.message ?? 'Sentinel widget error'));
          break;
        case 'sentinel:height':
          if (typeof data.height === 'number' && data.height > 0) {
            setHeight(data.height);
          }
          break;
        default:
          break;
      }
    },
    [onVerify, onError],
  );

  const handleWebViewError = useCallback(() => {
    onError?.(new Error('Failed to load the Sentinel widget'));
  }, [onError]);

  return (
    <WebView
      originWhitelist={['*']}
      source={{ html, baseUrl }}
      onMessage={handleMessage}
      onError={handleWebViewError}
      onHttpError={handleWebViewError}
      javaScriptEnabled
      domStorageEnabled
      scrollEnabled={false}
      // Keep the WebView transparent so the widget blends into the app.
      style={[{ backgroundColor: 'transparent', height }, style]}
      // Improves transparency rendering on Android.
      androidLayerType="software"
    />
  );
}

export default SentinelCaptcha;
