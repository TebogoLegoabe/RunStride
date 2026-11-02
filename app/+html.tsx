import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

// The web page around the app: makes "Add to Home Screen" open it like an app (full screen, RunStride icon),
// and stops a white flash before the dark app loads.
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en-ZA">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
        <meta name="theme-color" content="#2e0444" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="RunStride" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <ScrollViewStyleReset />
        {/* Text boxes sit inside rounded fields that already look focused, so the browser's square
            outline only clashes. On phones, 16px text stops iOS zooming in when a box is tapped. */}
        <style
          dangerouslySetInnerHTML={{
            __html:
              "body{background-color:#2e0444}input,textarea{outline:none}" +
              "@media (pointer:coarse){input,textarea{font-size:16px!important}}",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
