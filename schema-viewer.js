import { mountAppLauncher } from "./app-launcher.js";
import { t } from "./i18n.js";

mountAppLauncher({ translate: t });

const runtimeUrl = new URL("./schema-viewer-runtime.js", import.meta.url);
runtimeUrl.searchParams.set("runtime", String(Date.now()));

import(runtimeUrl.href).catch((error) => {
  console.error("Failed to load schema viewer runtime.", error);
  const status = document.getElementById("status");
  if (status) {
    status.textContent = "Failed to load Metadata Folders runtime. Reload this page.";
    status.className = "status error";
  }
});
