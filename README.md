# @redeyed_/sentinel-react-native

Add the **Redeyed Sentinel** CAPTCHA to your React Native app. The widget is
rendered inside a [`react-native-webview`](https://github.com/react-native-webview/react-native-webview)
WebView (React Native has no DOM), and the solved token is bridged back to your
native code so you can verify it on your server.

> Sentinel is **free**, but you need site/API keys. Create them at
> **https://redeyed.com/developers**.

## Install

```sh
npm install @redeyed_/sentinel-react-native react-native-webview
# or
yarn add @redeyed_/sentinel-react-native react-native-webview
```

`react-native-webview` is a **peer dependency** — install it alongside this
package. On iOS, install the native pods afterwards:

```sh
cd ios && pod install && cd ..
```

(Autolinking handles the Android side; no extra steps required.)

### Peer dependencies

| Package                | Version  |
| ---------------------- | -------- |
| `react`                | `>=17`   |
| `react-native`         | `>=0.70` |
| `react-native-webview` | `>=13`   |

## Usage

```tsx
import React from 'react';
import { View } from 'react-native';
import { SentinelCaptcha } from '@redeyed_/sentinel-react-native';

export function SignupForm() {
  return (
    <View>
      <SentinelCaptcha
        siteKey="YOUR_PUBLIC_SITE_KEY"
        onVerify={(token) => {
          // Send `token` to YOUR backend, which verifies it (see below).
          console.log('Sentinel token:', token);
        }}
        onError={(err) => console.warn('Sentinel error', err)}
      />
    </View>
  );
}
```

### Props

| Prop       | Type                       | Required | Description                                                            |
| ---------- | -------------------------- | :------: | ---------------------------------------------------------------------- |
| `siteKey`  | `string`                   |   yes    | Your public Sentinel site key.                                         |
| `onVerify` | `(token: string) => void`  |   yes    | Called with the solved token. Send it to your server to verify.        |
| `onError`  | `(error: Error) => void`   |    no    | Called on widget/bridge/load errors.                                   |
| `widget`   | `string`                   |    no    | Widget variant (`data-widget`), e.g. `checkbox`, `invisible`, `badge`. |
| `theme`    | `string`                   |    no    | Widget theme (`data-theme`).                                           |
| `scheme`   | `'light' \| 'dark' \| 'auto'` |  no    | Colour scheme (`data-scheme`).                                         |
| `baseUrl`  | `string`                   |    no    | Origin serving the widget/API. Defaults to `https://redeyed.com`.      |
| `style`    | `StyleProp<ViewStyle>`     |    no    | Style for the WebView. The component auto-sizes height by default.     |

## Server-side verification (required)

The token returned to `onVerify` proves only that the challenge was completed in
the app. You **must** verify it on your own server before trusting it. Your
secret API key stays on the server and is **never** shipped inside the app.

```http
POST https://redeyed.com/api/v1/verify
X-Api-Key: YOUR_SECRET_API_KEY
Content-Type: application/json

{
  "site_key": "YOUR_PUBLIC_SITE_KEY",
  "token": "TOKEN_FROM_THE_APP"
}
```

Treat the verification as successful when the response has
`data.success === true` (or top-level `success === true`).

```js
// Example Node.js server handler
app.post('/verify-captcha', async (req, res) => {
  const r = await fetch('https://redeyed.com/api/v1/verify', {
    method: 'POST',
    headers: {
      'X-Api-Key': process.env.SENTINEL_API_KEY, // secret, server-only
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      site_key: process.env.SENTINEL_SITE_KEY,
      token: req.body.token,
    }),
  });
  const body = await r.json();
  const ok = body?.data?.success === true || body?.success === true;
  res.json({ verified: ok });
});
```

## How it works

1. The component builds a small HTML document in-package and loads it into a
   WebView via `source={{ html, baseUrl }}`.
2. That page loads `https://redeyed.com/sentinel.js` and renders
   `<div class="sentinel-captcha" data-sitekey="…">`.
3. When solved, the page catches the bubbling `sentinel:solved` CustomEvent
   (with a hidden-input fallback) and posts the token to native via
   `window.ReactNativeWebView.postMessage`.
4. The component parses the message and calls `onVerify(token)`. It also reports
   its measured height so the WebView auto-sizes to the widget.

## License

MIT © 2026 Redeyed Corporation
