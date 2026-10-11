# Privacy Policy for Admin Toolkit for Salesforce

Last updated: October 11, 2026

Admin Toolkit for Salesforce is an independent Chrome extension for Salesforce metadata administration. It is not affiliated with, endorsed by, or sponsored by Salesforce.

## Data the Extension Handles

The extension may handle:

- Salesforce session cookies for Salesforce domains, used only to connect to the Salesforce org where the user is already signed in.
- Salesforce user and organization identity fields returned by Salesforce, such as name, username, email address, user ID, organization ID, organization name, and instance name, used to identify the active session and org.
- Salesforce metadata, setup data, org limits, event log file metadata, login history, setup audit trail rows, and records returned by user-run queries or requests.
- Salesforce object schema data used by Object Schema, including global describe results, installed-package namespaces, object and field describes, active picklist values, formulas, and reference targets.
- User-entered Apex, SOQL, SOSL, REST paths, request bodies, metadata search terms, workspace selections, and local edits.
- For the user chosen in Permission Explorer: that user's name, username and profile, the profile, permission sets and permission set groups assigned to them, and the object and field permissions those grant.
- Salesforce list view and report definitions shown in SheetD's file details, including the list view's generated SOQL and a report's format, report type, scope, filters, and created/last-modified user names, together with the rows those list views and reports return. When a report's results exceed the 2,000-row limit of Salesforce's report API, the extension requests the same report as a workbook export from that same Salesforce endpoint over the existing session.
- Local extension preferences and state such as language, selected workspace folders, selected namespaces, search settings, UI settings, recent/favorite tools, and sanitized operation history or receipts.

## How Data Is Used

The extension uses this data only to provide the user-facing extension features:

- Browse, find, search, inspect, and download Salesforce metadata.
- Build package.xml selections.
- Run Salesforce REST, SOQL, SOSL, data export, and anonymous Apex actions initiated by the user.
- View Salesforce setup audit trail, event log files, login history, org summary, and limits.
- Build an interactive object relationship map and display field details selected by the user.
- Explain which profile, permission sets and permission set groups give a chosen user access to an object or field, or compare two users.
- Open Salesforce list views, reports, and CSV/XLSX imports in a spreadsheet grid and — only for rows that carry a record Id resolving to one Salesforce object, and only after review and confirmation — update those Salesforce records.
- Store bounded, organization-specific SheetD update receipts locally so users can select recorded prior values and submit an explicitly reviewed rollback update.

## Data Sharing and Transfers

Browser API requests containing Salesforce data, identity data, authentication information, and user-entered requests are sent only to the Salesforce org selected by the user. The extension does not transfer this data to developer-operated servers.

The extension does not sell user data, does not use user data for advertising, does not use user data for credit-worthiness or lending purposes, and does not share user data with data brokers or advertising platforms.

The extension does not include usage analytics or telemetry.

## Local Storage

Workspace preferences, search data, pending edits, recent/favorite tools, sanitized operation history, and bounded SheetD update receipts may be stored locally in Chrome browser storage on the user's device. SheetD workbooks are not persisted. SheetD receipts contain only the successful update time, Salesforce object, record IDs, changed field names, and prior and updated values; they are limited to the newest 50 events and 2 MB per Salesforce organization. Operation history is limited to the most recent 100 entries and excludes session tokens and authorization headers. Files find is scoped to the loaded workspace tree. Users can clear feature-specific saved data from the extension UI where offered; removing the extension clears its Chrome-managed local storage.

## Remote Code

The extension does not load or execute remotely hosted JavaScript or WebAssembly. Extension JavaScript, HTML, CSS, and third-party spreadsheet code are packaged with the Chrome extension. Responses from the selected Salesforce org are treated as data and are not executed as code.

## Human Access

The developer does not have access to Salesforce data handled locally by the extension. The extension does not send this data to developer-operated infrastructure.

## Chrome Web Store Limited Use Disclosure

The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Contact

For privacy questions or support, use the support contact provided on the Chrome Web Store listing.
