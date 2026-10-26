# Telegram-Bedienung und Turniermodi

Website, Jahreswertung und gemeinsamer Bot: [Website-Anleitung](website.md).

Die öffentliche Website bleibt lesend. Die Administration findet ausschließlich im privaten Bot-Chat statt. Entwicklung erfolgt im Fork `3115a083/ftb` auf `test`; `main` bleibt stabil.

## Rollen und Einstieg

- Administration: alle Leitungsfunktionen, weitere Administratoren und Turnierleitungen ernennen oder abberufen. Mindestens eine Administration bleibt erhalten.
- Turnierleitung: Helfer freigeben und sperren, Turnier und Website verwalten, Felder und Spiele zuweisen, Ergebnisse freigeben, Reparaturdialog bedienen.
- Helfer: eigene zugewiesene Spiele starten, pausieren und fortsetzen, Gewinner und Metriken melden. Keine Betreuung des eigenen klassischen Teams. Teammitgliedschaft und Helferrolle sind unabhängig.

`TELEGRAM_ADMIN_IDS` legt initiale Administratoren an. Vorhandene Rollen werden beim Neustart nicht zurückgesetzt. Neue Administratoren beginnen mit einer persönlichen Beitrittsanfrage und werden danach von einer Administration befördert.

Befehle: `/start`, `/spiele`, `/teams`, `/turnier`, `/seite`, `/verwaltung`, `/hilfe`, `/abbrechen`. Die Übersicht priorisiert ausstehende Freigaben und eigene Aufgaben. Listen werden bei Spielen seitenweise dargestellt. Namen und Buttons ersetzen getippte IDs. Formulare laufen nach 15 Minuten ab; Speichern verlangt den aktuellen Dialog. Navigation verwirft keine Änderungen unbemerkt. Ein Neustart verwirft ungespeicherte Formulare, keine gespeicherten Spiele oder Statistikereignisse.

## Spielbetrieb

1. Turnierleitung legt benannte Spielfelder an und registriert Personen sowie deren klassische Teamzugehörigkeit.
2. Bei einem freien Feld schlägt der Bot offene Begegnungen vor und zeigt die letzten freigegebenen Spielenden. Es gibt keine feste Mindestpause. Die Leitung entscheidet und wählt einen Helfer. Überschneidungen werden angezeigt; eigene klassische Teambegegnungen sind ausgeschlossen.
3. Zuständiger Helfer startet das Spiel. Teams/Personen dürfen nicht gleichzeitig in zwei reservierten oder laufenden Begegnungen gebunden sein.
4. Schnellaktionen erfassen aktivierte Metriken. Die letzte eigene Eingabe kann nachvollziehbar zurückgenommen werden. Eine bereits für weitere Erfassungen benutzte Runde lässt sich nicht beiläufig zurückdrehen.
5. Helfer wählt den Gewinner und bestätigt die Meldung. Ergebnis und Werte bleiben vorläufig; das Feld bleibt belegt.
6. Jede Turnierleitung darf freigeben, mit Begründung einen anderen Gewinner freigeben oder die Meldung mit Grund zur Korrektur zurückgeben. Nur Freigaben ändern offizielle Tabellen, Ranglisten, Exporte und K.-o.-Fortschritt. Doppel- und veraltete Freigaben werden abgewiesen.

Spielzustände: Offen, Zugewiesen, Läuft, Pausiert, Wartet auf Freigabe, Korrektur erforderlich, Abgeschlossen, Abgesagt.

Pause: zuständiger Helfer pausiert sofort und ergänzt einen Grund. Feld und Teams bleiben belegt. Helfer darf fortsetzen, solange Feld geöffnet und Fortsetzung nicht durch Leitung gesperrt ist. Während einer Pause sind Zählaktionen gesperrt.

Feld schließen: aktuelles Spiel fertigspielen lassen oder sofort pausieren. Über die Spielkarte kann die Leitung auf ein freies Feld verlegen oder die Betreuung wechseln. Nach Freigabe bleibt ein geschlossenes Feld geschlossen. Öffnen erfolgt ausdrücklich.

## Metriken und Wertung

Vor Spielbeginn aktivieren: `received` (Strafbiere erhalten, weniger besser), `distributed` (verteilt, mehr besser), `hits` (Treffer, mehr besser), `empty_round` (Runden bis leer, weniger besser). Im klassischen Modus erfasst die Betreuung Teamwerte; im Turbo-Modus persönliche Werte. Tiebreaker werden in Reihenfolge eingestellt; nur aktive Metriken sind zulässig. Im klassischen Modus bleibt der direkte Vergleich vor den optionalen Metriken erhalten.

Null ist ein ausdrücklich erfasster Wert; nicht erfasst bleibt leer. Die Aktion „0 erfassen“ setzt einen ersten Messpunkt, sie löscht keine vorherigen Zähler. „Leer melden“ speichert die gemeinsame Rundennummer. Runden bis leer werden über erfasste Abschlüsse gemittelt. Bei ungeklärten Gleichständen bleibt eine Entscheidung der Turnierleitung erforderlich; Namen lösen keine sportliche Qualifikation auf. Wertungsregeln sind nach Spielbeginn gesperrt, damit laufende Ergebnisse nicht nach anderen Regeln einsortiert werden.

## Turbo-Modus

Eine Turbo-Sitzung hat einen Namen, eine Mindestspielzahl und eine Metrik-/Tiebreaker-Konfiguration. Personen werden für jede Begegnung neu auf zwei Seiten verteilt, manuell oder anhand einer veränderbaren Zufallszusammenstellung. Weitere Begegnungen können beliebig folgen, bis die Sitzung beendet wird. Ein Sitzungsende ist nur ohne aktive Spiele oder offene Freigaben möglich. Bereits geplante Spiele einer beendeten Sitzung können nicht gestartet werden.

Beteiligte dürfen ihre eigenen Werte und den Gewinner melden. Eine festgelegte beteiligte Person führt den gemeinsamen Rundenzähler. Neutrale zugewiesene Betreuung und Leitung dürfen alle Werte erfassen; der Rundenzähler darf zusätzlich Gastwerte erfassen. Das ist eine ausdrückliche Turbo-Ausnahme, keine Aufhebung der klassischen Eigen-Team-Sperre.

Die persönliche Rangliste wertet zuerst die Siegquote und danach die konfigurierten Metriken. Personen unterhalb der Mindestspielzahl bleiben sichtbar und ungewertet. Bei einer Metrik mit fehlenden Daten innerhalb einer Gleichstandsgruppe entsteht kein Vorteil durch angenommene Nullen. Erfassungszahlen werden ausgewiesen.

### Gäste pro Begegnung

Gäste werden ausschließlich in die Teilnehmerliste der konkreten Begegnung geschrieben. Sie erzeugen weder eine dauerhafte Person noch eine dauerhafte Teambindung. Eine weitere Begegnung übernimmt sie nicht automatisch. Pro Runde können mehrere Gäste auf beiden Seiten ergänzt werden.

Alle freigegebenen Gast-Einsätze werden in einer gemeinsamen Gästestatistik zusammengefasst, unabhängig von persönlichen Ranglisten und klassischen Teamstatistiken. „Gast-Einsätze“ zählt Teilnahmeplätze, nicht verschiedene Personen. Treffer und Strafbiere sind Summen; Runden bis leer ist der Durchschnitt erfasster Abschlüsse. Gastnamen sind nur zur Unterscheidung innerhalb der Begegnung gedacht; möglichst neutrale Bezeichnungen verwenden.

## Korrektur und Reparatur

Normale Meldungen werden mit der Spielversion geprüft. Für bereits freigegebene Gewinner öffnet die Leitung einen Reparaturdialog mit Begründung und Vorschau aller betroffenen Folgebegegnungen. Die abschließende Aktion benennt ausdrücklich, dass betroffene Folgebegegnungen annulliert werden. Ihre vorherigen Ergebnisse bleiben im Auditverlauf erhalten. Die Vorschau ist an aktuelle Versionen gebunden und wird bei zwischenzeitlichen Änderungen ungültig.

Bei Gruppenänderungen mit bestehender K.-o.-Phase wird diese annulliert und muss nach Klärung der Qualifikation neu geplant werden. Bei K.-o.-Korrekturen erfolgt eine konservative Annullierung nachfolgender Runden; intakte abgeschlossene Spiele der gleichen Runde bleiben erhalten. Es werden keine historischen Ergebnisse stillschweigend gelöscht. Ein ungespielter Gruppenplan kann separat mit Bestätigung verworfen und neu erstellt werden.

## Anmeldung und Schutz vor Rateversuchen

Die Turnierleitung setzt das gemeinsame Veranstaltungspasswort unter Verwaltung. Mindestens 12 Zeichen. Neue Helfer schreiben `/start`, wählen „Als Helfer anmelden“ und senden das Passwort privat. Der Bot versucht, die Passwortnachricht zu löschen. Eine korrekte Eingabe erstellt nur eine Beitrittsanfrage. Die Leitung prüft die Person und gibt sie frei oder lehnt sie ab; optional verknüpft sie das Teilnehmerprofil.

Das Passwort wird mit gesalzenem scrypt gespeichert (N=131072, r=8, p=1). Fehlversuche werden vor weiteren teuren Prüfungen begrenzt: pro Telegram-ID höchstens fünf Prüfversuche je 15 Minuten, ansteigende Wartezeiten, global höchstens 30 je Minute und höchstens zwei gleichzeitige Hashprüfungen je Prozess. Zähler und Fristen liegen in PostgreSQL und bleiben nach Neustart erhalten. Globale Limits betreffen neue Anmeldungen, nicht den laufenden Betrieb freigegebener Helfer. Ein Passwortwechsel macht offene alte Anfragen ungültig; bestehende Rollen bleiben erhalten und können separat entzogen werden.

## Website und Exporte

`/statistik` zeigt Turbo-Sitzungen, persönliche Ranglisten, gemeinsame Gästestatistik und Begegnungen. PDF und CSV sind auf der Website und über den Bot verfügbar. Beide verwenden dieselben freigegebenen Daten wie die Rangliste; unfertige und annullierte Spiele zählen nicht. CSV schützt Textzellen vor Tabellenformeln. PDFs enthalten keine Telegram-IDs oder Zugangsdaten.

Downloads: `/statistik/ID.pdf`, `/statistik/ID.csv`, `/regelwerk.pdf`; `/turnier.pdf` bleibt bis zum feststehenden klassischen Sieger gesperrt.

## Entwicklung und Tests

`npm ci --ignore-scripts`, `npm run verify`. Ohne DATABASE_URL laufen Datenbanktests mit PGlite. Mit DATABASE_URL muss die dedizierte Testdatenbank auf `_test` enden. CI verwendet PostgreSQL 17 und prüft zusätzlich echte konkurrierende Änderungen sowie den Docker-Build. Niemals Tests gegen die Turnierdatenbank ausführen.

Vor echtem Einsatz zusätzlich in einem eigenen Teststack prüfen: Telegram-Nachrichten und Medienuploads, mehrere reale Helfergeräte, Neustart, Backup/Restore und tatsächliche Reverse-Proxy-Konfiguration. Die statische Demo dient dem Kennenlernen und verbindet sich nicht mit Telegram oder einer Datenbank.

## Chat aufräumen

Pro Instanz und privatem Chat ersetzt eine neue Bediennachricht die vorherige. FTB speichert deren Nachrichten-ID, damit das Aufräumen nach einem Neustart weitergeht. Eine alte Bediennachricht wird erst entfernt, nachdem die neue erfolgreich zugestellt und gespeichert wurde. Verarbeitete Befehle, Texte und Logo-Eingaben werden ebenfalls entfernt. PDF- und CSV-Downloads bleiben erhalten. Löschfehler verhindern keine Bedienung. Telegram kann insbesondere das Löschen älterer Nachrichten begrenzen; Nachrichten aus der Zeit vor dieser Funktion kann der Bot nicht rückwirkend aus dem Chatverlauf auslesen.

## Teilnehmer gesammelt anlegen

Unter **Zugänge & Einstellungen → Teilnehmer & Teams** stehen Sammelimporte bereit. Eine Person pro Zeile, oder eine Zeile pro Team mit optionalen Spielernamen:

```text
Team Nord: Max, Anna
Team Süd
Team West: Max, Robin
```

Die Vorschau zeigt die Anzahl und die ersten Namen. Die gesamte Liste wird vor dem Speichern geprüft und atomar übernommen. Vorhandene Namen im selben Team werden übersprungen. Pro Nachricht sind bis zu 200 Zeilen und 500 zugehörige Spielernamen möglich, innerhalb des Telegram-Nachrichtenlimits. Teams dürfen ohne Spielernamen angelegt werden. Wiederholte Namen in unterschiedlichen Teams sind erlaubt.

## Neue Spiele und Gäste

Bei **Spiel zusammenstellen** zuerst **Mischen** oder **Seiten selbst festlegen** wählen. Beim Mischen werden ausschließlich die markierten Personen verteilt. Bei manueller Besetzung zuerst beide Personenseiten festlegen. Danach kommen Gäste, Spieltag und Rundenzähler. Die Vorschau zeigt beide Seiten vor dem Speichern. ✅ kennzeichnet ausgewählte Personen. **? Erklärung** klappt Hilfe im aktuellen Dialog auf und wieder zu, ohne Werte zu verändern. Spieltage werden als DD.MM.YY eingegeben; ISO-Daten bleiben kompatibel.

In Teamturnieren gibt es vor dem Spielstart die Aktion **Gäste für dieses Spiel**. Gäste bleiben auf diese Begegnung und Seite begrenzt. Sie werden nicht als dauerhafte Personen angelegt und verändern keine Teammitgliedschaften. Nach Spielbeginn ist diese Besetzung gesperrt.

**Website gestalten** enthält Titel, Logo, Farben, Sponsoren und Regeln. **Zugänge & Einstellungen** enthält Rechte, Teilnehmer, Felder, Website-Zugang und Gruppen. Numerische Telegram-IDs dienen intern weiter der Zuordnung. Die Bedienung zeigt nach einer Bot-Interaktion den @Namen oder Telegram-Vor- und Nachnamen.

## Gruppen und automatische Updates

1. Im privaten Bot **Zugänge & Einstellungen → Gruppen & Updates → Gruppe verbinden** öffnen.
2. Den Bot zur Gruppe hinzufügen. Den erzeugten Befehl dort selbst als Turnierleitung senden. Er enthält Instanzkennung und einen einmaligen, zehn Minuten gültigen Code.
3. `/statistik@BOTNAME` zeigt die freigegebene Statistik. Alle Mitglieder einer verbundenen Gruppe dürfen sie abrufen.
4. Eine Turnierleitung aktiviert mit `/updates@BOTNAME an` Spielstarts, Fortsetzungen und freigegebene Ergebnisse samt Statistik. Mit `aus` werden sie abbestellt. Standardmäßig sind automatische Updates aus.
5. `/ftb_trennen@BOTNAME` trennt die Gruppe. Auch das ist auf die Turnierleitung begrenzt.

Ersetze `BOTNAME` durch den tatsächlichen Botnamen. Die explizite @Adressierung funktioniert auch bei aktivierter Telegram-Gruppen-Privatsphäre und mehreren Bots. Für das Löschen des Verbindungscodes kann Telegram zusätzliche Gruppenrechte verlangen. Gruppen sind reine Anzeigekanäle: Administration, Helferanmeldung, Website-Anmeldung und Ergebniskorrekturen bleiben privat. Die Freigabe einer Gruppe erlaubt ihren Mitgliedern die dort veröffentlichten Statistiken auch dann, wenn die Website separat geschützt ist. Ein gemeinsamer Gateway-Bot ordnet eine Gruppe genau einer Instanz zu. Vor einem Wechsel die bestehende Verbindung trennen.
