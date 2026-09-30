# TeamPlan · Gemeinsame Urlaubsplanung

Moderne, mobil nutzbare Urlaubsplanung im Helios-inspirierten Look. Die App läuft ohne Build-Schritt direkt auf GitHub Pages. Ohne Backend arbeitet sie lokal im Browser. Mit Supabase werden Änderungen zwischen mehreren Geräten live synchronisiert.

## Funktionen

- Mitarbeitende anlegen, bearbeiten, löschen und per Drag & Drop sortieren
- Wochenstunden, Stellenanteil, Arbeitstage pro Woche und individuelle Arbeitstage
- Automatische Urlaubsberechnung auf Basis der tatsächlichen Arbeitstage pro Woche
- Übertrag und individuelle Urlaubskorrektur
- Mehrfachbelegung pro Datum: `U`, `X`, `XU`, `S`, `G`, z. B. `U + G`
- Priorität Normal / Wichtig / Hoch und freie Notiz je Planeintrag
- Resturlaub, bereits geplanter Urlaub und XU je Mitarbeiter
- Tagessummen für Urlaub, XU und Schule
- Einstellbare Warnschwelle für maximale parallele Urlaube
- Zusätzliche Warnschwelle für U + XU + optional Schule
- Wochenenden und gesetzliche Feiertage in Nordrhein-Westfalen hervorgehoben
- Warnung, wenn Urlaub auf einem nicht regulären Arbeitstag eingetragen wird
- Mitarbeiter-Suche
- JSON Backup und Wiederherstellung
- Responsive Oberfläche, Druckansicht, Liquid-Glass-Stil
- Optionaler Live-Sync über Supabase Realtime

## Wichtige Logik bei Teilzeit

Die Urlaubstage werden nicht einfach aus dem Stellenanteil in Prozent berechnet. Wer z. B. 80 % arbeitet, aber weiterhin Montag bis Freitag arbeitet, hat bei gleichem Tarifanspruch dieselbe Zahl Urlaubstage wie eine Vollzeitkraft. Reduziert wird der Anspruch, wenn sich die Zahl der regelmäßigen Arbeitstage pro Woche reduziert.

Formel:

`Vollzeit-Urlaub × Arbeitstage pro Woche / 5 + Übertrag + Korrektur`

Beispiel: 30 Tage Vollzeitanspruch und 4 Arbeitstage pro Woche = 24 Urlaubstage.

## Lokal starten

Da die App vollständig statisch ist, reicht ein kleiner Webserver:

```bash
python3 -m http.server 8080
```

Dann `http://localhost:8080` öffnen.

## GitHub Pages

Der Workflow unter `.github/workflows/pages.yml` deployt den Stand aus `main` automatisch über GitHub Pages.

## Gemeinsame Live-Nutzung mit Supabase

GitHub Pages ist nur der Webserver. Für eine gemeinsame Planung braucht die App einen zentralen Datenspeicher.

1. Kostenloses Supabase-Projekt erstellen.
2. `supabase.sql` im SQL Editor ausführen.
3. `config.example.js` nach `config.js` kopieren.
4. `supabaseUrl`, `supabaseAnonKey` und eine eindeutige `teamId` eintragen.
5. `config.js` committen.
6. Seite neu laden. Oben rechts muss `● Live synchron` erscheinen.

### Sicherheit

Die mitgelieferte SQL Policy ist bewusst für einen internen Prototyp sehr offen. Wer die GitHub-Pages-Adresse und den Supabase-Key kennt, kann den Plan lesen bzw. ändern. Für produktiven Klinikbetrieb sollten vor echten Personaldaten mindestens diese Punkte ergänzt werden:

- Supabase Auth oder SSO
- Rollen `Admin`, `Planer`, `Mitarbeiter`, `Nur Lesen`
- Row Level Security je Team
- Audit-Log mit Änderungsverlauf
- Datenschutzprüfung und Freigabe durch die zuständige IT / Datenschutzstelle

## Sinnvolle nächste Ausbaustufe

- Login und rollenbasierte Rechte
- Genehmigungsworkflow: Wunsch → geprüft → genehmigt / abgelehnt
- Urlaubssperren und Mindestbesetzung pro Qualifikation
- Skill-Mix, z. B. Notfallpflege, Praxisanleitung, MTS, Schockraum
- Jahresübersicht und Heatmap
- Excel / PDF Export
- automatische Feiertage für weitere Bundesländer
- Historie / Undo
- mobile Schnellansicht für Mitarbeitende
- separate Wunschphase, damit Mitarbeitende nicht direkt genehmigten Urlaub verändern
