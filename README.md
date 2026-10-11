# Admin Toolkit for Salesforce

Admin Toolkit for Salesforce is a Chrome extension for Salesforce administrators and developers. Its toolbar popup uses the Salesforce session you are already signed in with and opens focused apps and tools in browser tabs. Everything runs in your browser: requests go only to the Salesforce org you select, and there is no backend, analytics or telemetry.

This extension is not affiliated with, endorsed by, or sponsored by Salesforce.

## Install

- From the [Chrome Web Store](https://chromewebstore.google.com/detail/hcbaijonjdkbdhbaknaipikhobphjnjc).
- From source: open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and select this folder. Then open a Salesforce tab and click the extension.

There is no build step: the folder is the extension.

## Apps

- **DataDock for Salesforce**: read-only metadata workspace with a source-style file explorer, file search, source inspection, package.xml generation and download, and outbound change set source review.
- **Org Differences**: compare metadata between two signed-in orgs, an outbound change set and an org, or two change sets, side by side and read-only.
- **SheetD**: run SOQL queries, reports and file imports in a multi-tab spreadsheet; review confirmed updates, with bounded audit receipts for rollback.
- **Object Schema**: a focused object-relationship view with field details.
- **Permission Explorer**: why a user can (or cannot) access an object or field, traced to the profile, permission sets and permission set groups that grant it; or compare two users.

## Tools

- **Metadata search** in the popup, by label, name, API name and matching snippets.
- **REST API**: send Salesforce REST requests with the active session.
- **Run Apex Code**: run anonymous Apex and read the debug output.
- **Data Export**: SOQL, SOSL, GraphQL and report exports to copy or download.
- **Document Folders**: browse Salesforce document folders and files.
- **Monitoring**: setup audit trail, limits, login history and event log files.
- **Manual**: the built-in guide, in English and Japanese.

## Permissions

- `cookies`: reads the Salesforce `sid` cookie so the extension can use the session you are signed in with.
- `storage`: keeps workspace preferences, search data and bounded update receipts in browser storage.
- Host permissions are limited to Salesforce domains (org, Experience Cloud, Visualforce and Salesforce Sites).

See [PRIVACY_POLICY.md](PRIVACY_POLICY.md) for exactly what is read and stored.

## Code layout

- Plain JavaScript ES modules and HTML pages, one page per app or tool (`popup.html`, `schema-viewer.html`, `org-differences.html`, `force-sheet.html`, ...). `api.js` holds the Salesforce calls; `background.js` is the service worker that finds the session.
- `force-sheet.js`, `sheetd-api.js` and `sheetd-i18n.js` (SheetD) are generated from a sibling project, Sheet for Salesforce; edits made here may be overwritten by the next sync.
- `force-sheet-univer.bundle.js` / `.css` is a prebuilt bundle of the [Univer](https://univer.ai) spreadsheet engine. Its packages and licenses are listed in [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).
- User-facing text is in `i18n.js` (English and Japanese); the manual is in `manual-content.js`.

## Contributing

Issues and pull requests are welcome. Please keep the extension's principles: it works with the user's own session, changes Salesforce only through an action the user starts (and, in SheetD, reviews before it runs), sends nothing to any server other than the selected org, and asks for no new permission without a clear need.

## License

[MIT](LICENSE). Bundled third-party code keeps its own license; see [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).

Salesforce is a trademark of Salesforce, Inc. It is used here only to describe what the extension works with.
