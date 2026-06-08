import { Link } from "wouter";
import { Cookie, ArrowLeft } from "lucide-react";

export default function CookiePolicy() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-6 py-12">

        <div className="flex items-center gap-3 mb-8">
          <Cookie className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Cookie Policy</h1>
            <p className="text-muted-foreground text-sm mt-1">Care Capacity Dashboard</p>
          </div>
        </div>

        <div className="bg-muted/40 border rounded-lg p-4 mb-8 text-sm text-muted-foreground">
          <strong>Effective Date:</strong> 8 June 2026 &nbsp;|&nbsp; <strong>Last Updated:</strong> 8 June 2026 &nbsp;|&nbsp; <strong>Version:</strong> v1.0 &middot; 8 June 2026
        </div>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-8">

          <section>
            <h2 className="text-xl font-semibold mb-3">1. Introduction</h2>
            <p className="text-sm">This Cookie Policy explains how the Care Capacity Dashboard (the &ldquo;Service&rdquo;), operated by SUR Group, uses cookies and similar technologies when you access the platform. This policy should be read alongside our{" "}
              <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
            </p>
            <p className="mt-2 text-sm">This policy complies with the Privacy and Electronic Communications Regulations 2003 (PECR) and the UK General Data Protection Regulation (UK GDPR).</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">2. What Are Cookies?</h2>
            <p className="text-sm">Cookies are small text files that are placed on your device (computer, tablet or mobile phone) when you visit a website or use a web application. They are widely used to make services work, to maintain your session, and to provide diagnostic information to service operators.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">3. Cookies We Use</h2>
            <p className="text-sm mb-4">The Service uses <strong>only strictly necessary cookies</strong>. We do not use any marketing, advertising, analytics, social media or preference cookies.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse border border-border">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="border border-border px-3 py-2 text-left font-semibold">Cookie Name</th>
                    <th className="border border-border px-3 py-2 text-left font-semibold">Provider</th>
                    <th className="border border-border px-3 py-2 text-left font-semibold">Type</th>
                    <th className="border border-border px-3 py-2 text-left font-semibold">Purpose</th>
                    <th className="border border-border px-3 py-2 text-left font-semibold">Duration</th>
                    <th className="border border-border px-3 py-2 text-left font-semibold">Category</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-border px-3 py-2 font-mono font-medium">connect.sid</td>
                    <td className="border border-border px-3 py-2">Care Capacity Dashboard (first-party)</td>
                    <td className="border border-border px-3 py-2">HTTP cookie</td>
                    <td className="border border-border px-3 py-2">Session management — maintains your authenticated login state, RBAC role and branch context across page requests. Without this cookie, you cannot log in.</td>
                    <td className="border border-border px-3 py-2">Session (deleted when browser closes or session expires)</td>
                    <td className="border border-border px-3 py-2">Strictly Necessary</td>
                  </tr>
                  <tr className="bg-muted/20">
                    <td className="border border-border px-3 py-2 font-mono font-medium">_sentry-environment</td>
                    <td className="border border-border px-3 py-2">Sentry (third-party)</td>
                    <td className="border border-border px-3 py-2">HTTP cookie</td>
                    <td className="border border-border px-3 py-2">Identifies the deployment environment for error grouping and diagnosis</td>
                    <td className="border border-border px-3 py-2">Session</td>
                    <td className="border border-border px-3 py-2">Strictly Necessary</td>
                  </tr>
                  <tr>
                    <td className="border border-border px-3 py-2 font-mono font-medium">_sentry-session</td>
                    <td className="border border-border px-3 py-2">Sentry (third-party)</td>
                    <td className="border border-border px-3 py-2">HTTP cookie</td>
                    <td className="border border-border px-3 py-2">Tracks application session for error grouping, crash reporting and performance monitoring</td>
                    <td className="border border-border px-3 py-2">Session</td>
                    <td className="border border-border px-3 py-2">Strictly Necessary</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. Legal Basis (UK PECR)</h2>
            <p className="text-sm">Under the Privacy and Electronic Communications Regulations 2003 (PECR), strictly necessary cookies do not require user consent. They are essential for the Service to function and cannot be switched off without breaking core functionality.</p>
            <p className="mt-3 text-sm">The cookies listed above are classified as strictly necessary because:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-sm">
              <li><strong>connect.sid</strong> is required to maintain your authenticated session — without it, you cannot log in or navigate the Service</li>
              <li><strong>Sentry cookies</strong> are required to monitor errors and maintain platform stability — without them, we cannot identify and resolve issues that affect your experience</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">5. Cookies We Do NOT Use</h2>
            <p className="text-sm mb-2">For the avoidance of doubt, the Service does not use:</p>
            <ul className="list-disc pl-6 space-y-1 text-sm">
              <li>Marketing or advertising cookies</li>
              <li>Analytics cookies (such as Google Analytics, Mixpanel, Hotjar or similar)</li>
              <li>Social media tracking cookies (Facebook, Twitter/X, LinkedIn, etc.)</li>
              <li>Cross-site tracking cookies</li>
              <li>Profiling or behavioural targeting cookies</li>
              <li>Preference or functionality cookies beyond session authentication</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">6. Cookie Consent</h2>
            <p className="text-sm">Because the Service uses only strictly necessary cookies, we are not required to obtain your prior consent under UK PECR. These cookies are set automatically when you access the Service and are essential for its operation.</p>
            <p className="mt-2 text-sm">If we introduce any non-essential cookies in the future, we will update this Cookie Policy and implement an appropriate consent mechanism (cookie banner with opt-in/opt-out controls) before deploying them.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">7. How to Manage Cookies</h2>
            <p className="text-sm">You can manage or delete cookies through your browser settings. However, please be aware that blocking or deleting strictly necessary cookies will prevent the Service from functioning correctly — specifically, you will not be able to log in or maintain an authenticated session.</p>
            <p className="mt-3 text-sm font-medium">Instructions for managing cookies in common browsers:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-sm">
              <li><strong>Google Chrome:</strong> Settings &gt; Privacy and Security &gt; Cookies and other site data</li>
              <li><strong>Mozilla Firefox:</strong> Settings &gt; Privacy &amp; Security &gt; Cookies and Site Data</li>
              <li><strong>Microsoft Edge:</strong> Settings &gt; Cookies and site permissions &gt; Manage and delete cookies and site data</li>
              <li><strong>Safari:</strong> Preferences &gt; Privacy &gt; Manage Website Data</li>
              <li>For other browsers, consult your browser&rsquo;s help documentation</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">8. Third-Party Cookies</h2>
            <p className="text-sm">Sentry (Functional Software Inc.), our error monitoring provider, may set cookies or use similar technologies to track errors, crashes and performance within the Service. Sentry processes limited technical data (IP address, browser information, error stack traces) and does not use this data for marketing or advertising purposes.</p>
            <p className="mt-2 text-sm">Sentry&rsquo;s privacy policy:{" "}
              <a href="https://sentry.io/privacy/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                https://sentry.io/privacy/
              </a>
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">9. Changes to This Policy</h2>
            <p className="text-sm">We may update this Cookie Policy from time to time. Any changes will be posted within the Service with an updated &ldquo;Last Updated&rdquo; date. We encourage you to review this policy periodically.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">10. Contact Us</h2>
            <p className="text-sm">If you have any questions about this Cookie Policy or our use of cookies:</p>
            <div className="bg-muted/30 border rounded p-4 mt-3 text-sm">
              <strong>Mustansar Hussain</strong><br />
              Data Protection Contact, SUR Group<br />
              18 Seaward Place, Kinning Park, Glasgow G41 1HH<br />
              <strong>Email:</strong>{" "}
              <a href="mailto:mustansar.hussain@sg.homeinstead.co.uk" className="text-primary hover:underline">
                mustansar.hussain@sg.homeinstead.co.uk
              </a>
            </div>
          </section>

        </div>

        <footer className="mt-16 pt-8 border-t text-center text-sm text-muted-foreground space-y-2">
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
            <Link href="/privacy" className="hover:text-foreground hover:underline">Privacy Policy</Link>
            <span>&middot;</span>
            <Link href="/terms" className="hover:text-foreground hover:underline">Terms &amp; Conditions</Link>
            <span>&middot;</span>
            <Link href="/cookies" className="font-medium text-foreground">Cookie Policy</Link>
            <span>&middot;</span>
            <Link href="/" className="hover:text-foreground hover:underline inline-flex items-center gap-1">
              <ArrowLeft className="h-3 w-3" />Back to Dashboard
            </Link>
          </div>
          <p>&copy; {new Date().getFullYear()} SUR Group (Scotland) Ltd t/a Home Instead. All rights reserved.</p>
        </footer>
      </div>
    </div>
  );
}
