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

## Noch nicht ausgeführte Prüfungen

Die GitHub-Verbindung für `BSV2016/ftb` meldet `push: false`; Git-Tree-Erstellung wird mit HTTP 403 „Resource not accessible by integration“ abgewiesen. Diese Sperre betrifft das Originalrepo. Auf ausdrücklichen Nutzerauftrag wird die Umsetzung im schreibbaren Fork `3115a083/ftb` auf `test` fortgeführt. Der dortige CI-Stand wird nach dem Push ergänzt.

Die vorbereitete CI führt Tests gegen PostgreSQL 17 einschließlich konkurrierender Zähler und doppelter Freigaben aus. Außerdem sind Chrome-Smokeprüfungen für Desktop/Mobil, Downloads und Demo-Abläufe sowie Docker-Build und Dependency-Audit enthalten. Diese neuen CI-Schritte sind noch nicht gelaufen. Der lokale Chrome-Start scheiterte in dieser Umgebung, daher keine echte Browserabnahme behauptet.

Nicht erfolgt: Test mit echtem Telegram-Bot/mehreren Geräten, Docker-Build, Deployment, Backup-/Restore- und Reverse-Proxy-Abnahme. Für die Übernahme nach `main` bleiben diese tatsächlichen Prüfgrenzen zu beachten. Bestehende Schutz- und Sicherheitsprüfungen wurden nicht deaktiviert.

## Übernahme des gesicherten Patches

Der mitgelieferte Git-Patch basiert auf dem genannten `test`-Commit. In einem sauberen Checkout dieses Branches lässt er sich mit `git am /pfad/FTB-Telegram-Turbo.patch` übernehmen. Bei abweichendem Branchstand zuerst die Änderungen vergleichen. Keine Historie überschreiben. Nach Herstellung des GitHub-Schreibzugriffs den aktuellen Remote-Stand erneut lesen, Änderungen regulär nach `test` übertragen und alle CI-Ergebnisse auswerten.
