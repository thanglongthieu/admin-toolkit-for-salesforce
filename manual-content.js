const MANUAL_FILES_EN = [
  {
    name: "Overview.md",
    path: "manual/overview.md",
    title: "Overview",
    content: `# Admin Toolkit for Salesforce

Admin Toolkit for Salesforce is an independent Chrome extension for Salesforce metadata inspection, search, package.xml creation, data export, REST testing, Apex execution, and monitoring. DataDock is read-only.

This extension is not affiliated with, endorsed by, or sponsored by Salesforce.

## Privacy model

- The extension runs in the browser.
- The extension uses your active Salesforce session.
- Workspace and search data are saved locally in browser storage.
- Browser requests go only to the selected Salesforce org.
- Do not use shared browser profiles for production org work.

## First run

1. Open a Salesforce org tab.
2. Open the extension toolbar popup.
3. Stay on the popup Apps tab and choose one of the five primary apps.
4. In DataDock for Salesforce, select Workspace Folders and Workspace Namespaces.
5. Click Reload Workspace when you want fresh metadata.

## Daily flow

- Use the Apps tab to open DataDock for Salesforce, Org Differences, SheetD, Object Schema, or Permission Explorer.
- Use Files to browse source-style metadata and find folders, files, labels, API names, and paths.
- Use the popup search to find metadata by label, name, API name, and matching snippets before opening supported results in Salesforce.
- Use Package XML to build, preview, copy, and download manifests from the current workspace.
- Use REST API, Run Apex Code, Data Export, and Document Folders for focused admin tasks.
- Use Monitoring and Org pages for setup, limits, history, and event log inspection.`
  },
  {
    name: "Apps.md",
    path: "manual/apps.md",
    title: "Apps",
    content: `# Apps

The popup Apps tab is the primary entry point. It contains five app cards.

## DataDock for Salesforce

- The top workspace toolbar selects folders and installed-package namespaces and reloads metadata.
- The Files sidebar shows the force-app/main/default tree. Its vertical tabs switch between Files, Package XML, and Outbound Change Sets.
- Selecting a folder or file updates the detail panel on the right.
- Outbound Change Sets lists change sets discovered from Salesforce Setup. Select one to retrieve and inspect its source inline.
- Retrieved change-set ZIPs, source files, package.xml scopes, and comparison results stay in page memory and are discarded on refresh or when the workflow is left.
- Metadata source is view-only; edit, deploy, discard, pull, delete, create, and rename actions are not shown.

## Org Differences

- Compare two different Salesforce orgs already signed in to this browser, a left-org outbound change set with a right org, or one outbound change set from each org.
- Org vs Org opens a confirmation modal before retrieval. Choose common or full metadata, select the metadata types, and optionally include packaged namespaces. Unmanaged metadata is always included.
- Change Set vs Org retrieves the selected left change set and uses its returned package.xml to retrieve the same scope from the right org. Change Set vs Change Set retrieves each selected change set from its owning org.
- Results classify every non-package source path as Same, Different, Only left, Only right, or Unsupported. Select a changed or one-sided file to inspect read-only source side by side.
- Retrieved ZIPs, manifests, source, and results stay in page memory. The app provides no deploy, pull, edit, save, or download action.

## SheetD

- The left rail provides Salesforce data, Import, and LOG actions while the spreadsheet remains visible on the right.
- Salesforce data contains Objects and Reports trees plus a filter.
- Import switches between Query, Report, and Upload. Query results can load into the current sheet or a new sheet.
- LOG opens successful updates in newest-first audit blocks. Select Rollback beside a prior-value row, review Changed fields, and confirm Update to restore it.

## Object Schema

- Start from Contact or choose another queryable object, then set parent and child depth and packaged-object scope.
- The map supports visible-object selection, search, zoom, actual-size/fit control, and horizontal or vertical layout.
- Schema Objects uses the same flat icon-and-name header pattern as SheetD. Packaged Objects defaults to none and remembers changes per Salesforce host. The Fields Univer spreadsheet loads all queryable Object Name choices at page startup with six concurrent describe workers, initially shows Contact, highlights matching global-search cells, supports object filtering, and downloads the displayed result as CSV.

## Permission Explorer

- Open Apps → Permission Explorer to inspect access assigned through a user's profile, permission sets, and permission set groups. The page is read-only and never changes permissions.
- Search for a user by name or username, then select Explain access. With no object entered, the page shows every granted object plus an assigned-access inventory covering apps, connected apps, objects and fields, Apex, Visualforce, external data sources, flows, credentials, data categories, custom permissions, custom metadata and settings, email access, system permissions, service providers, and any additional permission metadata returned by the org.
- Select a second user and choose Compare users. Leave Object blank to compare all assigned access areas, or enter an object for a scoped object-permission comparison. Comparison tables and exports contain differences only.
- Enter an object, or select Explain on any row, to see effective Read, Create, Edit, Delete, View All, and Modify All, plus the evidence: the profile, permission sets, and permission set groups that grant them, each with a Setup link.
- The object answer also lists that object's fields with their effective Read and Edit and which records grant them. Fields that field-level security does not govern are listed and marked, so a missing permission record never looks like denied access.
- A permission set group shows the grant Salesforce calculated for it. Expanding the group lists its member permission sets to explain composition; the group's muting and precedence are resolved by Salesforce, not recalculated here.
- Enter an optional field to check field-level access for that one field. Fields without a field permission record — required, master-detail, system, and some formula fields — are reported as not controlled by field permissions, which is not the same as denied.
- The inventory covers permission metadata returned by the org. Which records a user can actually see also depends on org-wide defaults, role hierarchy, sharing rules, manual and team shares, and territories, which remain outside this page.
- Export the current answer as JSON or Markdown, or the object list as CSV. Exports contain the answer and its evidence only, never a session token or unrelated users.`
  },
  {
    name: "Privacy.md",
    path: "manual/privacy.md",
    title: "Privacy",
    content: `# Privacy

Admin Toolkit for Salesforce uses your active Salesforce session to connect to the Salesforce org you choose.

## Data use

- Browser requests containing Salesforce data and user-entered requests are sent only to the selected Salesforce org.
- Workspace settings and search data are saved in browser storage on your device.
- The extension does not sell user data, use user data for ads, or send data to developer-operated infrastructure.
- The extension does not use usage analytics, telemetry, affiliate links, or remotely hosted code.

## Permissions

- Cookies: reads the Salesforce session cookie for Salesforce domains.
- Storage: saves workspace settings and search data.
- Salesforce host access: connects only to Salesforce domains used by the active org.

The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.`
  },
  {
    name: "Workspace.md",
    path: "manual/workspace.md",
    title: "Workspace",
    content: `# Workspace

Workspace controls live in the top toolbar of DataDock for Salesforce.

## Workspace Folders

Workspace Folders shows the selected and available folder counts and defines which top-level metadata folders are included. Keep the workspace small for faster startup. A practical default is common metadata plus objects.

## Workspace Namespaces

Workspace Namespaces defines which unmanaged and installed-package namespaces are included. Open the selector to filter by namespace or package name. Search selections are limited to namespaces inside this workspace.

## Reload

Reload refreshes metadata and source files for the current org. Cached metadata is reused to keep DataDock for Salesforce responsive. Use Reload when you need the latest org data.

## Local storage

- Workspace and search data are stored in browser storage.
- Metadata source is read-only and no changed-file buffers are created.`
  },
  {
    name: "Files.md",
    path: "manual/files.md",
    title: "Files",
    content: `# Files

Files is the source-style metadata explorer.

## Browse

- Folders are shown as a force-app/main/default tree.
- Aura and LWC bundles expand as folders with files such as js, html, css, xml, and design files.
- Objects include fields, list views, record types, validation rules, and web links when available.

## Find folders and files

The Files find input searches file names, folder names, API names, labels, and paths from the currently loaded workspace tree.
Press Enter or click the search button to run a find. The inline suggestions come from the currently loaded workspace tree.

## Detail page

- Click a file to open read-only source.
- Click a folder to view its child items in a sortable table with available metadata columns such as Last Modified Date.
- JSON-capable files show a JSON icon for structured JSON view.
- XML and source text can be copied from the detail actions.
- DataDock does not expose source editing or deployment actions.

## Package XML

The Package XML tab shows workspace package.xml and any custom manifest XML files. Select package.xml to open the builder, choose folders and files, preview XML, copy the generated manifest, or download the selected metadata as a ZIP.
Existing custom manifests can be inspected from the tree, but create, rename, delete, and source-edit actions are hidden in read-only mode.`
  },
  {
    name: "Search.md",
    path: "manual/search.md",
    title: "Search",
    content: `# Search

Search is now part of the Files panel. It uses the loaded workspace tree and does not call an external search service.

The popup also has a separate metadata search. It queries the selected Salesforce org with the active session, groups results by type, highlights matching text, and opens supported metadata records in Salesforce.

## How it works

- Enter a term in Files and click the search button to show matching folders and files.
- Files find matches loaded file names, folder names, API names, labels, and paths.
- Reload the workspace when you need the latest metadata tree before searching.
- Matching text is highlighted in the Files tree.
- In the popup search, use Show more to request additional ranked metadata results when the result cap is reached.
- Custom field popup results open Object Manager field detail pages by Salesforce field ID when that ID is available.

## Scope

Search is limited to folders inside Workspace Folders. Select fewer workspace folders for faster loading and rendering.

## Namespace scope

Search uses Workspace Namespaces. There is no separate Search Namespace picker.

## Result behavior

- The result list is capped for UI performance.
- Click a matching file to open its detail.
- If the metadata cache is not ready yet, reload the workspace or run the search again after the workspace finishes loading.`
  },
  {
    name: "Changed Files.md",
    path: "manual/changed-files.md",
    title: "Changed Files",
    content: `# Changed Files

DataDock for Salesforce now runs in read-only mode.

## Review

- Source bodies are displayed as highlighted, non-editable text.
- Changed Files is hidden.
- Deploy, validate, discard, pull, create, rename, and delete actions are hidden.

## Deploy

DataDock does not deploy metadata.

## Discard

There are no local metadata edits to discard.`
  },
  {
    name: "Package XML.md",
    path: "manual/package-xml.md",
    title: "Package XML",
    content: `# Package XML

Package XML creates a package.xml manifest from the current workspace.

## Tree

- The Package XML sidebar tab shows package.xml and custom manifest XML files under manifest.
- Right-click manifest or package.xml to create a custom manifest.
- Right-click a custom manifest to rename or delete it.

## Builder

- The left column lists workspace folders.
- The right column lists items in the selected folder.
- Use folder and item filters to narrow long lists.
- Use Select All and Clear All at folder or item level.

## Preview

- Preview XML shows the generated manifest.
- Copy copies the XML text.
- Download ZIP retrieves the selected metadata as a ZIP.
- Back to XML Builder returns to selection mode.`
  },
  {
    name: "Admin Tools.md",
    path: "manual/admin-tools.md",
    title: "Admin Tools",
    content: `# Admin Tools

## REST API

Send Salesforce REST API requests with the active session. Use the path builder for common endpoints, edit the API path directly when needed, and inspect JSON responses.

## Run Apex Code

Execute anonymous Apex in the active org. Review compile errors, execution errors, and debug output. Anonymous Apex can change data, so use it carefully.

## Data Export

Run SOQL, SOSL, GraphQL, or report exports against the active org. View results as a CSV grid or JSON, then copy or download the output when available.

## Document Folders

Browse Salesforce Files folders and ContentDocument records. Folder Download opens a guided dialog where you can retrieve the entire folder or selected folders/files as a ZIP. The dialog shows selection status, prevents duplicate submissions, preserves folder structure, and keeps partial failures visible.

## SheetD

Run SOQL queries, Salesforce reports, or CSV/XLSX uploads in a multi-tab spreadsheet grid. SheetD streams query pages automatically and lets you stop or resume.

- Use the left rail for Salesforce data, Import, and LOG while keeping the grid visible.
- Import has Query, Report, and Upload modes. Query results can target the current sheet or a new sheet.
- Objects and Reports trees open list views and reports directly into the grid.
- Sheet formulas such as SF_REPORT can load Salesforce report data.
- Rows carrying a Salesforce Id can use the Changed fields review card and confirmed Update.
- LOG shows bounded per-org update receipts in newest-first blocks. Select Rollback for prior-value rows, review the generated changes, and confirm Update to restore them.`
  },
  {
    name: "Monitoring.md",
    path: "manual/monitoring.md",
    title: "Monitoring",
    content: `# Monitoring

Monitoring pages read setup and usage data directly from Salesforce.

## Object Schema

- Open Apps → Object Schema for the focused three-zone map with parents left, the selected object centered, and children right.
- The business view always excludes User and audit/ownership references, keeps related custom objects, and limits standard objects to a common business catalog unless Show all standard objects is selected.
- The default map starts from Contact with one parent level and one child level. Object Name suggests queryable objects by API name or label, matching SheetD. Packaged objects default to all namespaces; search the selector by package name or namespace and choose the same namespaces exposed by DataDock.
- After building, Visible objects appears on the left of the result row and provides a filter input inside its selector. Its collapsed summary names the selected objects, and you can hide individual objects or show only the root.
- Find object on map highlights the selected object, its connecting root path, and the relationship-field labels in red. Clicking an object on the map performs the same action and synchronizes the Find input and object details. Zoom In, Zoom Out, Fit, and the Horizontal/Vertical layout selector control the map view.
- The style-isolated Univer Fields spreadsheet starts describing every queryable object offered by Object Name when the page opens. Requests use bounded concurrency and results render progressively, prioritizing Contact. Building or selecting a map object changes the sheet filter without discarding the all-object catalog. Global search filters all displayed columns, and Download CSV exports the current rows.

## Available pages

- View Setup Audit Trail shows setup changes with sortable/filterable columns.
- Limits shows API limits and usage.
- Login History shows login events.
- Event Log Files lists available event log files and download links.

## Table controls

- Click column headers to sort.
- Use column filters for spreadsheet-style filtering.
- Drag column dividers to resize.
- CSV-style data is rendered as tables; detail-style data is rendered as readable YAML.`
  }
];

const MANUAL_FILES_JP = [
  {
    name: "Overview.md",
    path: "manual/overview.md",
    title: "概要",
    content: `# Admin Toolkit for Salesforce

Admin Toolkit for Salesforce は、Salesforce メタデータの確認、検索、package.xml 作成、ソース編集、デプロイ、データエクスポート、REST 検証、Apex 実行、監視を行う独立した右サイドパネル拡張機能です。

この拡張機能は Salesforce と提携、承認、後援関係にありません。

## プライバシーモデル

- 拡張機能はブラウザ内で動作します。
- 拡張機能は現在の Salesforce セッションを使用します。
- ワークスペースデータと検索データはブラウザストレージに保存されます。
- ブラウザーからのリクエストは選択した Salesforce 組織だけに送信されます。
- 本番組織で作業する場合は、共有ブラウザプロファイルを使わないでください。

## 初回利用

1. Salesforce 組織のタブを開きます。
2. 拡張機能のサイドパネルを開きます。
3. ポップアップの Apps タブから 5 つの主要アプリのいずれかを選びます。
4. DataDock for Salesforce では Workspace Folders と Workspace Namespaces を選択します。
5. 最新のメタデータが必要な場合は Reload Workspace をクリックします。

## 日常フロー

- Apps タブから DataDock for Salesforce、組織間の差分、SheetD、Object Schema、Permission Explorer を開きます。
- Files でソース形式のメタデータを参照し、フォルダ、ファイル、API 参照名、ラベル、パスを検索します。
- ポップアップ検索では、ラベル、名前、API 参照名、一致スニペットからメタデータを探し、対応する結果を Salesforce で開けます。
- Package XML で現在のワークスペースからマニフェストを作成、プレビュー、コピー、ダウンロードします。
- REST API、Run Apex Code、Data Export、Document Folders で管理作業を行います。
- Monitoring と Org ページで設定、制限、履歴、イベントログを確認します。`
  },
  {
    name: "Apps.md",
    path: "manual/apps.md",
    title: "アプリ",
    content: `# Apps

ポップアップの Apps タブが主要な入口です。5 つのアプリカードを表示します。

## DataDock for Salesforce

- 上部のワークスペースツールバーでフォルダとインストール済みパッケージの名前空間を選択し、メタデータを再読み込みします。
- Files サイドバーには force-app/main/default ツリーを表示します。縦のタブで Files、Package XML、送信変更セットを切り替えます。
- フォルダまたはファイルを選択すると、右側の詳細パネルが更新されます。
- 送信変更セットには Salesforce 設定から検出した変更セットが表示されます。選択するとソースを取得して直接確認できます。
- 取得した変更セット ZIP、ソース、package.xml の範囲はページ内メモリだけに保持され、更新時またはこの画面を離れたときに破棄されます。
- メタデータソースは読み取り専用です。編集、デプロイ、破棄、取得、削除、作成、名前変更の操作は表示しません。

## 組織間の差分

- このブラウザーでサインイン済みの異なる 2 組織、左組織の送信変更セットと右組織、または各組織の送信変更セット同士を比較します。
- 組織 vs 組織では、取得前に確認モーダルを開きます。よく使うメタデータまたはすべてのメタデータを選び、必要なパッケージ名前空間を追加します。管理対象外メタデータは常に含まれます。
- 変更セット vs 組織では、選択した左側の変更セットを取得し、返された package.xml で右組織から同じ範囲を取得します。変更セット vs 変更セットでは、それぞれの所有組織から選択した変更セットを取得します。
- package.xml 以外の各ソースパスを、同一、差分あり、左のみ、右のみ、未対応に分類します。差分または片側だけのファイルを選ぶと、読み取り専用ソースを並べて確認できます。
- 取得した ZIP、マニフェスト、ソース、結果はページ内メモリだけに保持します。デプロイ、取得、編集、保存、ダウンロード操作はありません。

## SheetD

- 左レールには Salesforce データ、Import、LOG の操作があり、右側にはスプレッドシートを常に表示します。
- Salesforce データには Objects、Reports のツリーとフィルターがあります。
- Import は Query、Report、Upload を切り替えます。クエリ結果は現在のシートまたは新しいシートへ読み込めます。
- LOG は成功した更新を新しい順の監査ブロックで表示します。以前の値の行で Rollback を選択し、変更項目を確認して Update を確定すると復元できます。

## Object Schema

- Contact または別のクエリ可能なオブジェクトを選び、親・子の階層とパッケージオブジェクト範囲を設定します。
- 表示オブジェクト選択、マップ内検索、ズーム、実寸・全体表示、水平・垂直レイアウトを利用できます。
- マップ上のオブジェクトを選ぶと、検索入力、リレーション詳細、項目一覧が同期します。

## Permission Explorer

- Apps → Permission Explorer では、ユーザーのプロファイル、権限セット、権限セットグループから割り当てられたアクセスを確認できます。このページは読み取り専用で、権限を変更することはありません。
- 氏名またはユーザー名でユーザーを検索し、「アクセスを確認」を選択します。オブジェクトを入力しない場合は、許可されたすべてのオブジェクトに加え、アプリ、接続アプリ、オブジェクトと項目、Apex、Visualforce、外部データソース、フロー、認証情報、データカテゴリ、カスタム権限、カスタムメタデータと設定、メールアクセス、システム権限、サービスプロバイダー、組織から返されたその他の権限メタデータを一覧表示します。
- 2 人目のユーザーを選んで「ユーザーを比較」を実行します。オブジェクトを空欄にすると割り当て済みアクセス領域全体を比較し、オブジェクトを入力するとそのオブジェクト権限だけを比較します。比較画面とエクスポートには差分のみが含まれます。
- オブジェクトを入力するか、一覧の行で「確認」を選択すると、有効な参照・作成・編集・削除・すべて表示・すべて変更と、その根拠となるプロファイル、権限セット、権限セットグループを設定へのリンク付きで表示します。
- オブジェクトの回答には、そのオブジェクトの項目一覧も含まれます。各項目の有効な参照・編集と、権限を付与しているレコードを表示します。項目レベルセキュリティの対象外の項目も一覧に表示し、その旨を明示するため、権限レコードがないことがアクセス拒否と混同されることはありません。
- 権限セットグループには Salesforce が計算した権限を表示します。展開するとメンバー権限セットを一覧表示しますが、ミュートや優先順位の再計算は行いません。
- 任意で項目を入力すると、その 1 項目の参照・編集を確認できます。項目権限レコードがない項目 (必須項目、主従関係、システム項目、一部の数式項目) は「項目レベルセキュリティの対象外」と表示し、アクセス拒否とは区別します。
- 一覧には組織から返された権限メタデータが含まれます。ユーザーが実際に参照できるレコードは、組織の共有設定、ロール階層、共有ルール、手動共有やチーム共有、テリトリーにも依存し、このページの対象外です。
- 回答は JSON または Markdown、オブジェクト一覧は CSV でダウンロードできます。ダウンロードにセッショントークンや無関係なユーザーは含まれません。`
  },
  {
    name: "Privacy.md",
    path: "manual/privacy.md",
    title: "プライバシー",
    content: `# プライバシー

Admin Toolkit for Salesforce は、選択した Salesforce 組織へ接続するために現在の Salesforce セッションを使用します。

## データ利用

- Salesforce データとユーザー入力を含むブラウザーリクエストは、選択した Salesforce 組織にのみ送信されます。
- ワークスペース設定と検索データはユーザー端末のブラウザストレージに保存されます。
- この拡張機能はユーザーデータを販売せず、広告目的で使用せず、開発者運用インフラへ送信しません。
- この拡張機能は使用状況分析、テレメトリ、アフィリエイトリンク、リモートホストされたコードを使用しません。

## 権限

- Cookies: Salesforce ドメインの Salesforce セッション Cookie を読み取ります。
- Storage: ワークスペース設定と検索データを保存します。
- Side panel: Chrome のサイドパネルで拡張機能を開きます。
- Salesforce ホストアクセス: アクティブな組織で使用される Salesforce ドメインに接続します。

Google API から受け取った情報の使用は、Limited Use 要件を含む Chrome Web Store User Data Policy に従います。`
  },
  {
    name: "Workspace.md",
    path: "manual/workspace.md",
    title: "ワークスペース",
    content: `# Workspace

Workspace の操作は DataDock for Salesforce 上部のツールバーにあります。

## Workspace Folders

Workspace Folders は選択数と利用可能なフォルダ数を表示し、対象に含めるトップレベルのメタデータフォルダを定義します。起動を速くするには対象を絞ってください。実用的な初期値は共通メタデータと objects です。

## Workspace Namespaces

Workspace Namespaces は unmanaged とインストール済みパッケージの名前空間を定義します。セレクター内では名前空間またはパッケージ名で絞り込めます。Search の選択肢は、このワークスペース内の名前空間に限定されます。

## Reload

Reload は現在の組織のメタデータ定義とソースファイルを更新します。DataDock for Salesforce を快適に使えるよう、キャッシュされたメタデータを再利用します。最新の組織データが必要な場合は Reload を使用します。

## ローカル保存

- ワークスペースデータと検索データはブラウザストレージに保存されます。
- メタデータソースは読み取り専用で、変更ファイルのバッファーは作成されません。`
  },
  {
    name: "Files.md",
    path: "manual/files.md",
    title: "Files",
    content: `# Files

Files はソース形式のメタデータエクスプローラーです。

## 参照

- force-app/main/default 形式のフォルダツリーを表示します。
- Aura と LWC は js、html、css、xml、design などを含むフォルダとして表示します。
- Object は可能な場合、fields、list views、record types、validation rules、web links を含みます。

## Find folders and files

Files の検索入力は、現在読み込まれているワークスペースツリーのファイル名、フォルダ名、API 参照名、ラベル、パスを検索します。
Enter または検索ボタンで検索を実行します。入力候補は現在読み込まれているワークスペースツリーから作られます。

## 詳細ページ

- ファイルをクリックすると読み取り専用のソースを開きます。
- フォルダをクリックすると子項目を表で表示し、Last Modified Date など利用可能なメタデータ列をソートできます。
- JSON 対応ファイルには構造化 JSON 表示アイコンが出ます。
- XML とソーステキストは詳細アクションからコピーできます。
- DataDock にはソース編集やデプロイの操作はありません。

## Package XML

Package XML タブには workspace package.xml とカスタム manifest XML ファイルが表示されます。package.xml を選択するとビルダーを開き、フォルダとファイルを選択して XML のプレビュー、コピー、選択メタデータの ZIP ダウンロードができます。
既存のカスタム manifest はツリーから参照できますが、読み取り専用モードでは作成、名前変更、削除、ソース編集の操作は表示しません。`
  },
  {
    name: "Search.md",
    path: "manual/search.md",
    title: "Search",
    content: `# Search

Search は Files パネルに統合されています。読み込み済みのワークスペースツリーを使い、外部検索サービスは呼び出しません。

ポップアップにも別のメタデータ検索があります。現在の Salesforce セッションで選択中の組織を検索し、種類別に結果をまとめ、一致テキストをハイライトし、対応するメタデータレコードを Salesforce で開きます。

## 仕組み

- Files に検索語を入力して検索ボタンをクリックすると、一致するフォルダとファイルを表示します。
- Files 検索は読み込み済みのファイル名、フォルダ名、API 参照名、ラベル、パスに一致します。
- 最新のメタデータツリーで検索したい場合はワークスペースを再読み込みします。
- 一致テキストは Files ツリー内でハイライトされます。
- ポップアップ検索で表示上限に達した場合は Show more で追加の候補を取得できます。
- カスタム項目のポップアップ結果は、利用可能な場合 Salesforce の項目 ID で Object Manager の項目詳細を開きます。

## 範囲

検索対象は Workspace Folders 内のフォルダに限定されます。高速化するにはワークスペースフォルダを少なくします。

## 名前空間

Search は Workspace Namespaces を使います。Search 専用の Namespace 選択はありません。

## 結果表示

- UI 性能のため、表示件数には上限があります。
- 一致ファイルをクリックすると詳細を開きます。
- ワークスペースデータがまだ準備できていない場合は、ワークスペースを再読み込みするか、読み込み完了後にもう一度検索します。`
  },
  {
    name: "Changed Files.md",
    path: "manual/changed-files.md",
    title: "Changed Files",
    content: `# Changed Files

DataDock for Salesforce は読み取り専用モードで動作します。

## 確認

- ソース本文は編集できないハイライト表示で開きます。
- Changed Files は表示しません。
- デプロイ、検証、破棄、取得、作成、名前変更、削除の操作は表示しません。

## デプロイ

DataDock はメタデータをデプロイしません。

## 破棄

破棄対象となるローカルのメタデータ編集は作成されません。`
  },
  {
    name: "Package XML.md",
    path: "manual/package-xml.md",
    title: "Package XML",
    content: `# Package XML

Package XML は現在のワークスペースから package.xml マニフェストを作成します。

## Tree

- Package XML サイドバータブには manifest 配下の package.xml とカスタム manifest XML ファイルが表示されます。
- manifest または package.xml を右クリックするとカスタム manifest を作成できます。
- カスタム manifest を右クリックすると名前変更または削除できます。

## Builder

- 左列にはワークスペースフォルダが表示されます。
- 右列には選択フォルダ内の項目が表示されます。
- フォルダと項目のフィルタで長いリストを絞り込めます。
- フォルダ単位または項目単位で Select All と Clear All を使えます。

## Preview

- Preview XML は生成されたマニフェストを表示します。
- Copy は XML テキストをコピーします。
- Download ZIP は選択済みメタデータを ZIP として取得します。
- Back to XML Builder は選択画面へ戻ります。`
  },
  {
    name: "Admin Tools.md",
    path: "manual/admin-tools.md",
    title: "Admin Tools",
    content: `# Admin Tools

## REST API

アクティブセッションで Salesforce REST API リクエストを送信します。よく使うエンドポイントはパスビルダーを使い、必要に応じて API Path を直接編集し、JSON レスポンスを確認します。

## Run Apex Code

アクティブな組織で匿名 Apex を実行します。コンパイルエラー、実行エラー、デバッグ出力を確認します。匿名 Apex はデータを変更できるため注意して使ってください。

## Data Export

アクティブな組織で SOQL、SOSL、GraphQL、レポートエクスポートを実行できます。結果は CSV グリッドまたは JSON で確認し、必要に応じてコピーまたはダウンロードできます。

## Document Folders

Salesforce Files フォルダと ContentDocument レコードを参照します。フォルダの Download ダイアログでは、フォルダ全体または選択したフォルダ・ファイルを ZIP として取得できます。選択状態を表示し、重複実行を防止し、フォルダ構造と部分失敗情報を保持します。

## SheetD

SOQL クエリ、Salesforce レポート、CSV/XLSX アップロードをマルチタブのスプレッドシートで扱えます。クエリページは自動ストリーミングされ、停止・再開できます。

- 左レールで Salesforce データ、Import、LOG を使いながら、グリッドを表示したまま操作できます。
- Import には Query、Report、Upload モードがあります。クエリ結果は現在のシートまたは新しいシートを選べます。
- Objects と Reports ツリーからリストビューやレポートをグリッドに開けます。
- SF_REPORT などのシート数式で Salesforce レポートデータを読み込めます。
- Salesforce ID を持つ行は、変更項目カードで内容を確認し、確定した Update を実行できます。
- LOG は組織別に上限を設けた更新証跡を新しい順で表示します。以前の値の行で Rollback を選び、生成された変更を確認して Update を確定すると復元できます。`
  },
  {
    name: "Monitoring.md",
    path: "manual/monitoring.md",
    title: "Monitoring",
    content: `# Monitoring

Monitoring ページは Salesforce から設定情報と利用状況を直接読み込みます。

## Object Schema

- Apps → Object Schema では、親を左、選択オブジェクトを中央、子を右に配置する集中型の3ゾーンマップを表示します。
- ビジネス表示では User と監査・所有者リレーションを常に除外し、関連カスタムオブジェクトを保持しつつ、標準オブジェクトは一般的な業務オブジェクトに限定します。
- 既定では Contact をルートに、親 1 階層・子 1 階層でマップを作成します。「オブジェクト名」では SheetD と同様に、クエリ可能なオブジェクトを API 参照名または表示ラベルで候補表示します。パッケージオブジェクトは既定ですべての名前空間を含み、セレクター内でパッケージ名または名前空間を検索して、DataDock と同じ名前空間から対象を選べます。
- 作成後はステータスと「表示オブジェクト」セレクターを同じ行に表示します。折りたたみ時にも選択した API 参照名を表示し、既定ですべての利用可能なオブジェクトを選択します。個別に非表示にしたりルートだけを表示したりできます。パッケージオブジェクトと表示オブジェクトのポップアップは、外側をクリックすると閉じます。
- マップ内検索では、対象オブジェクト、ルートまでの接続経路、リレーション項目名を赤色で強調表示します。マップ上のオブジェクトをクリックしても同じ操作となり、検索入力と詳細表示が同期します。ズームイン、ズームアウト、全体表示、水平・垂直レイアウトの切り替えを利用できます。
- Univer 項目スプレッドシートはページ表示時に「オブジェクト名」で選択可能な全クエリ可能オブジェクトの describe を開始します。6 件ずつ処理して Contact を優先表示し、スキーマ図の作成やマップ選択では全オブジェクト一覧を保持したままフィルターだけを同期します。全体検索と CSV ダウンロードも利用できます。

## 利用可能なページ

- View Setup Audit Trail は設定変更履歴をソート・フィルタ可能な列で表示します。
- Limits は API 制限と使用量を表示します。
- Login History はログインイベントを表示します。
- Event Log Files は利用可能なイベントログファイルとダウンロードリンクを表示します。

## テーブル操作

- 列ヘッダーをクリックしてソートします。
- 列フィルタでスプレッドシート風に絞り込みます。
- 列境界をドラッグして幅を変更します。
- CSV 形式のデータはテーブル、詳細形式のデータは読みやすい YAML として表示されます。`
  }
];

const VERSION_FILES_EN = [
  {
    name: "v0.11.0.md",
    path: "versions/v0.11.0.md",
    title: "0.11.0",
    content: `# 0.11.0

Released: 2026-10-11

## Removed

- Org Review, Winter '27 Release Note Review and Transaction Timeline are no longer part of the extension. The popup now opens five apps: DataDock for Salesforce, Org Differences, SheetD, Object Schema and Permission Explorer.
- The local data those pages kept (Org Review baselines and cleanup tasks, Winter '27 review decisions, recent Transaction Timeline requests) is no longer read; removing or reinstalling the extension clears it.

## Changed

- Admin Toolkit for Salesforce is now open source under the MIT license: https://github.com/thanglongthieu/admin-toolkit-for-salesforce
- No browser permission, host permission, telemetry, analytics, remote code, or developer-operated backend was added in this release.
`
  },
  {
    name: "v0.10.0.md",
    path: "versions/v0.10.0.md",
    title: "0.10.0",
    content: `# 0.10.0

Released: 2026-09-11

## Added

- Org Review becomes a composed review pipeline rather than a single report. Read-only collectors now cover Apex, Health Check, certificates, login and session policy, OAuth and connected-app exposure, sharing defaults, async operations, and an evidence-based permission sweep. Findings feed a baseline and history store, an impact view, and a cleanup workflow with Review and Verified states. The report carries 20 collapsible sections.
- Winter '27 release review is a new page: a Salesforce release-note catalogue with its own review UI, opened from the app launcher.

## Changed

- New product mark across the toolbar icon, extension pages, and Store assets: the Three Tone Fan identity in Admin Toolkit indigo, replacing the previous neon treatment. Promotional tiles were regenerated from the same master.
- No browser permission, host permission, telemetry, analytics, remote code, or developer-operated backend was added in this release.
`
  },
  {
    name: "v0.9.1.md",
    path: "versions/v0.9.1.md",
    title: "0.9.1",
    content: `# 0.9.1

Released: 2026-08-08

## Added

- Org Differences is now a standalone popup app. Compare confirmed metadata types between two signed-in orgs, a left-org outbound change set with a right org, or one outbound change set from each org. Results and source details are read-only and remain in page memory.
- DataDock now retrieves source directly from a listed outbound change set and opens it inline. Embedded org comparison has moved out of DataDock; use the standalone Org Differences app instead.
- The imported manifest stays only in page memory and is cleared explicitly or when the comparison mode changes. The feature does not deploy, pull, persist the manifest, or add a Chrome permission.

## Fixed

- SheetD keeps a Favorites folder named \`Default\` when the workspace reloads in Japanese. Creating it was allowed, because the built-in folder is shown as デフォルト, but the next load discarded the folder and moved its favorites into the built-in one.
- Editing which folders a SheetD favorite belongs to leaves the favorite where it was. Saving the folder list, even without changing it, used to move the favorite to the bottom of its folder and discard the order set by dragging.
- Dragging the divider between the Files tree and file details in DataDock no longer stores the column width on every pointer movement, which made the drag stutter. The width is stored once, when the drag ends.
- The Workspace Folders and Namespaces menus stay inside the Files panel when the divider narrows it. Their header did not shrink with the panel, so the buttons were cut off at the right and the folder list opened past the panel's left edge, hiding part of it. The header now shrinks with the panel, the button labels shorten, and both lists open across the panel width.
`
  },
  {
    name: "v0.9.0.md",
    path: "versions/v0.9.0.md",
    title: "0.9.0",
    content: `# 0.9.0

Released: 2026-08-05

## Changed

- DataDock no longer nests every file under \`force-app/main/default\`. Those three folders still exist behind the scenes, so retrieved paths and generated package.xml are unchanged, but the tree now opens straight into \`objects\`, \`classes\`, \`flows\` and the installed-package namespaces. Reaching a field takes four folder openings instead of seven.
- Tree rows are tighter and drop the file and folder icons, and each level indents less, so long API names such as \`Strategic_Account_Tier_Classification__c\` stay readable at depth instead of being pushed off the right edge.
- The toolbar row above the workbench is gone. Workspace Folders and Namespaces moved into the Files panel header because they only scope the tree, and Reload Workspace moved to the foot of the icon rail. The header now shows the path to the selected file as a breadcrumb.
- File details are a docked, resizable column with a toggle in the icon rail, and the divider between the tree and the details column now sizes the details column. The collapsed state is remembered per browser profile.
- Every tree row has a ⋮ button that opens the same menu as right-clicking it, so the row actions are visible instead of hidden. The menu gained Copy path, which works on any row.

## Comparison

- Org comparison is available in the standalone Org Differences app instead of DataDock.

## Known limitations

- DataDock is read-only. Source editors, Changed Files, deploy/discard actions, and manifest create/rename/delete actions are hidden.
`
  },
  {
    name: "v0.8.0.md",
    path: "versions/v0.8.0.md",
    title: "0.8.0",
    content: `# 0.8.0

Released: 2026-07-25

## Changed

- SheetD now runs the same engine as Sheet for Salesforce. A Salesforce data tree browses Objects and Reports, and each opens directly as editable data — there is no separate read-only mode to switch out of.
- A file details panel, opened from a tree row's right-click menu or the header toggle, shows a file's Salesforce record fields in cards, together with the list view's generated SOQL or the report's filters. It follows whichever file the active sheet shows.
- The report browser lists Public Reports, holding the reports that have no folder parent, and Private Reports, holding the signed-in user's own personal reports, as their own entries beside the org's named report folders. Salesforce returns only the signed-in user's private reports, never another user's.
- The report list now pages through every report in the org instead of stopping at the first 2,000 rows, so report-heavy orgs no longer lose whole folders off the end of the list.
- A report whose results exceed Salesforce's 2,000-row API cap now says so, reporting how many rows arrived against the report's real total, instead of presenting the truncated result as the complete report.
- Past that cap SheetD requests the report as a workbook from the same Salesforce report API, which returns the report in full — including joined reports, the only export format they support — and falls back to the capped rows plus the warning whenever that export is unavailable.
- Edited cells are collected into a "Changed fields" card at the top of the file details panel, listing each record Id with its field-level before and after values, and an Update button that raises a confirmation modal before writing to Salesforce. A picklist picker fills constrained fields and errors are reported per row. Object list views load every page of results rather than stopping at the first 2,000 rows.
- A LOG rail action opens successful updates as newest-first audit blocks. Each block shows Object > Update Datetime, fields including Id, and prior row values. Selecting Rollback sends only those rows through the same Changed fields review and confirmation flow. Receipts are capped at 50 events and 2 MB per org.
- Removed the previous Salesforce CRUD panel. Insert, Upsert, and the spreadsheet column-mapping and preview workflow are no longer part of SheetD; it now edits records it has loaded rather than loading new rows from a sheet.`
  },
  {
    name: "v0.7.0.md",
    path: "versions/v0.7.0.md",
    title: "0.7.0",
    content: `# 0.7.0

Released: 2026-07-17

## Added

- Permission Explorer, a new read-only app that answers why a user can access an object or field. Open it from Apps → Permission Explorer.
- Selecting a user and choosing Explain access lists every object the user's assigned records grant, with a Granted by column and a count of objects granted by more than one record — the objects where revoking a single record would not remove access.
- Entering an object shows effective Read, Create, Edit, Delete, View All, and Modify All, plus the profile, permission sets, and permission set groups that grant them, each with a Setup link.
- The object drill-down also lists every field with effective Read and Edit and its granting records. Fields outside field-level security remain visible and are marked as not controlled rather than denied.
- Permission set groups show the grant Salesforce calculated, and expand to list their member permission sets. Muting and group precedence are resolved by Salesforce and are not recalculated in the extension.
- An optional field check reports field-level Read and Edit for one field. Fields with no field permission record are reported as not controlled by field permissions rather than as denied.
- Answers can be exported as JSON or Markdown, and the object list as CSV. Exports never contain a session token or unrelated users.
- The browser action remains available on the bare extension root URL as well as normal Admin Toolkit pages, so the toolbar popup can always be reopened.

## Notes

- Permission Explorer is read-only and never changes permissions.
- Every answer states that it explains object and field permissions only. Record visibility also depends on org-wide defaults, role hierarchy, sharing rules, manual and team shares, and territories, which this page does not evaluate.
- The feature adds no new browser permission and no new Salesforce host permission.`
  },
  {
    name: "v0.6.2.md",
    path: "versions/v0.6.2.md",
    title: "0.6.2",
    content: `# 0.6.2

Released: 2026-07-15

## Fixed

- Checking or clearing a Document Folders folder now applies recursively to its complete loaded subtree. Lazy folders resolve atomically, parent checkboxes show mixed state correctly, and the synthetic Workspace Folders root cannot be selected or used for Salesforce folder mutations.
- Duplicate ContentDocument occurrences are selected independently and retain their folder paths in ZIP output. Selected Items reports file occurrences and unique documents when they differ.

## Improved

- ZIP preparation is limited to 500 file occurrences and 250 MB of known content, warns for large or partly unknown downloads, reuses duplicate document content, and can be canceled.
- Object Schema is now an Apps-only page with its own connection header and shared English/Japanese language selector. Retired Tool favorites and recents are removed automatically.
- Relationship traversal is deterministic and protected by a backend-only 100-object safety limit. The accessible relationship table appears only after a successful build.
- The primary action is Build Schema View. Object Name is compact on desktop and remains full-width without horizontal page overflow at side-panel width.
- Object Schema now uses the flat SheetD header pattern with only the Schema Objects icon and name. Packaged Objects and Show all standard objects define the Object Name catalog and the all-object Fields sheet. Fields retrieves the catalog in parallel and renders once after loading completes. The field count appears inline beside the Fields heading, the Build Schema View and Reset actions are vertically centered, and the sheet frame grows with the available app height. Its Object filter and Global search controls use compact inline labels; Enter runs a search, × clears it, and matching cells are highlighted. The sheet also has native column filters, CSV download, and full-screen mode. Packaged Objects defaults to none and remembers host-specific changes.
- DataDock for Salesforce and Org Review now use the same compact standalone app header as Object Schema: app icon and name on the left, live status and language on the right, and no Tools navigation inside the app page.
- The browser-action popup can now be opened while the active tab is an Admin Toolkit extension page, without requesting the broad Tabs permission.`
  },
  {
    name: "v0.6.1.md",
    path: "versions/v0.6.1.md",
    title: "0.6.1",
    content: `# 0.6.1

Released: 2026-07-14

## Improved

- Document Folders downloads are now selection-based. Check folders and files directly in the tree, review the selection in the detail panel, and download the ZIP from the Download button in the panel header. The folder action button row and the download dialog were removed; Download, Create Folder, Rename, and Upload remain available from the tree context menu.
- The popup Apps tab now includes Object Schema, and SheetD is no longer duplicated on the Tools tab. Object Schema defaults to Contact with one parent and one child level and adds object suggestions, searchable packaged-object namespace selection, named visible-object selection, click-away popups, synchronized map/find interaction, red relationship-path labels, zoom, horizontal/vertical layouts, and field values for picklists, formulas, or references.
- The tools page navigation no longer lists Org Review, which opens from the popup Apps tab.
- Refined English and Japanese interface text, including the Salesforce-standard Japanese term for Setup Audit Trail.
- Added THIRD-PARTY-NOTICES.txt with license attributions for the open-source packages bundled in the SheetD spreadsheet engine.`
  },
  {
    name: "v0.6.0.md",
    path: "versions/v0.6.0.md",
    title: "0.6.0",
    content: `# 0.6.0

Released: 2026-07-11

## New

- Org Review provides an independently loading overview of org identity, API limits, security health, Apex coverage, automation, integrations, recent setup changes, login failures, event logs, and local state. Collection is read-only; the only write is the sandbox-only cleanup deletion described under Apps.
- Consistent org identity, risk information, and explicit confirmations protect Apex, data mutation, and metadata deployment workflows.
- Metadata Changed Files supports Validate Selected before deployment and records sanitized local operation receipts.

## Improved

- SheetD workspace files own isolated grids. Values and formulas remain associated with the correct file across switching and reload.
- Document Folders automatically previews supported files, gates large previews, provides correctly named downloads, preserves folder structure in ZIPs, and reports partial failures.
- New app icons, logo, and Chrome Web Store promotional artwork use one Admin Toolkit visual identity.
- Release validation checks version alignment, required assets, forbidden files, and exact image dimensions before packaging.

## Privacy

- The extension remains local-first with no telemetry, ads, or third-party data service. Operation history is sanitized and stored only in the browser.`
  },
  {
    name: "v0.5.0.md",
    path: "versions/v0.5.0.md",
    title: "0.5.0",
    content: `# 0.5.0

Released: 2026-06-29

## New

- SheetD: run SOQL queries and view results in a multi-tab spreadsheet grid. Results stream automatically across all pages with Stop and Resume controls. Tabs are saved locally per org.

## Fixed

- Files folder detail item lists keep Last Modified Date visible when row data has it.
- Files folder detail item lists no longer show an empty Last Modified Date column when no row has that field.

## Improved

- Files folder detail item list columns are now sortable with visible ascending, descending, and neutral sort icons.
- Folder table search and large-folder batched rendering continue to work after a sort is applied.
- Monitoring pages (Setup Audit Trail, Limits, Login History, Event Log Files) open cleanly without a host query parameter using stored session fallback.
- Extension pages declare an explicit content security policy in the manifest.
- Manual includes a Versions folder with release notes for each version.
- Popup shows the current version number and opens the release notes when clicked.`
  },
  {
    name: "v0.4.5.md",
    path: "versions/v0.4.5.md",
    title: "0.4.5",
    content: `# 0.4.5

## Improved

- Popup org and user summary loading uses Promise.allSettled so a failed summary no longer hides the extension.
- Popup metadata search groups results by type and shows ranked matched text with Show more for additional results.
- Files find searches folder names, file names, API names, labels, and paths in the current workspace tree.
- Custom field popup results open Object Manager field detail pages by Salesforce field ID when available.`
  },
  {
    name: "v0.4.4.md",
    path: "versions/v0.4.4.md",
    title: "0.4.4",
    content: `# 0.4.4

## Improved

- Document Folders auto-previews text, image, PDF, audio, and video documents.
- Document Folders supports ZIP download for selected folders and files.
- Run Apex Code shows execute-anonymous results and extracted System.debug output.
- Files tree supports back and forward navigation and secondary labels.`
  },
  {
    name: "v0.4.3.md",
    path: "versions/v0.4.3.md",
    title: "0.4.3",
    content: `# 0.4.3

## Improved

- Data Export supports SOQL, SOSL, GraphQL, and report exports.
- Data Export renders results as a CSV grid or JSON with copy and download support.
- Joined reports direct users to Excel or JSON when CSV is not available.
- REST API path builder supports common endpoint templates.`
  },
  {
    name: "v0.4.2.md",
    path: "versions/v0.4.2.md",
    title: "0.4.2",
    content: `# 0.4.2

## Initial release

- DataDock for Salesforce with workspace folder and namespace selection.
- Source-style Files explorer with lazy loading.
- Changed Files tracking, deploy, and discard flow.
- Package XML builder with preview, copy, and ZIP download.
- REST API, Run Apex Code, Data Export, Document Folders, and Monitoring tools.
- Built-in English and Japanese manual.`
  }
];

const VERSION_FILES_JP = [
  {
    name: "v0.11.0.md",
    path: "versions/v0.11.0.md",
    title: "0.11.0",
    content: `# 0.11.0

リリース日: 2026-10-11

## 削除

- 組織レビュー、Winter '27 リリースノートレビュー、Transaction Timeline を拡張機能から削除しました。ポップアップから開くアプリは DataDock for Salesforce、組織間の差分、SheetD、Object Schema、Permission Explorer の 5 つです。
- これらのページが保存していたローカルデータ（組織レビューのベースラインとクリーンアップタスク、Winter '27 のレビュー記録、Transaction Timeline の最近のリクエスト）は読み込まれなくなりました。拡張機能を削除または再インストールすると消去されます。

## 変更

- Admin Toolkit for Salesforce を MIT ライセンスのオープンソースとして公開しました: https://github.com/thanglongthieu/admin-toolkit-for-salesforce
- 本リリースでは、ブラウザー権限、ホスト権限、テレメトリー、分析、リモートコード、開発者が運用するバックエンドの追加はありません。
`
  },
  {
    name: "v0.10.0.md",
    path: "versions/v0.10.0.md",
    title: "0.10.0",
    content: `# 0.10.0

リリース日: 2026-09-11

## 追加

- 組織レビューを単一レポートから、組み合わせ型のレビューパイプラインに刷新しました。読み取り専用のコレクターが Apex、ヘルスチェック、証明書、ログイン・セッションポリシー、OAuth と接続アプリの露出、共有設定、非同期処理、証跡ベースの権限スイープを対象にします。検出結果はベースラインと履歴、影響ビュー、確認済み状態を持つクリーンアップ作業へ引き継がれます。レポートは 20 個の折りたたみセクションで構成されます。
- 新しいページ「Winter '27 リリースレビュー」を追加しました。Salesforce のリリースノートを独自のレビュー UI で確認でき、アプリランチャーから開けます。

## 変更

- ツールバーアイコン、拡張機能の各ページ、ストア用アセットの製品マークを刷新しました。従来のネオン表現に代えて、Admin Toolkit のインディゴによる Three Tone Fan を採用しています。プロモーション画像も同じマスターから再生成しました。
- 本リリースでは、ブラウザー権限、ホスト権限、テレメトリー、分析、リモートコード、開発者が運用するバックエンドの追加はありません。
`
  },
  {
    name: "v0.9.1.md",
    path: "versions/v0.9.1.md",
    title: "0.9.1",
    content: `# 0.9.1

リリース日: 2026-08-08

## 追加

- 「組織間の差分」を独立したポップアップアプリとして追加しました。確認したメタデータ型を 2 つのサインイン済み組織間、左組織の送信変更セットと右組織間、または各組織の送信変更セット間で比較できます。結果とソース詳細は読み取り専用で、ページ内メモリだけに保持します。
- メタデータ管理で、一覧の送信変更セットからソースを直接取得して表示できるようになりました。組織比較は独立した「組織間の差分」アプリに集約しました。
- 読み込んだ manifest はページ内メモリだけに保持され、明示的なクリアまたは比較モードの変更で破棄されます。デプロイ、取得、manifest の永続化、Chrome 権限の追加は行いません。

## 修正

- 日本語表示でワークスペースを再読み込みしても、SheetD の \`Default\` という名前のお気に入りフォルダーが保持されるようになりました。組み込みフォルダーは「デフォルト」と表示されるため作成は許可されていましたが、次回の読み込みでフォルダーが破棄され、中のお気に入りが組み込みフォルダーへ移動していました。
- SheetD のお気に入りが所属するフォルダーを編集しても、そのお気に入りの表示位置が変わらないようになりました。これまでは変更せずに保存した場合でもフォルダーの末尾へ移動し、ドラッグで並べ替えた順序が失われていました。
- メタデータ管理で、ファイルツリーとファイル詳細の間の仕切りをドラッグしても、ポインターを動かすたびに列幅を保存しなくなりました。ドラッグが引っかかる原因になっていたためで、幅はドラッグ終了時に一度だけ保存します。
- 仕切りでファイルパネルを狭くしても、ワークスペースフォルダーと名前空間のメニューがパネル内に収まるようになりました。ヘッダーがパネルに合わせて縮まなかったため、ボタンが右端で切れ、フォルダー一覧がパネルの左端をはみ出して一部が隠れていました。今後はヘッダーがパネルに合わせて縮み、ボタンのラベルは短縮表示され、一覧はパネルの幅いっぱいに開きます。
`
  },
  {
    name: "v0.9.0.md",
    path: "versions/v0.9.0.md",
    title: "0.9.0",
    content: `# 0.9.0

リリース日: 2026-08-05

## 変更

- メタデータ管理では、すべてのファイルが \`force-app/main/default\` の下に入る構成をやめました。この 3 つのフォルダは内部的には残るため、取得したパスや生成される package.xml は変わりませんが、ツリーは \`objects\`、\`classes\`、\`flows\`、インストール済みパッケージの名前空間から直接開きます。項目にたどり着くまでのフォルダ展開は 7 回から 4 回になります。
- ツリーの行を狭くし、ファイルとフォルダのアイコンを外しました。階層ごとのインデントも小さくしたため、\`Strategic_Account_Tier_Classification__c\` のような長い API 参照名も深い階層で読めます。
- ワークベンチ上部のツールバー行を廃止しました。ワークスペースフォルダと名前空間はツリーの絞り込みだけを行うためファイルパネルのヘッダーへ、ワークスペースの再読み込みはアイコンレールの下部へ移しました。ヘッダーには選択中ファイルのパスをパンくずで表示します。
- ファイル詳細は幅を変更できる固定パネルになり、アイコンレールのボタンで開閉します。ツリーとの境界線はファイル詳細の幅を調整します。折りたたんだ状態はブラウザープロファイルごとに保持されます。
- すべてのツリー行に ⋮ ボタンを追加しました。右クリックと同じメニューが開くため、行の操作が隠れません。メニューにはどの行でも使える「パスをコピー」を追加しました。

## 比較

- 組織比較は DataDock ではなく、独立した「組織間の差分」アプリで利用できます。

## 既知の制限

- DataDock は読み取り専用です。ソースエディター、Changed Files、デプロイ・破棄、manifest の作成・名前変更・削除は表示しません。
`
  },
  {
    name: "v0.8.0.md",
    path: "versions/v0.8.0.md",
    title: "0.8.0",
    content: `# 0.8.0

リリース日: 2026-07-25

## 変更

- SheetD を Sheet for Salesforce と同じエンジンに刷新しました。Salesforce データツリーからオブジェクトとレポートを参照でき、いずれも最初から編集可能なデータとして開きます。読み取り専用モードの切り替えはなくなりました。
- ツリー行の右クリックまたはヘッダーのアイコンから「ファイル詳細」パネルを開くと、ファイルの Salesforce レコード項目をカード形式で表示し、リストビューの SOQL やレポートの検索条件も確認できます。パネルは表示中のシートのファイルに追従します。
- レポート一覧に、親フォルダを持たないレポートをまとめた「公開レポート」と、サインイン中のユーザー自身の個人レポートをまとめた「非公開レポート」を、組織の名前付きレポートフォルダと並ぶ独立した項目として表示します。Salesforce が返すのはサインイン中のユーザー自身の非公開レポートだけで、他ユーザーの非公開レポートは取得しません。
- レポート一覧は先頭 2,000 件で打ち切らず、組織内のすべてのレポートをページングして取得します。レポート数の多い組織でも、一覧の末尾にあるフォルダが欠落しなくなりました。
- Salesforce のレポート API は最大 2,000 行までしか返さないため、それを超えるレポートではその旨と、取得できた行数およびレポート全体の行数を表示します。切り詰められた結果を完全な結果として扱うことはありません。
- 2,000 行を超えるレポートでは、同じレポート API にブック形式を要求してレポート全体を取得します。結合レポートでも利用できる唯一のエクスポート形式です。取得できない場合は、切り詰められた行と警告表示に戻ります。
- 編集したセルは、ファイル詳細パネル上部の「変更項目」カードにまとめて表示します。レコード ID ごとに変更前後の値を一覧し、「更新」ボタンから確認モーダルを経て Salesforce に書き戻します。選択リスト項目には値ピッカーを表示し、エラーは行ごとに報告します。オブジェクトのリストビューは先頭 2,000 件で止めず、全ページを読み込みます。
- 左レールの LOG は成功した更新を新しい順の監査ブロックで開きます。各ブロックに「オブジェクト > 更新日時」、ID を含む項目、以前の行値を表示します。Rollback を選択した行だけが同じ変更項目の確認・確定フローに入ります。証跡は組織ごとに 50 イベント / 2 MB に制限します。
- 従来の Salesforce CRUD パネルを削除しました。挿入、アップサート、および表計算の列マッピングとプレビュー機能は SheetD から無くなりました。読み込んだレコードの編集に用途を絞っています。`
  },
  {
    name: "v0.7.0.md",
    path: "versions/v0.7.0.md",
    title: "0.7.0",
    content: `# 0.7.0

リリース日: 2026-07-17

## 追加

- 権限エクスプローラーを追加しました。ユーザーがオブジェクトや項目にアクセスできる理由を確認できる読み取り専用のアプリです。Apps → Permission Explorer から開きます。
- ユーザーを選んで「アクセスを確認」を実行すると、割り当て済みレコードが許可するすべてのオブジェクトを一覧表示し、付与元と、複数のレコードで許可されたオブジェクト数を示します。1 つのレコードを削除してもアクセスが残るオブジェクトを把握できます。
- オブジェクトを入力すると、有効な参照・作成・編集・削除・すべて表示・すべて変更と、その根拠となるプロファイル、権限セット、権限セットグループを設定へのリンク付きで表示します。
- オブジェクトの詳細には全項目も表示し、有効な参照・編集と付与元レコードを確認できます。項目レベルセキュリティの対象外の項目も表示し、アクセス拒否とは区別します。
- 権限セットグループには Salesforce が計算した権限を表示し、展開するとメンバー権限セットを一覧表示します。ミュートやグループの優先順位は Salesforce が解決し、拡張機能側で再計算しません。
- 任意で項目を指定すると、その 1 項目の参照・編集を確認できます。項目権限レコードがない項目は「項目レベルセキュリティの対象外」と表示し、アクセス拒否とは区別します。
- 回答は JSON または Markdown、オブジェクト一覧は CSV でダウンロードできます。セッショントークンや無関係なユーザーは含まれません。
- 通常の Admin Toolkit ページだけでなく拡張機能のルート URL でもブラウザーアクションを利用でき、サイドパネルのポップアップを再度開けます。

## 注意

- 権限エクスプローラーは読み取り専用で、権限を変更することはありません。
- すべての回答は、オブジェクトと項目の権限のみを説明します。レコードの公開範囲は組織の共有設定、ロール階層、共有ルール、手動共有やチーム共有、テリトリーにも依存し、このページでは評価しません。
- 新しいブラウザー権限や Salesforce ホスト権限は追加していません。`
  },
  {
    name: "v0.6.2.md",
    path: "versions/v0.6.2.md",
    title: "0.6.2",
    content: `# 0.6.2

リリース日: 2026-07-15

## 修正

- Document Folders でフォルダをチェックまたは解除すると、読み込み済みのサブツリー全体へ再帰的に反映されるようになりました。遅延読み込みフォルダは一括で確定し、親チェックボックスの中間状態も正しく表示します。仮想の Workspace Folders ルートは選択できず、Salesforce フォルダ更新操作も表示しません。
- 同じ ContentDocument が複数フォルダにある場合も、それぞれの出現箇所を個別に選択し、ZIP 内のフォルダパスを保持します。選択内容では、必要に応じてファイル出現数と一意のドキュメント数を表示します。

## 改善

- ZIP 作成はファイル出現 500 件、既知サイズ 250 MB を上限とし、大容量または一部サイズ不明の場合に確認します。重複ドキュメントの内容を再利用し、ダウンロードをキャンセルできます。
- Object Schema を Apps 専用ページに変更し、接続状態と共通の英語・日本語切り替えを持つ専用ヘッダーを追加しました。旧 Tool のお気に入り・最近使った項目は自動的に削除します。
- リレーション探索順を安定化し、バックエンド専用の 100 オブジェクト上限で保護します。アクセシブルなリレーション一覧は作成成功後だけ表示します。
- 主操作を「スキーマ図を作成」に変更しました。デスクトップではオブジェクト名をコンパクトにし、サイドパネル幅では横スクロールなしで全幅表示します。
- Object Schema のヘッダーを SheetD と同じフラットな形式にし、「スキーマオブジェクト」のアイコンと名前だけを表示します。パッケージオブジェクトと標準オブジェクト表示設定が、オブジェクト名候補と全オブジェクト項目シートの対象を決定します。項目は並列取得後に一度だけシートへ表示し、項目数は「項目」見出しの横へインライン表示します。「スキーマ図を作成」と「リセット」の操作は縦方向の中央に配置し、シートフレームは利用可能なアプリの高さに合わせて拡大します。オブジェクトフィルターと全体検索はインライン表示し、Enter で検索、× で解除できます。項目シートには列フィルター、一致セル強調、CSV ダウンロード、全画面表示も追加しました。パッケージオブジェクトの既定値は「なし」で、組織ごとの変更を保持します。
- DataDock for Salesforce と Org Review にも Object Schema と同じコンパクトなスタンドアロンアプリヘッダーを適用しました。左側にアプリアイコンと名前、右側に状態と表示言語を配置し、アプリページ内の Tools ナビゲーションは表示しません。
- Admin Toolkit の拡張機能ページを表示中でも、広範な Tabs 権限を追加せずにブラウザーアクションのポップアップを開けるようになりました。`
  },
  {
    name: "v0.6.1.md",
    path: "versions/v0.6.1.md",
    title: "0.6.1",
    content: `# 0.6.1

リリース日: 2026-07-14

## 改善

- Document Folders のダウンロードを選択方式に刷新しました。ツリーのチェックボックスでフォルダやファイルを選択すると、詳細パネルに選択内容が表示され、パネルヘッダーの Download ボタンから ZIP をダウンロードできます。フォルダ操作ボタン行とダウンロードダイアログは廃止し、ダウンロード、フォルダ作成、名前変更、アップロードはツリーの右クリックメニューから利用できます。
- ポップアップのアプリタブにオブジェクトスキーマを追加し、ツールタブの SheetD の重複表示を削除しました。オブジェクトスキーマは Contact、親 1 階層・子 1 階層を既定値とし、オブジェクト候補、検索可能なパッケージ名前空間選択、選択名を表示する表示オブジェクト選択、外側クリックで閉じるポップアップ、マップと検索の同期操作、赤色のリレーション経路ラベル、拡大・縮小、水平・垂直レイアウト、選択リスト・数式・参照先を示す項目値に対応しました。
- ツールページのナビゲーションから組織レビューを削除しました。組織レビューはポップアップのアプリタブから開けます。
- 「設定変更履歴」など、Salesforce 標準の用語に合わせて英語・日本語の表記を見直しました。
- SheetD のスプレッドシートエンジンに含まれるオープンソースパッケージのライセンス表記として THIRD-PARTY-NOTICES.txt を追加しました。`
  },
  {
    name: "v0.6.0.md",
    path: "versions/v0.6.0.md",
    title: "0.6.0",
    content: `# 0.6.0

リリース日: 2026-07-11

## 新機能

- 組織レビューで、組織情報、API 制限、セキュリティヘルス、Apex カバレッジ、自動化、連携、最近の設定変更、ログイン失敗、イベントログ、ローカル状態を読み取り専用で確認できます。各カードは独立して読み込まれます。収集は読み取り専用で、唯一の書き込みは「アプリ」の項で説明するサンドボックス限定のクリーンアップ削除です。
- 共通の組織・リスク表示と明示的な確認により、Apex、データ変更、メタデータデプロイを保護します。
- Changed Files でデプロイ前の Validate Selected を実行し、サニタイズ済み操作レシートをブラウザ内に保存できます。

## 改善

- SheetD のワークスペースファイルごとに独立したグリッドを保持し、切り替えや再読み込み後も正しい値と数式を復元します。
- Document Folders の自動プレビュー、大容量プレビュー制御、正しいファイル名のダウンロード、フォルダ構造を保持した ZIP、部分失敗表示を改善しました。
- アプリアイコン、ロゴ、Chrome Web Store プロモーション画像を統一したビジュアルに更新しました。
- リリース作成前にバージョン、必須アセット、禁止ファイル、画像サイズを検証します。

## プライバシー

- テレメトリ、広告、外部データサービスは使用しません。操作履歴はサニタイズされ、ブラウザ内のみに保存されます。`
  },
  {
    name: "v0.5.0.md",
    path: "versions/v0.5.0.md",
    title: "0.5.0",
    content: `# 0.5.0

リリース日: 2026-06-29

## 新機能

- SheetD: SOQL クエリを実行し、マルチタブのスプレッドシートで結果を確認できます。全ページを自動ストリーミングし、途中で停止・再開できます。タブは組織ごとにローカル保存されます。

## 修正

- Files フォルダ詳細の一覧で、行データに Last Modified Date がある場合に正しく表示されるようになりました。
- 行データに Last Modified Date がない場合は空の列を表示しないようにしました。

## 改善

- Files フォルダ詳細の列ヘッダーでソートできるようになりました。昇順・降順・未ソートのアイコンで状態を確認できます。
- ソート後もフォルダ一覧の検索フィルタと大量行のバッチレンダリングが正常に動作します。
- 監視ページ（Setup Audit Trail・Limits・Login History・Event Log Files）がホストパラメータなしでも保存セッションで接続できるようになりました。
- マニフェストに明示的なコンテンツセキュリティポリシーを追加しました。
- マニュアルに各バージョンのリリースノートを含む Versions フォルダを追加しました。
- ポップアップに現在のバージョン番号を表示し、クリックでリリースノートを開けるようになりました。`
  },
  {
    name: "v0.4.5.md",
    path: "versions/v0.4.5.md",
    title: "0.4.5",
    content: `# 0.4.5

## 改善

- ポップアップの組織・ユーザーサマリーの読み込みに Promise.allSettled を使用し、一方が失敗しても拡張機能全体が非表示にならなくなりました。
- ポップアップのメタデータ検索が種類別にグループ化され、一致テキストをハイライト表示します。Show more で追加候補を取得できます。
- Files 検索がワークスペースツリーのフォルダ名・ファイル名・API 参照名・ラベル・パスを対象にします。
- カスタム項目の検索結果は、利用可能な場合 Salesforce の項目 ID で Object Manager の項目詳細を開きます。`
  },
  {
    name: "v0.4.4.md",
    path: "versions/v0.4.4.md",
    title: "0.4.4",
    content: `# 0.4.4

## 改善

- Document Folders がテキスト・画像・PDF・音声・動画ドキュメントを自動プレビューします。
- Document Folders で選択フォルダおよびファイルの ZIP ダウンロードに対応しました。
- Run Apex Code で execute-anonymous の結果と System.debug 出力を表示します。
- Files ツリーで前後のナビゲーションとセカンダリラベルに対応しました。`
  },
  {
    name: "v0.4.3.md",
    path: "versions/v0.4.3.md",
    title: "0.4.3",
    content: `# 0.4.3

## 改善

- Data Export で SOQL・SOSL・GraphQL・レポートエクスポートに対応しました。
- 結果を CSV グリッドまたは JSON で確認し、コピーまたはダウンロードできます。
- 結合レポートは CSV 非対応のため Excel または JSON に誘導します。
- REST API パスビルダーに主要なエンドポイントテンプレートを追加しました。`
  },
  {
    name: "v0.4.2.md",
    path: "versions/v0.4.2.md",
    title: "0.4.2",
    content: `# 0.4.2

## 初回リリース

- Workspace フォルダと名前空間を選択できる DataDock for Salesforce。
- 遅延読み込みに対応したソース形式の Files エクスプローラー。
- Changed Files での変更追跡・デプロイ・破棄フロー。
- プレビュー・コピー・ZIP ダウンロードに対応した Package XML ビルダー。
- REST API・Run Apex Code・Data Export・Document Folders・監視ツール。
- 英語と日本語の内蔵マニュアル。`
  }
];

export const MANUAL_FILES = MANUAL_FILES_EN;

export function getManualFiles(language = "en") {
  return language === "jp" ? MANUAL_FILES_JP : MANUAL_FILES_EN;
}

export function getManualFile(sourcePath = "", language = "en") {
  return getManualFiles(language).find((file) => file.path === sourcePath) || null;
}

export function getVersionFiles(language = "en") {
  return language === "jp" ? VERSION_FILES_JP : VERSION_FILES_EN;
}

export function getVersionFile(sourcePath = "", language = "en") {
  return getVersionFiles(language).find((file) => file.path === sourcePath) || null;
}

export function getLatestVersionFile(language = "en") {
  return getVersionFiles(language)[0] || null;
}
