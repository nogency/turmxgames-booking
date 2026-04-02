# Design: Automatische Rechnungserzeugung

**Datum:** 2026-04-02
**Projekt:** turmxgames-booking

---

## Kontext

Das bestehende System nutzt Bookla für Buchungen und Stripe für Kartenzahlungen. Bookla verschickt bereits automatisch eine Buchungsbestätigung an den Kunden. Bisher wird keine formale Rechnung (mit Netto/MwSt-Aufschlüsselung) automatisch erzeugt.

## Ziel

Nach jeder Buchung — unabhängig von der Zahlungsart (Kreditkarte, PayPal, Auf Rechnung) — wird automatisch eine rechtskonforme PDF-Rechnung generiert und per E-Mail an den Kunden geschickt.

---

## Scope

**In scope:**
- PDF-Rechnung (formale Rechnung mit Netto/MwSt-Aufschlüsselung)
- Drei Zahlungswege: Kreditkarte (Stripe), PayPal (via Stripe), Auf Rechnung
- B2C: Vorname + Nachname (keine Adresse)
- B2B (Firmenevent): Firmenname, Adresse, USt-ID
- E-Mail-Versand der Rechnung via Resend

**Out of scope:**
- Buchungsbestätigung (macht Bookla bereits)
- Zahlungsverfolgung / Mahnwesen
- Admin-Dashboard für Rechnungen

---

## Zahlungsflows

### Kreditkarte / PayPal
1. Kunde zahlt → Stripe Payment Intent erfolgreich
2. Frontend ruft `create-booking` in Bookla auf
3. Frontend ruft `create-invoice` auf → PDF wird generiert + per E-Mail verschickt

### Auf Rechnung
1. Kunde wählt "Auf Rechnung" aus
2. Frontend ruft `create-booking-invoice` auf
3. API: Bookla-Buchung wird angelegt (Slot sofort blockiert, Status unbezahlt)
4. API: PDF wird generiert mit Bankdaten + Zahlungsfrist (14 Tage)
5. PDF wird per E-Mail an Kunden geschickt

---

## Neue Felder im Booking-Form

### Privatkunde (B2C)
Keine neuen Felder. Bestehende Felder: Vorname, Nachname, E-Mail, Telefon.

### Firmenevent (B2B) — neue Pflichtfelder
- Firmenname
- Straße + Hausnummer
- PLZ + Ort
- USt-ID (bereits vorhanden im Form)

### Zahlungsart-Auswahl (neuer Checkout-Schritt)
- Kreditkarte (Stripe — bereits vorhanden)
- PayPal (Stripe PayPal — neu)
- Auf Rechnung (neuer Pfad)

---

## PDF-Rechnung Inhalt

### Pflichtfelder laut §14 UStG (regelbesteuert)
- Vollständiger Name + Anschrift des Ausstellers (HB Kletterwelten GmbH)
- USt-IdNr. des Ausstellers (DE328174568)
- Rechnungsnummer (fortlaufend, eindeutig): `RE-[Bookla-Buchungsnr.]`
- Rechnungsdatum
- Leistungsdatum (= Termin)
- Leistungsbeschreibung (Service-Name, Anzahl Spieler)
- Nettobetrag
- Steuersatz (19%)
- MwSt-Betrag
- Bruttobetrag

### Kundendaten auf Rechnung
- B2C: Vorname + Nachname
- B2B: Firmenname, Adresse, USt-ID

### Zusatz bei "Auf Rechnung"
- Bankverbindung (IBAN, BIC, Kontoinhaber)
- Zahlungsfrist: "Bitte überweisen bis [Buchungsdatum + 14 Tage]"
- Verwendungszweck: Rechnungsnummer

### Zahlungsart-Vermerk
Auf allen Rechnungen: Zahlungsart angeben (Kreditkarte / PayPal / Auf Rechnung).

---

## Backend-Architektur

### Neue API-Actions in `api/bookla.js`

#### `create-invoice`
Wird nach erfolgreicher Zahlung (Karte/PayPal) aufgerufen.

**Input (POST body):**
```json
{
  "bookingId": "251295",
  "serviceId": "...",
  "serviceName": "Firmen-Teamevents",
  "date": "2026-02-27",
  "time": "11:00",
  "groupSize": 4,
  "amount": 180.00,
  "paymentMethod": "card",
  "firstName": "Jonathan",
  "lastName": "Roxlau",
  "email": "jr@nogency.de",
  "phone": "+491735295653",
  "companyName": null,
  "companyAddress": null,
  "companyZip": null,
  "companyCity": null,
  "ustId": null
}
```

**Verhalten:**
1. PDF generieren (pdfkit)
2. PDF per E-Mail via Resend an `email` schicken
3. `{ invoiceId: "RE-251295" }` zurückgeben

#### `create-booking-invoice`
Für den "Auf Rechnung"-Pfad — kombiniert Bookla-Buchung + Rechnungserzeugung.

**Input:** Identisch mit `create-booking` + die neuen Firmendaten-Felder.

**Verhalten:**
1. Bookla-Buchung anlegen (identisch zu `create-booking`)
2. `create-invoice`-Logik ausführen, PDF enthält zusätzlich Bankdaten + Zahlungsfrist
3. Buchungsdaten + Invoice-ID zurückgeben

---

## Neue Abhängigkeiten

| Package | Zweck |
|---|---|
| `pdfkit` | Server-seitige PDF-Generierung |
| `resend` | E-Mail-Versand (kostenlos bis 3.000/Monat) |

---

## Neue Umgebungsvariablen

| Variable | Beschreibung |
|---|---|
| `RESEND_API_KEY` | Resend API Key |
| `INVOICE_BANK_IBAN` | IBAN für "Auf Rechnung" |
| `INVOICE_BANK_BIC` | BIC für "Auf Rechnung" |
| `INVOICE_BANK_OWNER` | Kontoinhaber |
| `INVOICE_FROM_EMAIL` | Absender-E-Mail (z.B. `rechnungen@turmx.de`) |

---

## Bekannte Werte

| Variable | Wert |
|---|---|
| `INVOICE_FROM_EMAIL` | `games@turmx.de` |
| `INVOICE_BANK_OWNER` | HB Kletterwelten GmbH |
| `INVOICE_BANK_IBAN` | ⚠️ noch offen |
| `INVOICE_BANK_BIC` | ⚠️ noch offen |
