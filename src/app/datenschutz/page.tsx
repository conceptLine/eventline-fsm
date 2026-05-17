/**
 * Datenschutzerklärung — öffentlich, kein Auth.
 *
 * Teil 1 (Website): 1:1 von der offiziellen EVENTLINE-Website:
 * https://www.eventline-basel.com/datenschutzerklrung
 *
 * Teil 2 (FSM-Portal): Ergaenzung fuer App-spezifische Verarbeitung
 * (Mitarbeitende, Partner, Stempelzeiten, Rapporte, Sub-Auftrags-
 * bearbeiter Supabase/Vercel/Resend/Bexio/Anthropic).
 *
 * Wenn der Text aktualisiert wird, hier nachziehen UND die Versions-
 * Konstante in src/lib/datenschutz.ts inkrementieren — das triggert
 * Re-Akzeptanz beim naechsten Partner-Login.
 */

import Link from "next/link";
import { Logo } from "@/components/logo";
import { BackButton } from "@/components/ui/back-button";

export const metadata = {
  title: "Datenschutz — EVENTLINE FSM",
  description: "Datenschutzerklärung von EVENTLINE GmbH Basel",
};

export default function DatenschutzPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-4">
          <BackButton fallbackHref="/" size="sm" />
          <Logo size="md" />
          <h1 className="text-lg font-semibold ml-auto">Datenschutzerklärung</h1>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6 text-sm leading-relaxed">
        <Section title="Ganzheitlicher Schutz Ihrer Daten">
          <p>
            Die EVENTLINE GmbH (nachfolgend „wir") misst dem Schutz Ihrer
            Privatsphäre hohe Bedeutung bei. Wir behandeln Ihre personen­
            bezogenen Daten vertraulich und entsprechend den gesetzlichen
            Vorschriften des Schweizer Datenschutzgesetzes (nDSG) sowie
            dieser Datenschutzerklärung.
          </p>
        </Section>

        <Section title="Verantwortliche Stelle">
          <p>Verantwortlich für die Datenverarbeitungen auf dieser Website ist:</p>
          <p>EVENTLINE GmbH</p>
          <p>St. Jakobs-Strasse 200, CH-4052 Basel</p>
          <p>E-Mail: <a className="text-blue-600 hover:underline" href="mailto:info@eventline-basel.com">info@eventline-basel.com</a></p>
        </Section>

        <Section title="Datenerfassung auf unserer Website">
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>Kontaktformular:</strong> Wenn Sie uns per Kontaktformular
              Anfragen zukommen lassen, werden Ihre Angaben aus dem Anfrage­
              formular (Vorname, Nachname, E-Mail-Adresse, Telefonnummer sowie
              Eventstart- und Enddatum) zwecks Bearbeitung der Anfrage und für
              den Fall von Anschlussfragen bei uns gespeichert. Diese Daten
              geben wir nicht ohne Ihre Einwilligung weiter.
            </li>
            <li>
              <strong>Server-Log-Files:</strong> Unser Hosting-Provider
              Squarespace erhebt und speichert automatisch Informationen in
              sogenannten Server-Log-Files, die Ihr Browser automatisch an uns
              übermittelt (z. B. IP-Adresse, Browsertyp, Betriebssystem).
            </li>
          </ul>
        </Section>

        <Section title="Analyse-Tools und Werbung">
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>Squarespace Analytics:</strong> Wir nutzen das integrierte
              Analysetool von Squarespace, um das Besucherverhalten auf unserer
              Website besser zu verstehen und unser Angebot zu optimieren.
              Dabei werden Cookies eingesetzt.
            </li>
            <li>
              <strong>Instagram (Meta):</strong> Wir verlinken auf unser
              Instagram-Profil und nutzen Instagram zu Werbezwecken. Wenn Sie
              unsere Seite besuchen und gleichzeitig in Ihrem Instagram-Account
              eingeloggt sind, kann Meta den Besuch unserer Seite Ihrem
              Benutzerkonto zuordnen. Details entnehmen Sie der Datenschutz­
              erklärung von Meta/Instagram.
            </li>
          </ul>
        </Section>

        <Section title="Drittdienste und Inhalte">
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>Google Maps:</strong> Wir binden Landkarten des Dienstes
              „Google Maps" des Anbieters Google LLC ein. Dabei kann die
              IP-Adresse des Nutzers an Google in die USA übertragen werden.
            </li>
            <li>
              <strong>Google Fonts:</strong> Zur optisch verbesserten
              Darstellung unserer Inhalte verwenden wir Google Fonts. Diese
              Schriften werden beim Aufruf der Seite in Ihren Browser-Cache
              geladen. Dabei kann eine Verbindung zu Google-Servern hergestellt
              werden.
            </li>
            <li>
              <strong>SSL-Verschlüsselung:</strong> Diese Seite nutzt aus
              Sicherheitsgründen und zum Schutz der Übertragung vertraulicher
              Inhalte eine SSL- bzw. TLS-Verschlüsselung (HTTPS).
            </li>
          </ul>
        </Section>

        <Section title="Datentransfer ins Ausland">
          <p>
            Da wir Squarespace als Hoster sowie Dienste von Google und Meta
            nutzen, können Ihre Daten in die USA übertragen werden. Wir achten
            darauf, dass die Anbieter zertifiziert sind oder Standard­vertrags­
            klauseln nutzen, um ein angemessenes Datenschutzniveau zu
            gewährleisten.
          </p>
        </Section>

        {/* ──────────────────────────────────────────────────────────── */}
        <div className="pt-6 border-t-2 border-foreground/10">
          <h2 className="text-xl font-bold mb-2">Ergänzung für das EVENTLINE FSM-Portal</h2>
          <p className="text-sm text-muted-foreground">
            Die folgenden Abschnitte gelten zusätzlich, wenn Sie als Mitarbeitende,
            Locationspartner oder Kundin/Kunde die interne Field-Service-Management-
            Anwendung (FSM-Portal, Partnerportal) nutzen.
          </p>
        </div>

        <Section title="Welche Daten wir im FSM-Portal verarbeiten">
          <Sub title="Mitarbeitende">
            <ul className="list-disc pl-5 space-y-1">
              <li>Identifikations- und Kontaktdaten (Name, E-Mail, Telefon)</li>
              <li>Anstellungsdaten (Rolle, Funktion, Aktiv-Status)</li>
              <li>Arbeitszeiten (Stempelzeiten mit Datum, Beginn, Ende)</li>
              <li>Auftrags-Zuweisungen und Termine</li>
              <li>Arbeitsrapporte inkl. Unterschriften und Einsatzfotos</li>
              <li>Authentifizierungs-Logs (Anmeldungen, Passwortänderungen)</li>
              <li>Ferien- und Abwesenheitsmeldungen</li>
            </ul>
          </Sub>
          <Sub title="Locationspartner">
            <ul className="list-disc pl-5 space-y-1">
              <li>Geschäftliche Kontaktdaten</li>
              <li>Zugewiesene Location</li>
              <li>Anfrage-Inhalte, Termine, Notizen, hochgeladene Dokumente</li>
              <li>Authentifizierungs-Logs</li>
              <li>Zeitpunkt der Akzeptanz dieser Datenschutzerklärung</li>
            </ul>
          </Sub>
          <Sub title="Kunden, Veranstalter, Ansprechpersonen">
            <ul className="list-disc pl-5 space-y-1">
              <li>Name, Anschrift, Telefon, E-Mail</li>
              <li>Vertragsbezogene Informationen</li>
              <li>Unterschriften auf Arbeitsrapporten</li>
            </ul>
          </Sub>
        </Section>

        <Section title="Zweck der Bearbeitung">
          <ul className="list-disc pl-5 space-y-1">
            <li>Erfüllung von Arbeitsverträgen und gesetzlichen Pflichten (Arbeitszeit-Erfassung, Lohnabrechnung)</li>
            <li>Durchführung von Veranstaltungs- und Servicearbeiten</li>
            <li>Kommunikation mit Partnern, Kunden und Lieferanten</li>
            <li>Rechnungsstellung und Buchhaltung (inkl. Übermittlung an Bexio)</li>
            <li>Erfüllung gesetzlicher Aufbewahrungspflichten (OR Art. 957a — 10 Jahre)</li>
            <li>Wahrung berechtigter Interessen (IT-Sicherheit, Missbrauchserkennung)</li>
          </ul>
        </Section>

        <Section title="Sub-Auftragsbearbeiter für das FSM-Portal">
          <p>
            Für den Betrieb des FSM-Portals setzen wir folgende Dienstleister
            ein. Mit allen bestehen Auftragsbearbeitungsverträge (AVV/DPA):
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Supabase Inc.</strong> (USA, Hosting in Zürich/Schweiz) — Datenbank, Authentifizierung, Datei-Speicher</li>
            <li><strong>Vercel Inc.</strong> (USA, EU-Hosting verfügbar) — Web-Hosting und Content-Delivery</li>
            <li><strong>Resend Inc.</strong> (USA) — Versand transaktionaler E-Mails (Setup-Mails, Benachrichtigungen)</li>
            <li><strong>Bexio AG</strong> (Schweiz) — Buchhaltung und Rechnungsstellung (bei freigegebenen Aufträgen)</li>
            <li><strong>Anthropic PBC</strong> (USA) — KI-Assistenz für interne Arbeitsabläufe</li>
            <li><strong>OpenStreetMap / Nominatim</strong> — Geocoding von Adressen</li>
          </ul>
          <p className="text-xs text-muted-foreground mt-2">
            Die Liste wird aktuell gehalten. Bei Aufnahme weiterer Sub-Auftrags­
            bearbeiter wird die Versions-Nummer dieser Erklärung erhöht und
            Partner-Nutzer:innen zur erneuten Akzeptanz aufgefordert.
          </p>
        </Section>

        <Section title="Aufbewahrungsfristen">
          <ul className="list-disc pl-5 space-y-1">
            <li>Geschäftsunterlagen (Aufträge, Rechnungen): 10 Jahre (OR Art. 958f)</li>
            <li>Arbeitszeit-Daten: gemäss ArG mindestens 5 Jahre</li>
            <li>Profil- und Kontaktdaten von Mitarbeitenden: bis 10 Jahre nach Beendigung der Anstellung</li>
            <li>Partnerportal-Anfragen: solange Geschäftsbeziehung besteht + 10 Jahre</li>
            <li>Authentifizierungs-Logs: 12 Monate</li>
            <li>Stornierte oder abgelehnte Anfragen: 24 Monate</li>
          </ul>
        </Section>

        <Section title="Datensicherheit">
          <p>
            EVENTLINE schützt die im FSM-Portal verarbeiteten Daten durch
            angemessene technische und organisatorische Massnahmen:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Verschlüsselung der Übertragung (TLS) und der Datenbank-Verbindungen</li>
            <li>Rollenbasierte Zugriffsrechte (Row-Level-Security auf Datenbank-Ebene)</li>
            <li>Tägliche verschlüsselte Backups (NAS-Pull)</li>
            <li>Authentifizierungs-Logs zur Missbrauchserkennung</li>
            <li>Regelmässige Sicherheits-Reviews</li>
          </ul>
        </Section>

        <Section title="Datentransfer ins Ausland (FSM-Portal)">
          <p>
            Mehrere Sub-Auftragsbearbeiter haben ihren Sitz in den USA
            (Supabase, Vercel, Resend, Anthropic). Die operativen Daten
            werden, soweit konfigurierbar, in europäischen Rechenzentren
            gehalten (Supabase: Zürich/Schweiz). Wo Übertragungen in die USA
            stattfinden, stützen wir uns auf Standardvertragsklauseln und
            zertifizierte Anbieter, um ein angemessenes Datenschutzniveau zu
            gewährleisten.
          </p>
        </Section>

        <Section title="Selbst-Service: Datenexport">
          <p>
            Eingeloggte Nutzerinnen und Nutzer können ihre im FSM-Portal
            gespeicherten Daten jederzeit als JSON-Datei herunterladen — über
            die Funktion „Meine Daten exportieren" in den Einstellungen
            (Firmenportal) bzw. im Tab „Mein Konto" (Partnerportal).
          </p>
        </Section>

        {/* ──────────────────────────────────────────────────────────── */}
        <Section title="Ihre Rechte">
          <p>
            Sie haben im Rahmen der geltenden gesetzlichen Bestimmungen
            jederzeit das Recht auf unentgeltliche Auskunft über Ihre
            gespeicherten personenbezogenen Daten, deren Herkunft und Empfänger
            und den Zweck der Datenverarbeitung sowie ein Recht auf
            Berichtigung, Sperrung oder Löschung dieser Daten. Wenden Sie sich
            hierzu bitte an die oben genannte Kontaktadresse.
          </p>
        </Section>

        <div className="pt-8 border-t flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} EVENTLINE GmbH · Basel</p>
          <div className="flex gap-4">
            <Link href="/login" className="hover:text-foreground">Login</Link>
            <Link href="/partner/login" className="hover:text-foreground">Partner-Login</Link>
          </div>
        </div>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </div>
  );
}
