# Provisionsmanager – Kern (Schritt 1)

Enthalten: Berechnungslogik, Status-/Auszahlungslogik, Kennzahlen, Exporte, Tests, Datenbankschema mit RLS und privatem Storage.
Noch nicht enthalten: React-Oberfläche, Login-Seiten, Upload-Komponenten, GitHub-Actions-Workflow, vollständige Setup-README (kommen in den nächsten Schritten).

## Einbinden
Ordner `src/` und `supabase/` in das Repository kopieren. Benötigt:

    npm i -D vitest typescript
    # tsconfig: "allowImportingTsExtensions": true  (Vite-Standard-Template hat das bereits)
    npm test      # "test": "vitest run"

Datenbank: `supabase/migrations/20261018000000_init.sql` im Supabase-SQL-Editor ausführen (oder `supabase db push`).
Zugriffstests: `supabase test db` (nutzt `supabase/tests/rls.test.sql`).

## Wichtige Entwurfsentscheidungen
- Geld = ganze Cent (Integer), Prozent = Basispunkte (1250 = 12,5 %). Kein Fließkomma, Rundung kaufmännisch pro Position.
- `calculateCommission(input, rules)` ist eine reine Funktion; Vorschau und Speichern rufen dieselbe Funktion auf.
- `buildSnapshot(...)` friert Eingaben, Regeln und Ergebnis pro Auftrag ein (`orders.calculation`). Bei Neuberechnung archiviert ein Datenbank-Trigger den alten Snapshot in `orders.calculation_history`.
- Regelversionen (`rule_sets`) sind unveränderlich: nur neue Versionen anlegen. Beim ersten Login `DEFAULT_RULES` als Version 1 speichern.
- Historische Auszahlungen sind eine eigene Tabelle ohne Regelbezug und zählen nur zu „Ausgezahlt“.
- Dateipfade im Bucket: `<user_id>/<order|historical>/<uuid>-<dateiname>`; RLS prüft den ersten Pfadteil. Beim Löschen zuerst die Datei über die Storage-API löschen, dann den Anhang-Datensatz.

## Annahmen – bitte prüfen
1. Grundprovision gilt nur für PV und PV + Wärmepumpe (auf den Netto-Anlagenpreis). Bei reiner Wärmepumpe wird die Provision über die Zusatzposition „Wärmepumpe, 5–18 kW“ erfasst; ein eingegebener Netto-Preis erzeugt dort nur eine Warnung.
2. Überverkauf wird bei PV angesetzt, bei PV + Wärmepumpe mit Prüfhinweis, bei anderen Projektarten nicht.
3. Grenzwert 12,5 % bezieht sich auf den Netto-Anlagenpreis ohne Überverkauf.
4. „Offen“ = Kundenzahlungsstand ≥ Schwelle; Restbetrag nach Teilzahlung bleibt offen bzw. erwartet je nach Schwelle.
5. Dashboard-Zeitraumfilter: Erwartet/Offen/Anzahl nach Vertragsdatum, Ausgezahlt nach Auszahlungsdatum.
6. Historische Auszahlungen müssen > 0 € sein (keine Rückforderungen).
