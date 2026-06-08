import { Link } from "wouter";
import { Cookie, ArrowLeft } from "lucide-react";

const COMPANY_NAME = "SUR Group (Scotland) Ltd t/a Home Instead";
const SUPPORT_EMAIL = "operations@sur-group.co.uk";
const EFFECTIVE_DATE = "8 June 2026";
const VERSION = "1.0";

export default function CookiePolicy() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-emerald-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to dashboard
        </Link>

        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg">
            <Cookie className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Cookie Policy</h1>
            <p className="text-sm text-muted-foreground">Version {VERSION} · Effective {EFFECTIVE_DATE}</p>
          </div>
        </div>

        <div className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed space-y-8">

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">1. What are cookies?</h2>
            <p>
              Cookies are small text files placed on your device by a website when you visit it. They are widely used
              to make websites work, remember your preferences, and provide information to website owners.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">2. How we use cookies</h2>
            <p>
              The Care Capacity Dashboard, operated by <strong>{COMPANY_NAME}</strong>, uses the minimum number of
              cookies necessary for the System to function. We do not use analytics cookies, advertising cookies,
              or any third-party tracking cookies.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">3. Cookies we set</h2>

            <div className="overflow-x-auto mt-3">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-100 dark:bg-gray-800">
                    <th className="text-left p-3 font-semibold text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700">Name</th>
                    <th className="text-left p-3 font-semibold text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700">Type</th>
                    <th className="text-left p-3 font-semibold text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700">Purpose</th>
                    <th className="text-left p-3 font-semibold text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700">Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-white dark:bg-gray-900">
                    <td className="p-3 border border-gray-200 dark:border-gray-700">
                      <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">connect.sid</code>
                    </td>
                    <td className="p-3 border border-gray-200 dark:border-gray-700">Strictly necessary</td>
                    <td className="p-3 border border-gray-200 dark:border-gray-700">
                      Maintains your authenticated session so you stay signed in while using the System.
                      Without this cookie the System cannot function.
                    </td>
                    <td className="p-3 border border-gray-200 dark:border-gray-700">
                      Session (deleted on sign-out) or 30 minutes of inactivity
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="mt-4">
              This cookie is classified as <strong>strictly necessary</strong> under the Privacy and Electronic
              Communications Regulations (PECR). Because it is essential for the System to operate, it does not
              require your consent.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">4. What we do not use</h2>
            <p>We do not use any of the following:</p>
            <ul className="list-disc list-inside space-y-1 pl-2 mt-2">
              <li>Analytics cookies (e.g. Google Analytics, Hotjar)</li>
              <li>Advertising or targeting cookies</li>
              <li>Social media tracking pixels</li>
              <li>Third-party cookies of any kind</li>
              <li>Persistent cookies beyond your authenticated session</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">5. Cookie security</h2>
            <p>
              The session cookie is set with the following security attributes to protect your session:
            </p>
            <ul className="list-disc list-inside space-y-1 pl-2 mt-2">
              <li><strong>HttpOnly:</strong> the cookie cannot be accessed by JavaScript, protecting against cross-site scripting (XSS) attacks.</li>
              <li><strong>Secure:</strong> the cookie is only transmitted over HTTPS, never over plain HTTP.</li>
              <li><strong>SameSite: Lax:</strong> the cookie is not sent with cross-site requests, protecting against cross-site request forgery (CSRF).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">6. Managing cookies</h2>
            <p>
              Because the session cookie is strictly necessary, blocking it will prevent the System from functioning.
              If you wish to remove it, you can sign out of the System — this will instruct your browser to delete
              the session cookie — or clear your browser's cookies manually.
            </p>
            <p className="mt-2">
              Instructions for managing cookies in common browsers:
            </p>
            <ul className="list-disc list-inside space-y-1 pl-2 mt-1">
              <li><a href="https://support.google.com/chrome/answer/95647" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">Google Chrome</a></li>
              <li><a href="https://support.mozilla.org/en-US/kb/cookies-information-websites-store-on-your-computer" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">Mozilla Firefox</a></li>
              <li><a href="https://support.apple.com/en-gb/guide/safari/sfri11471/mac" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">Apple Safari</a></li>
              <li><a href="https://support.microsoft.com/en-us/microsoft-edge/delete-cookies-in-microsoft-edge-63947406-40ac-c3b8-57b9-2a946a29ae09" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">Microsoft Edge</a></li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">7. Changes to this policy</h2>
            <p>
              We may update this Cookie Policy from time to time. If we introduce new cookies that are not strictly
              necessary, we will update this policy and seek your consent before setting them. The version number
              and effective date at the top of this page indicate when the policy was last revised.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">8. Contact us</h2>
            <p>
              For any questions about our use of cookies, contact:{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-blue-600 dark:text-blue-400 hover:underline">{SUPPORT_EMAIL}</a>
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {COMPANY_NAME} is registered with the Information Commissioner's Office (ICO) under registration number ZA278994.
            </p>
          </section>

          <div className="pt-8 border-t border-gray-200 dark:border-gray-700 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms &amp; Conditions</Link>
            <Link href="/" className="hover:text-foreground transition-colors">Back to dashboard</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
