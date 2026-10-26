# FTB

FTB ist eine selbst gehostete Turnierplattform mit öffentlicher oder passwortgeschützter Website. Die Verwaltung erfolgt über Telegram. Pro Instanz wird im Bot ein Teamturnier oder der Turbo-Modus eingestellt.

## Funktionen

- Live-Startseite mit benannten Spielfeldern, Begegnungen, Pausen, Freigabestatus und vorläufigen Metriken.
- Automatische Aktualisierung im sichtbaren Browser-Tab, lokale Favoriten für Teams und Personen.
- Spielplan mit Filtern, Gruppentabellen und nach Runden gegliederter K.-o.-Phase.
- Team- und Personendetailseiten mit Statistiken und vollständiger, seitenweise abrufbarer Spielhistorie.
- Mobile Ranglisten mit Platz, Name, Siegquote und Spielen. Weitere Werte stehen in der Detailansicht.
- Helle und dunkle Darstellung nach Geräteeinstellung oder manueller Wahl. Die Wahl bleibt im Browser gespeichert.
- Logo, Veranstaltungsfarben, Texte, Regelwerk, Laufbanner und Sponsoren.
- Teamturnier mit Gruppenphase, K.-o.-Runden und Einzel- oder Best-of-Three-Finale.
- Turbo mit frei gewählten Personen und Gästen pro Begegnung. Unterschiedlich große Seiten sind erlaubt und werden angezeigt.
- Gäste gelten nur für die jeweilige Begegnung und erhalten eine gemeinsame Statistik, getrennt von Personen und Teams.
- Turbo-Jahreswertung mit einstellbarer Mindestspielzahl, früheren Jahren, einzelnen Spieltagen und Gesamtzeitraum.
- Metriken: Strafbiere erhalten, Strafbiere verteilt, Treffer und Runden bis leer.
- PDF und CSV verwenden den gewählten Zeitraum und ausschließlich freigegebene Ergebnisse.
- Administration, Turnierleitung und Helfer mit getrennten Rechten. Helfer können Spieler sein, dürfen im Teamturnier aber kein eigenes Team betreuen.
- Gemeinsames Helferpasswort plus persönliche Freigabe. Spielfelder bleiben bis zur Ergebnisfreigabe belegt.
- Ergebniskorrektur mit Begründung und Reparaturdialog für abhängige K.-o.-Begegnungen.
- Optionaler Website-Zugang per Seitenpasswort, Benutzerkonto und Telegram, frei kombinierbar. Browser-Sitzungen lassen sich merken und widerrufen.
- Ein gemeinsamer Bot kann mehrere Instanzen bedienen. Datenbanken, Rollen und Zugänge bleiben je Instanz getrennt.

## Installation zum Testen

Voraussetzungen: Docker Engine mit Docker Compose v2, Git und für die Verwaltung ein Telegram-Bot von `@BotFather` sowie deine numerische Telegram-User-ID.

### Eine Instanz

```bash
git clone --branch test --single-branch https://github.com/3115a083/ftb.git
cd ftb
cp .env.test.example .env
openssl rand -hex 24
```

Trage das erzeugte Passwort als `DB_PASSWORD` in `.env` ein. Ergänze:

```dotenv
TELEGRAM_BOT_TOKEN=DEIN_BOT_TOKEN
TELEGRAM_ADMIN_IDS=DEINE_NUMERISCHE_ID
INSTANCE_MODE=classic
```

`INSTANCE_MODE=turbo` startet bei einer neuen Datenbank im Turbo-Modus. Danach wird der Modus im Bot eingestellt und bleibt bei Neustarts erhalten.

```bash
docker compose -f compose.dockge-test.yaml up -d --build --wait
docker compose -f compose.dockge-test.yaml ps
```

Öffne **http://localhost:3080** auf dem Docker-Host. Für andere Geräte im Heimnetz setze `TEST_BIND_IP` auf die LAN-IP des Hosts und `SITE_URL` auf `http://DEINE_LAN_IP:3080`.

Sende dem Bot privat `/start`. Unter **Verwaltung → Instanz & Website-Zugang** stellst du Modus, Zeitzone, Mindestspielzahl und Anmeldearten ein. Unter **Seite verwalten** passt du die Veranstaltung an. **Verwaltung → Testdaten** legt Beispielteams und Beispielspiele für das Teamturnier an. Im Turbo legst du Personen, Spielfelder, eine Sitzung und dann Begegnungen an.

Ohne Bot-Token startet nur die Website, bei einer neuen Datenbank zunächst ohne Inhalte. Verwende für einen parallelen Einzelinstanz-Test einen eigenen Testbot.

Die Compose baut direkt aus dem Branch `test`; ein veröffentlichtes Container-Image ist nicht erforderlich. Für einen Build aus deinem lokalen Checkout:

```bash
docker compose -f compose.dockge-test.yaml -f compose.test.yaml up -d --build --wait
```

### Zwei Instanzen mit demselben Bot

Die mitgelieferte `compose.multi-test.yaml` startet ein Teamturnier auf Port 3080, eine Turbo-Jahresrunde auf Port 3081, einen zentralen Bot-Dienst und einen PostgreSQL-Server mit getrennten Datenbanken und Datenbankbenutzern.

Im geklonten Repository:

```bash
cp .env.multi-test.example .env
```

Erzeuge für **jeden** dieser vier Werte unabhängig ein Passwort mit `openssl rand -hex 24` und trage es in `.env` ein:

```dotenv
DB_PASSWORD=
GATEWAY_DB_PASSWORD=
TOURNAMENT_SECRET=
TURBO_SECRET=
TELEGRAM_BOT_TOKEN=DEIN_BOT_TOKEN
TELEGRAM_ADMIN_IDS=DEINE_NUMERISCHE_ID
```

Danach:

```bash
docker compose -f compose.multi-test.yaml up -d --build --wait
```

Öffne **http://localhost:3080** und **http://localhost:3081**. Für LAN-Zugriff ändere `TEST_BIND_IP`, `TOURNAMENT_URL` und `TURBO_URL` passend zum Docker-Host.

Sende dem Bot `/instanzen` und wähle **Tagesturnier** oder **Turbo-Jahresrunde**. Jede Bot-Nachricht zeigt ihre Instanz. Ältere Buttons behalten ihre ursprüngliche Zuordnung. Schalte vor dem Start alle älteren Bot-Prozesse ab, die denselben Token verwenden. Nur der zentrale Dienst benötigt den Bot-Token.

Die Dateien im Unterordner `docker` müssen neben der Compose vorhanden sein. In Dockge verwende deshalb den geklonten Ordner als Stack-Verzeichnis. Für den Einzelinstanz-Test genügt auch der Compose-Inhalt aus `compose.dockge-test.yaml` samt Umgebungsdatei.

## Website-Zugänge

Initial bleibt die Website öffentlich. Aktiviere den Schutz im Bot unter **Verwaltung → Instanz & Website-Zugang**:

1. Setze ein **Seitenpasswort** oder lege unter **Website-Benutzer** Konten beziehungsweise Telegram-IDs an.
2. Aktiviere die gewünschten **Anmeldearten**. Eine leere Auswahl macht die Website wieder öffentlich.
3. Teste die Anmeldung in einem privaten Browserfenster.

Website-Konten erhalten keine Bot-Verwaltungsrechte. Das Seitenpasswort ist unabhängig vom Helferpasswort. Die Anmeldung schützt auch PDF, CSV und die Live-Daten.

Bei Telegram-Anmeldung öffnet der Browser den Bot. Vergleiche den angezeigten Code und bestätige die selbst begonnene Anmeldung. Nur der ursprüngliche Browser kann sie abschließen. Die Telegram-ID muss zuvor als Website-Zugang freigegeben sein.

**Angemeldet bleiben** speichert eine Sitzung für bis zu 30 Tage. Ohne diese Option setzt FTB einen Browser-Sitzungscookie mit maximal zwölf Stunden serverseitiger Gültigkeit. Sperren eines Kontos und Passwortänderungen machen zugehörige Sitzungen ungültig. **Alle Website-Sitzungen widerrufen** meldet alle Besucher ab.

## Öffentlicher Betrieb mit HTTPS

Die Testkonfiguration verwendet HTTP und ist für ein vertrauenswürdiges lokales Netzwerk gedacht. Für öffentliche Nutzung:

- Veröffentliche nur die Website-Ports über Pangolin oder einen HTTPS-Reverse-Proxy. PostgreSQL und der Bot-Dienst bleiben intern.
- Setze `SITE_URL`, bei mehreren Instanzen `TOURNAMENT_URL` und `TURBO_URL`, auf die jeweilige öffentliche HTTPS-Adresse.
- Setze `ALLOW_HTTP_TEST=0`. Browser-Cookies verwenden dann `Secure` und den `__Host-`-Präfix.
- Setze `TRUST_PROXY=1` nur bei genau einem vertrauenswürdigen Proxy vor der Anwendung. Verhindere dabei direkten Zugriff auf die App-Ports aus nicht vertrauenswürdigen Netzen.
- Aktiviere bei Bedarf den Website-Zugangsschutz im Bot.

Ein gemeinsamer Bot genügt auch für unterschiedliche Website-Domains. Für Telegram-Anmeldung wird keine öffentliche Webhook-Adresse benötigt.

## Betrieb

Logs und Status, hier für die Einzelinstanz:

```bash
docker compose -f compose.dockge-test.yaml logs -f app
docker compose -f compose.dockge-test.yaml ps
```

Aktualisieren:

```bash
git pull --ff-only
docker compose -f compose.dockge-test.yaml build --pull
docker compose -f compose.dockge-test.yaml up -d --wait
```

Beim Mehrinstanzbetrieb verwende stattdessen `compose.multi-test.yaml`. Die Website pausiert automatische Aktualisierungen in unsichtbaren Tabs. PostgreSQL-Verbindungspools sind begrenzt, Container-Logs rotieren, und Exporte werden erst auf Anfrage erzeugt.

Vor Updates sichere die Datenbank und die `.env` außerhalb des Docker-Volumes. Einzelinstanz-Backup:

```bash
docker compose -f compose.dockge-test.yaml exec -T db pg_dump -U ftb ftb > ftb-backup.sql
```

Mehrinstanz-Backup:

```bash
docker compose -f compose.multi-test.yaml exec -T db pg_dumpall -U postgres > ftb-multi-backup.sql
```

Stoppen erhält die Daten:

```bash
docker compose -f compose.dockge-test.yaml down
```

`down --volumes` löscht die Daten des jeweiligen Stacks. Geänderte Datenbankpasswörter in `.env` ändern bereits initialisierte PostgreSQL-Benutzer nicht automatisch. Bot-Token, Passwörter und `.env` gehören nicht ins Repository.

Die `compose.yaml` verwendet ein veröffentlichtes GHCR-Image und benötigt eine HTTPS-`SITE_URL`. Nutze die Test-Compose, solange das gewünschte Image nicht veröffentlicht wurde.
