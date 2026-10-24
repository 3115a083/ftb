# Prüfstand vom 24.10.2026

## Umfang

Umsetzung des abgestimmten Telegram-Workshops auf Basis von `test` (`ae77e8b5175d2a259d5753bd256df2e1f4ec5b23`). Stabiles `main` blieb unverändert. Enthalten: Rollen, Helferanmeldung, Spielfelder, Zuweisungen, Ergebnisfreigaben, Pause/Fortsetzung, Reparaturvorschau, optionale Metriken, Turbo-Sitzungen, pro Begegnung begrenzte Gäste und gemeinsame Gaststatistik mit PDF/CSV.

## Tatsächlich ausgeführte Prüfungen

- `npm run verify`: Syntaxprüfung bestanden; 23 Verhaltenstests, davon 22 bestanden und ein PostgreSQL-Paralleltest mangels Testserver übersprungen. Die lokalen Datenbanktests verwenden PGlite.
- Tests prüfen unter anderem Rollen und Entzug, letzte Administration, shared-password-Anfrage/Freigabe/Rotation, persistente Anmeldelimits, Eigen-Team-Sperre, Turbo-Erfassungsrechte, idempotente Klicks, Rücknahme, Pause/Feldschließung, ausstehende Ergebnisfreigaben, Gastaggregation über mehrere Runden, Classic-Best-of-Three bis zum Sieger, versionierte Reparaturvorschau, veraltete Seitendialoge und den vollständigen Telegram-Dialog zur Aufnahme eines Rundengastes.
- HTTP-Tests prüfen öffentliche Statistik sowie tatsächliche PDF-/CSV-Antworten. Telegram-IDs erscheinen nicht in der öffentlichen Darstellung. CSV-Formeleingaben werden neutralisiert.
- `npm audit --omit=dev --audit-level=high`: keine bekannten Schwachstellen im aufgelösten Laufzeit-Dependency-Stand gemeldet.
- Statische Demo im DOM ausgeführt: Schnellaktionen, Freigabe, Gaststatistik über Rundenwechsel, Start und Pause/Fortsetzung bestanden.
- Statistik-PDF mit 30 Personen, langen Namen, Umlauten und Gästesumme erzeugt und gerendert; Tabellenköpfe, Seitenumbrüche und Gästebereich geprüft.
- `git diff --check`: bestanden.

## CI im Fork

Die Umsetzung liegt auf `test` im Fork `3115a083/ftb`. [PR #1](https://github.com/3115a083/ftb/pull/1) hält die Übernahme nach `main` reviewbar. Die frühere HTTP-403-Sperre betrifft nur das Originalrepo `BSV2016/ftb`.

[CI-Lauf 40126837062](https://github.com/3115a083/ftb/actions/runs/40126837062) auf Implementierungscommit `c66aa18236ad91564695c912e6525e41b83e6931` bestand:

- Alle 23 Tests gegen PostgreSQL 17, ohne übersprungene Tests, einschließlich echter konkurrierender Zähler und doppelter Freigaben.
- Dependency-Audit ohne bekannte Laufzeitbefunde.
- Chrome-Smokeprüfung auf Desktop und Mobil: öffentliche Statistik, HTML-Escaping, tatsächliche PDF-/CSV-Downloads, Live-Zähler, Gastaggregation und Leitungsfreigabe.
- Docker-Build mit Lockfile und PDF-Schriftpaket.

Die Screenshots der synthetischen Browserprüfung liegen im CI-Artefakt. Nachfolgende Integrationscommits werden erneut geprüft; den aktuellen Head-Status zeigt der PR. Die Demo-Konflikte mit dem bisherigen `main` werden im Entwicklungsbranch aufgelöst. Kein Merge nach `main` und kein produktives Containerdeployment durchgeführt.

Noch nicht erfolgt: Abnahme mit echtem Telegram-Bot und mehreren Geräten, Backup-/Restore- und Reverse-Proxy-Abnahme. Das GitHub-Pages-Deployment ist ein separater Workflow. Sein Deploy-Schritt meldet HTTP 404: Pages ist im Fork noch nicht aktiviert. Unter Settings > Pages muss die Quelle GitHub Actions aktiviert werden; der Workflow bleibt unverändert sichtbar und wird nicht zur Verdeckung des Fehlers deaktiviert. Bestehende Schutz- und Sicherheitsprüfungen wurden nicht deaktiviert.

## Übernahme des gesicherten Patches

Der mitgelieferte Git-Patch basiert auf dem genannten `test`-Commit. In einem sauberen Checkout dieses Branches lässt er sich mit `git am /pfad/FTB-Telegram-Turbo.patch` übernehmen. Bei abweichendem Branchstand zuerst die Änderungen vergleichen. Keine Historie überschreiben. Die aktuelle Weiterentwicklung liegt inzwischen im Fork. Für neue Arbeiten dessen `test`-Branch verwenden; der frühere Patch ist nur der gesicherte Ausgangsstand.
