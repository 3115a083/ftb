# Website und mehrere Instanzen

Die Website ist lesend. Alle Änderungen an Veranstaltung, Spielbetrieb, Rollen und Website-Zugängen erfolgen im privaten Bot.

## Navigation

Live zeigt zuerst eigene Favoritenspiele, danach Felder, bestätigte Begegnungen und letzte Ergebnisse. Spielplan filtert nach Team/Person, Feld und Status. Detailseiten enthalten die gesamte Historie in Seiten zu 50 Spielen. Die Live-Ansicht lädt kleine HTML-Fragmente alle 20 Sekunden nach und pausiert in unsichtbaren Tabs. Gespeicherte Favoriten und Darstellung bleiben nur im lokalen Browser.

Auf mobilen Ranglisten stehen Platz, Name, Siegquote und Spiele im Vordergrund. Ein Name führt zu Metriken und Historie. Live-Werte sind vorläufig. Die gemeldete Gewinnerseite bleibt bis zur Freigabe verborgen. Ranglisten und Exporte zählen nur freigegebene Spiele.

## Turbo-Jahreswertung

Standard ist das aktuelle Kalenderjahr in der eingestellten Veranstaltungszeitzone. Die Jahresrangliste fasst alle Turbo-Sitzungen einer Instanz zusammen. Sitzung, Jahr und Spieltag können gefiltert werden. Die Mindestspielzahl gilt im ausgewählten Zeitraum. Sitzungswertungen verwenden ihre eigenen Metriken und Tiebreaker; die Gesamtwertung verwendet nach Siegquote standardmäßig die konfigurierbare Reihenfolge Strafbiere erhalten, verteilt, Treffer und Runden bis leer. Fehlende Messwerte sind kein gemessener Nullwert.

Besetzungen sind pro Begegnung frei, auch nur Gäste sind möglich. Nur eingesetzte Personen erhalten Einsätze und persönliche Werte. Gastnamen werden pro Spiel neu angelegt. Eine alte Besetzung kann im Bot als Vorlage übernommen werden. Unterschiedliche Seitengrößen werden vor dem Start angezeigt. Neue Metrikereignisse speichern ihre Runde; vorhandene historische Ereignisse erhalten keine erfundene Rundennummer.

## Zugangsschutz

Seitenpasswort, individuelle Konten und freigegebene Telegram-IDs lassen sich kombinieren. Passwörter verwenden scrypt mit zufälligem Salt. Anmeldeversuche werden vor der Passwortprüfung pro IP und global in PostgreSQL begrenzt. Höchstens zwei öffentliche Passwortprüfungen laufen je App gleichzeitig. Reverse-Proxy-Vertrauen ist standardmäßig deaktiviert.

Sitzungen sind zufällige opaque Tokens. Die Datenbank speichert ausschließlich SHA-256-Hashes davon. Cookies sind HttpOnly und SameSite=Lax, im HTTPS-Betrieb zusätzlich Secure und hostgebunden. Zustandsänderungen verwenden CSRF-Tokens und prüfen den Origin. Website-Zugang ist unabhängig von Staff-Rollen. Nach der Anmeldung bleibt die ursprünglich geöffnete Website-Seite mit ihren Zeitraumfiltern erhalten. Telegram-Bestätigungen gelten fünf Minuten und können anschließend neu gestartet werden. In verborgenen Tabs und ohne Netzwerk pausieren die Statusabfragen. Sperrung, Versionswechsel und Konfigurationsepoch werden bei jeder geschützten Anfrage neu geprüft. Änderungen an Rangliste, Zeitzone oder Modus erhalten bestehende Website-Sitzungen. Ein neues Seitenpasswort, geänderte Anmeldearten oder „Alle Website-Sitzungen widerrufen“ beenden sie und verwerfen offene Telegram-Anmeldungen.

Die Telegram-Anmeldung verwendet einen fünf Minuten gültigen, einmaligen Deep-Link. Freigegebene Benutzer bestätigen ausdrücklich im Bot und vergleichen einen Browser-Code. Zusätzlich bindet ein separater HttpOnly-Cookie den Abschluss an den Browser, der den Login begonnen hat. Telegram-Webzugänge werden unabhängig von Helferfreigaben verwaltet.

## Gemeinsamer Bot

Nur `gateway` pollt Telegram. Instanzen erhalten Updates über einen authentifizierten internen HTTP-Endpunkt. Jede Instanz verwendet einen eigenen Schlüssel. Zulässige Bot-Methoden sind explizit begrenzt. Callback-Daten werden im Gateway durch zufällige, benutzergebundene Verweise ersetzt. Die Zuordnung wird dauerhaft gespeichert und bleibt über Instanzwechsel und Neustarts korrekt. Telegram-Nachrichten nennen immer ihre Instanz.

Die Beispiel-Compose verwendet einen gemeinsamen PostgreSQL-Server mit drei getrennten Datenbanken und Benutzern. Die Webinstanzen enthalten keinen dauerhaften Telegram-Bot-Token. Der Gateway-Port und PostgreSQL werden nicht am Host veröffentlicht. Weitere Instanzen können mit eigener Datenbank und eigenem Schlüssel in `GATEWAY_INSTANCES` eingetragen werden. IDs enthalten 1 bis 12 Kleinbuchstaben, Ziffern oder Bindestriche.

## Testablauf

1. Beide Websites öffnen; mit `/instanzen` die passende Instanz wählen.
2. Im Teamturnier Teams und Gruppen, im Turbo Personen und eine Sitzung anlegen.
3. Zwei bis vier Felder anlegen und Spiele einschließlich 3-gegen-2 und Gästen zusammenstellen.
4. Zuweisen, starten, pausieren, Metriken erfassen und Gewinner melden.
5. Website vor Freigabe prüfen: Live-Werte sichtbar, Ranglisten unverändert, Gewinner verborgen und Feld belegt.
6. Freigeben; Statistik, Gäste und Exporte vergleichen. Jahres- und Spieltagfilter testen.
7. Favoriten und Hell/Dunkel/Automatisch wählen, Browser neu öffnen.
8. Alle drei Anmeldearten testen, Konto sperren und Sitzungen widerrufen. Geschützte Downloads dürfen ohne Sitzung keine Daten liefern.
9. Im Bot die Instanz wechseln und einen alten Button öffnen. Er muss weiterhin seine ursprüngliche Instanz zeigen.

Nach einem Update mit älteren, gleichzeitig betriebenen Modi können Administratoren unter Instanz & Website-Zugang → Andere Spiele abschließen aktive Begegnungen des anderen Modus beenden. Der Wechsel in einen Modus ist möglich, sobald keine aktiven Begegnungen des jeweils anderen Modus mehr bestehen. Neue Zuweisungen und Starts bleiben auf den gewählten Modus beschränkt.
