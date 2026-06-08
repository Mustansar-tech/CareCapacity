import { Link } from "wouter";
import { Shield, ArrowLeft, ExternalLink } from "lucide-react";

const COMPANY_NAME = "SUR Group (Scotland) Ltd t/a Home Instead";
const ICO_REG = "ZA278994";
const DPO_EMAIL = "operations@sur-group.co.uk";
const SUPPORT_EMAIL = "operations@sur-group.co.uk";
const EFFECTIVE_DATE = "8 June 2026";
const VERSION = "1.0";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-emerald-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
      <div className="max-w-3xl mx-auto px-6 py-12">
        {/* Back link */}
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to dashboard
        </Link>

        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center shadow-lg">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Privacy Policy</h1>
            <p className="text-sm text-muted-foreground">Version {VERSION} · Effective {EFFECTIVE_DATE}</p>
          </div>
        </div>

        <div className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed space-y-8">

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">1. Who we are</h2>
            <p>
              This Care Capacity Dashboard ("the System") is operated by <strong>{COMPANY_NAME}</strong> ("we", "us", "our"),
              a company registered in Scotland. We are registered with the Information Commissioner's Office (ICO)
              under registration number <strong>{ICO_REG}</strong>.
            </p>
            <p className="mt-2">
              For privacy-related enquiries, contact our Data Protection Lead at{" "}
              <a href={`mailto:${DPO_EMAIL}`} className="text-blue-600 dark:text-blue-400 hover:underline">{DPO_EMAIL}</a>{" "}
              or write to us at the address held in your employment or service agreement.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">2. What this System does</h2>
            <p>
              The System is an internal workforce management tool used by authorised staff to plan and analyse weekly care
              delivery schedules. It processes exports from our care management platform and produces capacity
              analytics, route optimisation, and scheduling recommendations for Care Professionals (Care Pros) and
              care clients.
            </p>
            <p className="mt-2">
              Access is restricted to authorised employees of {COMPANY_NAME}. It is not a public-facing service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">3. Personal data we process</h2>
            <p>We process the following categories of personal data:</p>

            <h3 className="text-base font-medium text-gray-800 dark:text-gray-200 mt-4 mb-2">Care Professionals (employees)</h3>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>Full name</li>
              <li>Home postcode and derived geographic coordinates</li>
              <li>Gender (used for carer–client matching preferences)</li>
              <li>Transport mode (car, walking, public transport)</li>
              <li>Weekly availability, contracted hours, and time windows</li>
              <li>Sickness, holiday, and unavailability records</li>
              <li>Scheduled visit times and client assignments</li>
            </ul>

            <h3 className="text-base font-medium text-gray-800 dark:text-gray-200 mt-4 mb-2">Care clients</h3>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>Full name</li>
              <li>Service address, postcode, and derived geographic coordinates</li>
              <li>Visit requirements: duration, time windows, service type</li>
            </ul>

            <h3 className="text-base font-medium text-gray-800 dark:text-gray-200 mt-4 mb-2">System users (administrators and schedulers)</h3>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>Email address</li>
              <li>Display name</li>
              <li>Role and branch access assignments</li>
              <li>Login and logout timestamps (audit log)</li>
              <li>Legal document acceptance records (version and timestamp)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">4. Lawful basis for processing</h2>
            <p>We rely on the following lawful bases under UK GDPR Article 6:</p>
            <ul className="list-disc list-inside space-y-1 pl-2 mt-2">
              <li>
                <strong>Article 6(1)(b) — Performance of a contract:</strong> processing employee scheduling data
                is necessary to fulfil employment contracts and service delivery obligations.
              </li>
              <li>
                <strong>Article 6(1)(f) — Legitimate interests:</strong> processing client location and visit data
                to optimise care delivery routes, reduce travel time, and improve scheduling efficiency — all directly
                serving the welfare of care clients.
              </li>
              <li>
                <strong>Article 6(1)(c) — Legal obligation:</strong> retaining audit logs and access records to
                meet regulatory requirements applicable to care providers.
              </li>
            </ul>
            <p className="mt-3">
              Where we process data that may indicate a health condition (e.g. sickness records, sleep-in visits,
              personal care service types), this constitutes special category data under Article 9. Our lawful basis
              for special category data is Article 9(2)(b) — employment and social security obligations, and/or
              Article 9(2)(h) — provision of health or social care services.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">5. Third-party data processors</h2>
            <p>
              We share limited personal data with the following third-party services, who act as data processors on
              our behalf. In each case, only geographic coordinates (latitude/longitude) derived from postcodes
              are transmitted — no names, addresses, or contact details are shared.
            </p>

            <div className="mt-4 space-y-4">
              <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white text-sm">OpenRouteService (ORS)</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Heidelberg Institute for Geoinformation Technology, Germany</p>
                  </div>
                  <a href="https://openrouteservice.org/privacy/" target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap">
                    Privacy policy <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                  Used to calculate driving travel times and route matrices between employee home locations and client addresses.
                  Data transmitted: coordinate pairs only. Data is not stored by ORS beyond the request lifecycle.
                </p>
              </div>

              <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white text-sm">TravelTime Platform</p>
                    <p className="text-xs text-muted-foreground mt-0.5">iGeolise Ltd, United Kingdom</p>
                  </div>
                  <a href="https://traveltime.com/privacy-policy" target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap">
                    Privacy policy <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                  Used to calculate walking and public transport travel times for Care Pros without a car.
                  Data transmitted: coordinate pairs only. No names or personal identifiers are sent.
                </p>
              </div>

              <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white text-sm">postcodes.io</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Open-source UK postcode geocoding API — public instance</p>
                  </div>
                  <a href="https://postcodes.io/" target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap">
                    Project site <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                  Used to resolve UK postcodes to geographic coordinates (latitude/longitude).
                  Data transmitted: postcode strings only. No names, addresses, or personal identifiers are sent.
                </p>
              </div>
            </div>

            <p className="mt-4">
              All other data processing (analytics, scheduling, storage) occurs within the System's own infrastructure
              hosted on Neon (PostgreSQL) and Replit, both of which process data in line with UK GDPR requirements.
              No personal data is shared with third parties for marketing or advertising purposes.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">6. Data retention</h2>
            <p>We retain personal data for the following periods:</p>
            <ul className="list-disc list-inside space-y-1 pl-2 mt-2">
              <li>Weekly capacity analyses and employee availability: <strong>12 months</strong> from the upload date.</li>
              <li>Employee and client location records: retained while active and for <strong>6 months</strong> after departure/discharge.</li>
              <li>Uploaded data files (raw): retained for <strong>90 days</strong>, then purged.</li>
              <li>Audit logs: retained for <strong>24 months</strong> to meet regulatory requirements.</li>
              <li>User accounts: deactivated immediately on departure; deleted after <strong>12 months</strong>.</li>
              <li>Legal consent records: retained for the lifetime of the user account.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">7. Your rights under UK GDPR</h2>
            <p>Where you are the subject of personal data processed by this System, you have the following rights:</p>
            <ul className="list-disc list-inside space-y-1 pl-2 mt-2">
              <li><strong>Right of access (Article 15):</strong> request a copy of data held about you.</li>
              <li><strong>Right to rectification (Article 16):</strong> request correction of inaccurate data.</li>
              <li><strong>Right to erasure (Article 17):</strong> request deletion in certain circumstances.</li>
              <li><strong>Right to restrict processing (Article 18):</strong> request that processing be paused.</li>
              <li><strong>Right to object (Article 21):</strong> object to processing based on legitimate interests.</li>
            </ul>
            <p className="mt-3">
              To exercise any of these rights, contact us at{" "}
              <a href={`mailto:${DPO_EMAIL}`} className="text-blue-600 dark:text-blue-400 hover:underline">{DPO_EMAIL}</a>.
              We will respond within 30 days. You also have the right to lodge a complaint with the ICO at{" "}
              <a href="https://ico.org.uk" target="_blank" rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1">
                ico.org.uk <ExternalLink className="h-3 w-3" />
              </a>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">8. Security</h2>
            <p>We implement appropriate technical and organisational measures to protect personal data, including:</p>
            <ul className="list-disc list-inside space-y-1 pl-2 mt-2">
              <li>Password management via Supabase Auth with secure credential storage</li>
              <li>Session management with 30-minute inactivity timeout and secure, HTTP-only cookies</li>
              <li>Role-based access control limiting data visibility by branch and user role</li>
              <li>HTTPS encryption in transit for all external API calls</li>
              <li>Audit logging of all access and modification events</li>
              <li>Rate limiting on all API endpoints to prevent abuse</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">9. Cookies</h2>
            <p>
              This System uses only a single session cookie (<code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-xs font-mono">connect.sid</code>)
              to maintain your authenticated session. This cookie is strictly necessary for the System to function and does not
              track behaviour, serve advertising, or share data with analytics providers.
            </p>
            <p className="mt-2">
              For full details, see our{" "}
              <Link href="/cookies" className="text-blue-600 dark:text-blue-400 hover:underline">Cookie Policy</Link>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">10. Changes to this policy</h2>
            <p>
              We may update this Privacy Policy from time to time. Material changes will be communicated to users
              via in-app notice requiring re-acceptance. The version number and effective date at the top of this page
              indicate when the policy was last revised.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">11. Contact us</h2>
            <p>For any questions about this Privacy Policy or how we handle your data, contact:</p>
            <ul className="list-none mt-2 space-y-1 pl-2">
              <li><strong>Data Protection Lead:</strong>{" "}<a href={`mailto:${DPO_EMAIL}`} className="text-blue-600 dark:text-blue-400 hover:underline">{DPO_EMAIL}</a></li>
              <li><strong>General support:</strong>{" "}<a href={`mailto:${SUPPORT_EMAIL}`} className="text-blue-600 dark:text-blue-400 hover:underline">{SUPPORT_EMAIL}</a></li>
              <li><strong>Organisation:</strong> {COMPANY_NAME}</li>
              <li><strong>ICO registration:</strong> {ICO_REG}</li>
            </ul>
          </section>

          <div className="pt-8 border-t border-gray-200 dark:border-gray-700 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms &amp; Conditions</Link>
            <Link href="/cookies" className="hover:text-foreground transition-colors">Cookie Policy</Link>
            <Link href="/" className="hover:text-foreground transition-colors">Back to dashboard</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
