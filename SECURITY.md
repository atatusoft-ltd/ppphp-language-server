# Security policy

## Supported versions

Until the first stable release, only the latest `0.x` release and the current `main` branch receive security fixes.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. After this repository is created on GitHub, enable **Private vulnerability reporting** under **Settings → Security → Code security and analysis**, then use the repository's **Security** tab to report the issue privately. Before publication, contact the maintainer through an established private channel.

Include the affected version, impact, reproduction steps, and any suggested remediation. Avoid including secrets or data belonging to other people. You should receive an acknowledgement within seven days and a status update within fourteen days.

## Scope

Especially relevant issues include command execution, unsafe workspace-path handling, dependency or build-pipeline compromise, diagnostics leaking source content, and editor actions that modify the wrong symbol or file.
