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
