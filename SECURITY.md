# Security Policy

## Architecture & Threat Model

**Bank Statement to QIF Converter** is a **100% client-side static web application**:

- Uploaded financial statements (`.csv`, `.xls`, `.xlsx`, `.pdf`) are read via the browser `File` API and parsed exclusively in local browser memory.
- No backend server exists; no financial data, telemetry, or analytics are ever transmitted over the network.
- Settings, account mappings, and column-mapping templates are stored locally in the browser's IndexedDB.
- You can independently verify zero network transmission by opening browser DevTools → **Network** before dropping a file, or by disconnecting from the internet after initial page load.

## Reporting a Vulnerability

If you discover a security vulnerability (for example, an XSS issue, prototype pollution via a crafted file, or unintended network request):

1. **Do not open a public GitHub issue** with exploit details or real financial statements.
2. Use GitHub's **Private Vulnerability Reporting** (under the repository's **Security** tab) to report the issue privately to the maintainers.
3. Include minimal, **anonymized** reproduction steps.

We will acknowledge reports promptly and release a fix as soon as possible.
