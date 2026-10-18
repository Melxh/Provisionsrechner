# Provisionsmanager

Persönlicher Provisionsrechner und -manager für Photovoltaik, Wärmepumpen und Zusatzprodukte.
Frontend: React + TypeScript + Vite + Tailwind CSS (öffentlich über GitHub Pages).
Backend: Supabase (Login, PostgreSQL mit Row Level Security, privater Dateispeicher).

> **Öffentlich erreichbar ≠ öffentlich lesbar.** Die Website ist im Internet aufrufbar, die Daten aber nicht:
> Ohne Login liefert Supabase keine einzige Zeile (Row Level Security auf allen Tabellen, privater Storage-Bucket).
> Das Repository enthält nur Code – **niemals** Kundendaten, Angebote, Exporte oder Schlüssel mit Schreibrechten committen.

## Stand
Fertig: Login/Logout/Passwort-Reset, geschützte Oberfläche, Stufenauswahl, Einstellungen (versionierte Regeln), Dashboard-Kennzahlen mit Filtern,
Berechnungslogik, Status-/Auszahlungslogik, Exporte (Logik), Datenbankschema mit RLS und Tests.
Noch offen: Formular „Neue Provision“, Auftragsverwaltung, historische Auszahlungen (Oberfläche), Dokument-Upload (Oberfläche), Auswertungen, Export-Oberfläche.

## Einrichtung

### 1. Supabase-Projekt anlegen
1. Auf <https://supabase.com> ein Konto erstellen und **New project** anlegen (Region z. B. Frankfurt).
2. **SQL Editor** öffnen und nacheinander den Inhalt dieser Dateien ausführen:
   1. `supabase/migrations/20261018000000_init.sql`
   2. `supabase/migrations/20261018000100_user_settings.sql`
3. Prüfen: unter **Storage** existiert der Bucket `documents` mit Status *Private*.

### 2. Registrierung abschalten, ersten Benutzer anlegen
1. **Authentication → Sign In / Providers** (bzw. *Providers → Email*): **„Allow new users to sign up“ ausschalten.**
2. **Authentication → Users → Add user → Create new user**: E-Mail und ein starkes Passwort eintragen, **Auto Confirm User** aktivieren.
   Nur dieser eine Benutzer kann sich anmelden.

### 3. URLs für den Passwort-Reset
**Authentication → URL Configuration**
- *Site URL*: `https://melxh.github.io/Provisionsrechner/`
- *Redirect URLs* hinzufügen:
  - `https://melxh.github.io/Provisionsrechner/passwort-neu`
  - `http://localhost:5173/Provisionsrechner/passwort-neu` (nur für lokale Entwicklung)

(Hinweis: Der in Supabase eingebaute E-Mail-Versand ist stark begrenzt. Für zuverlässigen Passwort-Reset ggf. unter *Authentication → SMTP* einen eigenen Mail-Server eintragen.)

### 4. Schlüssel in GitHub hinterlegen
Unter **Project Settings → API** in Supabase kopieren: *Project URL* und den **Publishable (bzw. anon) Key**.
**Niemals den `service_role`-/Secret-Key verwenden oder irgendwo eintragen.**

GitHub-Repository → **Settings → Secrets and variables → Actions → New repository secret**:
| Name | Wert |
|---|---|
| `VITE_SUPABASE_URL` | Project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable/anon Key |

### 5. GitHub Pages aktivieren
Repository → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
Danach bei jedem Push auf `main` (oder manuell unter *Actions → Deploy to GitHub Pages → Run workflow*) wird gebaut und veröffentlicht:
`https://melxh.github.io/Provisionsrechner/`

### Lokal entwickeln
```bash
cp .env.example .env     # Werte eintragen
npm install
npm run dev              # http://localhost:5173/Provisionsrechner/
npm test                 # Unit-Tests
npm run build            # Typprüfung + Produktions-Build
```
Datenbank-Zugriffstests: `supabase test db` (Supabase CLI, lokale Instanz).

## Sicherheitsmodell in Kürze
- Nur URL + öffentlicher Key im Frontend; Schutz durch Login und Row Level Security (`user_id = auth.uid()` auf jeder Tabelle).
- Kind-Tabellen sind per `(id, user_id)` verknüpft – Datensätze können nie fremden Eltern zugeordnet werden.
- Dateien liegen im privaten Bucket `documents`, Pfad `<user_id>/…`, Zugriff nur über signierte, kurzlebige URLs.
- Regelversionen sind unveränderlich; Aufträge speichern Stufe, Regeln und Ergebnis als Snapshot.
- Änderungsprotokoll wird nur per Datenbank-Trigger geschrieben.

## Datensicherung (kurz)
- Supabase-Dashboard → **Database → Backups** (tägliche Backups je nach Plan).
- Manuell: `supabase db dump --linked -f backup/db.sql` bzw. `pg_dump` mit der Verbindungszeichenfolge aus *Project Settings → Database*. Dateien aus `backup/` niemals committen (ist in `.gitignore`).
- Dateien: Storage-Bucket `documents` über das Dashboard oder die Storage-API herunterladen.
- Wiederherstellung: Schema per Migrationen neu anlegen, Dump einspielen, Dateien zurück in den Bucket laden.
- Die JSON-/CSV-Exporte (Oberfläche folgt) sind zusätzlich eine lesbare Sicherung der Daten.
