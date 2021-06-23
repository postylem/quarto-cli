/*
* website-analytics.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/
import { warning } from "log/mod.ts";
import { join } from "path/mod.ts";
import { kTitle } from "../../../config/constants.ts";
import { Format } from "../../../config/format.ts";
import { Metadata } from "../../../config/metadata.ts";
import { mergeConfigs } from "../../../core/config.ts";
import { projectTypeResourcePath } from "../../../core/resources.ts";
import { sessionTempFile } from "../../../core/temp.ts";
import { kSite } from "./website-config.ts";
/*

site:
  google-analytics: UA-xxxx (v3)
                    G-xxxxx (v4)
site: 
  google-analytics:
    storage: "none" : "cookies"
    version: 3 | 4
    tracking-id: <>
    anonymize-ip: true | false

    REVIEW:
    THEMING:
    OTHER SCRIPT TAGS:

site:
  cookie-consent: true | false

site:
  cookie-consent:
    type: "express"
    style: "headline"
    palette: "dark"

    hypothesis / utterances
  footer preferences
*/

// tracking id for google analytics
// GA3 calls this 'tracking id'
// GA4 calls this 'measurement id'
const kGoogleAnalytics = "google-analytics";
const kTrackingId = "tracking-id";
const kStorage = "storage";
const kAnonymizeIp = "anonymize-ip";
const kVersion = "version";

// GA3 supports anonymize ip as a setting
const kCookieConsent = "cookie-consent";
const kCookieConsentType = "type";
const kCookieConsentStyle = "style";
const kCookieConsentPalette = "palette";
const kCookieConsentPolicyUrl = "policy-url";

interface GaConfiguration {
  trackingId: string;
  storage: string;
  anonymizeIp: boolean;
  consent: boolean;
  version: number;
}

export type ConsentLevel =
  | "strictly-necessary"
  | "functionality"
  | "tracking"
  | "targeting";

interface CookieConsentConfiguration {
  siteName: string;
  type: string;
  style: string;
  palette: string;
  policyUrl?: string;
}

export function scriptTagWithConsent(
  consentRequired: boolean,
  consentlevel: ConsentLevel,
  contents: string,
) {
  if (consentRequired) {
    return `
<script type="text/plain" cookie-consent="${consentlevel}">
${contents}
</script>`;
  } else {
    return `
<script type="text/javascript">
${contents}
</script>`;
  }
}

// Generate the script to inject into the head for Google Analytics
export function websiteAnalyticsScriptFile(format: Format) {
  // Find the ga tag
  const siteMeta = format.metadata[kSite] as Metadata;

  // The google analytics metadata (either from the page or the site)
  const siteGa = siteMeta[kGoogleAnalytics];

  // Deal with page and site options
  let gaConfig: GaConfiguration | undefined = undefined;
  if (typeof (siteGa) === "object") {
    const siteGaMeta = siteGa as Metadata;
    // Merge the site and page options and then layer over defaults
    const trackingId = siteGaMeta[kTrackingId] as string;
    const storage = siteGaMeta[kStorage] as string;
    const anonymizedIp = siteGaMeta[kAnonymizeIp] as boolean;
    const version = siteGaMeta[kVersion] as number;
    gaConfig = googleAnalyticsConfig(
      format,
      trackingId,
      storage,
      anonymizedIp,
      version,
    );
  } else if (siteGa && typeof (siteGa) === "string") {
    gaConfig = googleAnalyticsConfig(format, siteGa as string);
  }

  // Generate the actual GA dependencies
  if (gaConfig) {
    const script = analyticsScript(gaConfig);
    if (script) {
      return scriptFile(script);
    } else {
      return undefined;
    }
  } else {
    return undefined;
  }
}

// Generate the dependencies for cookie consent
// see: https://www.cookieconsent.com
export function cookieConsentDependencies(format: Format) {
  const siteMeta = format.metadata[kSite] as Metadata;
  if (siteMeta) {
    // The site title
    const title = siteMeta[kTitle] as string ||
      format.metadata[kTitle] as string || "";

    let configuration = undefined;
    const consent = siteMeta[kCookieConsent];
    if (typeof (consent) === "object") {
      const cookieMeta = consent as Metadata;
      configuration = cookieConsentConfiguration(
        title,
        cookieMeta[kCookieConsentType] as string,
        cookieMeta[kCookieConsentStyle] as string,
        cookieMeta[kCookieConsentPalette] as string,
        cookieMeta[kCookieConsentPolicyUrl] as string | undefined,
      );
    } else if (consent) {
      // treat consent as a boolean
      configuration = cookieConsentConfiguration(title);
    }

    if (configuration) {
      // The js file
      const name = "cookie-consent.js";
      const path = join(
        projectTypeResourcePath("website"),
        "cookie-consent",
        name,
      );

      // The dependency and script to inject
      return {
        scriptFile: scriptFile(
          cookieConsentScript(configuration),
        ),
        dependency: {
          name: "cookie-consent",
          scripts: [{
            name,
            path,
          }],
        },
      };
    } else {
      return undefined;
    }
  } else {
    return undefined;
  }
}

export function useCookieConsent(format: Format) {
  const siteMeta = format.metadata[kSite] as Metadata;
  if (siteMeta) {
    return !!siteMeta[kCookieConsent];
  } else {
    return false;
  }
}

function scriptFile(script: string) {
  const gaScriptFile = sessionTempFile({ suffix: ".js" });
  Deno.writeTextFileSync(gaScriptFile, script);
  return gaScriptFile;
}

function cookieConsentConfiguration(
  siteName: string,
  type?: string,
  style?: string,
  palette?: string,
  policyUrl?: string,
) {
  return {
    siteName,
    type: type || "implied",
    style: style || "simple",
    palette: palette || "light",
    policyUrl,
  };
}

function googleAnalyticsConfig(
  format: Format,
  trackingId: string,
  storage?: string,
  anoymizeIp?: boolean,
  version?: number,
) {
  return {
    trackingId,
    consent: useCookieConsent(format),
    storage: storage || "cookie",
    anonymizeIp: !!anoymizeIp,
    version: version || versionForTrackingId(trackingId),
  };
}

function versionForTrackingId(trackingId: string) {
  if (trackingId.startsWith("UA-")) {
    return 3;
  } else {
    return 4;
  }
}

function analyticsScript(
  config: GaConfiguration,
) {
  if (config.version === 3) {
    return ga3Script(config);
  } else if (config.version === 4) {
    return ga4Script(config);
  } else {
    return undefined;
  }
}

function ga3Script(
  config: GaConfiguration,
) {
  const coreScript = `
(function(i,s,o,g,r,a,m){i['GoogleAnalyticsObject']=r;i[r]=i[r]||function(){
  (i[r].q=i[r].q||[]).push(arguments)},i[r].l=1*new Date();a=s.createElement(o),
  m=s.getElementsByTagName(o)[0];a.async=1;a.src=g;m.parentNode.insertBefore(a,m)
  })(window,document,'script','https://www.google-analytics.com/analytics.js','ga');`;

  const createGa = config.storage === "none"
    ? `ga('create', '${config.trackingId}', { 'storage': 'none' });`
    : `ga('create', '${config.trackingId}', 'auto');`;

  const trackPage = `
ga('send', {
  hitType: 'pageview',
  'anonymizeIp': ${config.anonymizeIp},
});`;

  return scriptTagWithConsent(
    !!config.consent,
    "tracking",
    [coreScript, createGa, trackPage].join("\n"),
  );
}

function ga4Script(
  config: GaConfiguration,
) {
  const coreScript = `
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());`;

  const configGa = config.storage === "none"
    ? `gtag('config', '${config.trackingId}', { client_storage: 'none', 'anonymize_ip': ${config.anonymizeIp} });`
    : `gtag('config', '${config.trackingId}', { 'anonymize_ip': ${config.anonymizeIp} });`;

  return [
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${config.trackingId}"></script>`,
    scriptTagWithConsent(
      !!config.consent,
      "tracking",
      [coreScript, configGa].join("\n"),
    ),
  ].join("\n");
}

function cookieConsentScript(
  config: CookieConsentConfiguration,
) {
  const privacyJs = config.policyUrl !== undefined
    ? `,\n"website_privacy_policy_url":"${config.policyUrl}"`
    : "";

  return `
<script type="text/javascript" charset="UTF-8">
document.addEventListener('DOMContentLoaded', function () {
cookieconsent.run({
  "notice_banner_type":"${config.style}",
  "consent_type":"${config.type}",
  "palette":"${config.palette === "dark" ? "dark" : "light"}",
  "language":"en",
  "page_load_consent_levels":["strictly-necessary","functionality","tracking","targeting"],
  "notice_banner_reject_button_hide":false,
  "preferences_center_close_button_hide":false,
  "website_name":"${config.siteName}"${privacyJs}
  });
});
</script> 
  `;
}
