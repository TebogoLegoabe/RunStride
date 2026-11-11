import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

// The web page around the app: makes "Add to Home Screen" open it like an app (full screen, RunStride icon),
// and stops a white flash before the app loads.
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
              "body{background-color:#2e0444}html.light body{background-color:#f6f1fa}input,textarea{outline:none}" +
              "@media (pointer:coarse){input,textarea{font-size:16px!important}}",
          }}
        />
        {/* Light theme (chosen on the profile tab, see lib/theme.ts): switch the page color before
            the app loads so there's no purple flash, and tint the browser bar to match. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var t=localStorage.getItem("runstride.theme");' +
              'if(t==="system")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";' +
              'if(t==="light"){document.documentElement.classList.add("light");' +
              'var m=document.querySelector("meta[name=theme-color]");if(m)m.setAttribute("content","#f6f1fa")}}catch(e){}',
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
