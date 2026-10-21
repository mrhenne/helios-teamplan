# ZNA Core · Team Management & Organisation

Mobil nutzbare Team-App im Helios-inspirierten Look mit drei Modulen: **Urlaubsplanung**, **Fortbildungen** und **Projekte**. Die App läuft ohne Build-Schritt direkt auf GitHub Pages. Mit Supabase (Login, Rollen, Live-Sync) arbeitet das Team gemeinsam; ohne Konfiguration läuft sie lokal im Browser.

## Module

**Urlaubsplanung**
- Mitarbeitende mit Wochenstunden, Stellenanteil, Arbeitstagen, Übertrag und Korrektur
- Mehrfachbelegung pro Datum (`U`, `X`, `XU`, `S`, `G`, eigene Kürzel), Priorität, Notiz, Status Wunsch → genehmigt
- Resturlaub, Tagessummen, Warnschwellen, Sperrzeiten, Konfliktprüfung
- NRW-Feiertage und -Schulferien, Monats- und Jahresansicht, Fokusmodus, Excel/PDF-Export
- Team-Chat zu Planungsfragen, Live-Präsenz, Verlauf

**Fortbildungen**
- Übersicht, Kalender, Mehrjahresmatrix, Teamstatus, Mitarbeiteransicht
- Fortbildungsarten mit Farben, Terminserien (monatlich/wöchentlich), Budgets, Export

**Projekte**
- Übersicht, Meine Aufgaben, Roadmap, Kanban, Kalender (Monat/Jahr), Team, Notizboard
- Mehrere Verantwortliche, Checklisten, Kommentare, wiederkehrende Aufgaben, Vorlagen, PDF-Export

**Rollen:** Admin, Planer, Mitarbeiter, Externer Projektmitarbeiter, Nur Lesen – durchgesetzt per Row Level Security in Supabase.

## Urlaubsanspruch bei Teilzeit

Der Anspruch richtet sich nach den regelmäßigen Arbeitstagen pro Woche, nicht nach dem Stellenanteil:

`Vollzeit-Urlaub × Arbeitstage pro Woche / 5 + Übertrag + Korrektur`

Beispiel: 30 Tage Vollzeitanspruch und 4 Arbeitstage pro Woche = 24 Urlaubstage.

## Projektstruktur

| Datei / Ordner | Inhalt |
| --- | --- |
| `index.html` | Oberfläche, Dialoge, SVG-Icons, Login-Fallback |
| `styles.css`, `header.css` | Gestaltung (`header.css` wird zuletzt geladen) |
| `js/01-core.js` … `js/12-main.js` | App-Logik, nach Bereichen aufgeteilt (siehe unten) |
| `config.js` | Supabase-URL, Publishable Key, Team-ID |
| `supabase.sql` | Datenbankschema, RLS-Policies, RPC-Funktionen |
| `supabase/functions/teamplan-users` | Edge Function für die Benutzerverwaltung (nur Admins) |
| `tests/` | Statische Prüfung und Playwright-Browsertests |
| `tools/` | Werkzeuge für Umbauten (CSS-Bereinigung, Optik-Vergleich) |

Die Skripte in `js/` sind klassische Skripte ohne Build-Schritt und teilen sich einen gemeinsamen globalen Scope. **Die Reihenfolge in `index.html` ist wichtig:** Grundlagen zuerst, `12-main.js` (Start und Verdrahtung der Bedienelemente) zuletzt.

| Skript | Bereich |
| --- | --- |
| `01-core.js` | Konstanten, Zustand, Sitzungs-Timer, Rechte, Hilfsfunktionen |
| `02-chat.js` | Team-Chat, Lesestatus, Live-Präsenz, Rückgängig |
| `03-vacation-model.js` | Kürzel, Urlaubsanspruch, Feiertage, Ferien, Tageszählung |
| `04-vacation-planner.js` | Planer-Ansicht, Zellen, Drag-Auswahl, Dialoge, Import |
| `05-admin.js` | Rollen, Benutzerverwaltung, Sperrzeiten, Verlauf |
| `06-vacation-conflicts.js` | Konfliktprüfung |
| `07-vacation-export.js` | Excel- und PDF-Export Urlaub |
| `08-auth.js` | Einstellungen, Konto, Ersteinrichtung, Anmeldung |
| `09-training.js` | Modul Fortbildungen |
| `10-projects.js` | Modul Projekte |
| `11-sync.js` | Supabase-Verbindung und Live-Sync |
| `12-main.js` | App-Start |

Nach Änderungen an CSS/JS die Versionsnummer `?v=…` in `index.html` erhöhen, damit iPhones nicht die alte Datei aus dem Cache laden.

## Lokal starten

```bash
npm run serve        # oder: python3 -m http.server 8080
```

Dann `http://localhost:8080` öffnen. Ohne gültige `config.js` läuft die App im Lokalmodus (Daten nur im Browser).

## Tests

```bash
npm install
npm run test:qa
```

`test:static` prüft IDs, Icons, Tabellen und RLS-Abdeckung; `test:browser` startet die Playwright-Tests (Chrome) in vier Bildschirmgrößen.

### Optik bei Umbauten absichern

Für Aufräumarbeiten, die nichts am Aussehen ändern sollen:

```bash
node tools/visual/seed.js                       # einmalig: Beispieldaten erzeugen
node tools/visual/snapshot.js ../snap-vorher    # vor dem Umbau
node tools/visual/snapshot.js ../snap-nachher   # nach dem Umbau
node tools/visual/compare.js ../snap-vorher ../snap-nachher
```

Der Vergleich prüft die berechneten Styles aller Elemente in allen Modulen, Rollen und Dialogen – hell/dunkel, Desktop/Tablet/iPhone und Druckansicht. `npm run css:clean` (`tools/css-clean.js`) entfernt nachweislich wirkungsloses CSS (nie verwendete Selektoren, sicher überschriebene Deklarationen).

## Betrieb

- **Hosting:** GitHub Pages, deployt automatisch aus `main` (`.github/workflows/pages.yml`).
- **Datenbank:** Supabase-Projekt `oiqmolyvapczccqschur`. Neue Schemaänderungen als Migration einspielen und in `supabase.sql` nachtragen.
- Im selben Supabase-Projekt liegen auch die Tabellen `members`, `projects`, `tasks`, `notes` der separaten **Flowly**-App (`flowly-pm.vercel.app`). Nicht ohne Rücksprache entfernen.

## Sicherheit

- Anmeldung über Supabase Auth, Teamzugehörigkeit und Rolle in `team_members`
- Row Level Security auf allen Tabellen; Hilfsfunktionen im nicht öffentlichen Schema `private`
- Benutzerverwaltung nur über die Edge Function mit Admin-Prüfung
- Automatischer Logout nach 15 Minuten Inaktivität
- Offene Empfehlung: „Leaked Password Protection“ in Supabase Auth aktivieren (Dashboard → Authentication → Passwords)
