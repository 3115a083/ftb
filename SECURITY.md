# Sicherheitsrichtlinie / Security Policy

## Unterstützte Versionen

FTB befindet sich derzeit in aktiver Entwicklung. Sicherheitskorrekturen werden für den aktuellen Stand von `main` sowie für die jeweils neueste veröffentlichte Version bereitgestellt.

| Version | Unterstützt |
| --- | --- |
| Aktuelle Version / `main` | ✅ |
| Ältere Entwicklungsstände | ❌ |

## Sicherheitslücken melden

Bitte veröffentliche vermutete Sicherheitslücken nicht als öffentliches GitHub-Issue und poste keine Zugangsdaten, Tokens, Passwörter oder personenbezogenen Daten im Repository.

Nutze nach Möglichkeit GitHubs Funktion **Private vulnerability reporting** im Bereich **Security** des Repositories. Falls diese Funktion nicht verfügbar ist, kontaktiere den Projektinhaber über einen privaten, im GitHub-Profil angegebenen Kontaktweg.

Bitte beschreibe möglichst:

- welche Version oder welcher Commit betroffen ist,
- wie sich das Problem reproduzieren lässt,
- welche Auswirkungen du erwartest,
- ob du bereits einen möglichen Fix kennst.

Eine bestätigte Sicherheitslücke wird priorisiert behandelt. Details sollten erst nach Bereitstellung einer Korrektur öffentlich gemacht werden.

## Secrets

Telegram-Bot-Tokens, Datenbankpasswörter und andere Zugangsdaten dürfen niemals committed werden. Verwende lokal `.env` und orientiere dich an `.env.example`.

---

## English summary

FTB supports security fixes for the current `main` branch and the latest released version. Please do not disclose vulnerabilities or secrets in public issues. Prefer GitHub Private Vulnerability Reporting when available, and never commit Telegram tokens, database passwords, or other credentials.

## Rollen und Helferanmeldung

Das Veranstaltungspasswort erlaubt nur eine Beitrittsanfrage. Die Turnierleitung muss jede Person freigeben. Rollen werden je Aktion neu aus der Datenbank geprüft. Die letzten Administrationsrechte lassen sich nicht entfernen. Passwort-Hashes, Anmeldelimits und Freigabestatus bleiben bei Neustart erhalten. Details und Grenzen: [Telegram-Leitfaden](docs/telegram.md#anmeldung-und-schutz-vor-rateversuchen). Passwortnachrichten können trotz Löschversuch zunächst im Telegram-Chat vorhanden sein; dort keine anderweitig verwendeten Passwörter einsetzen. CSV-Ausgaben neutralisieren Formeleingaben; öffentliche Statistiken enthalten keine Telegram-IDs.
