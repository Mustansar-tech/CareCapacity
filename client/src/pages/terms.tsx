import { Link } from "wouter";
import { FileText, ArrowLeft } from "lucide-react";

const COMPANY_NAME = "SUR Group (Scotland) Ltd t/a Home Instead";
const SUPPORT_EMAIL = "operations@sur-group.co.uk";
const EFFECTIVE_DATE = "8 June 2026";
const VERSION = "1.0";

export default function Terms() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-emerald-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to dashboard
        </Link>

        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center shadow-lg">
            <FileText className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Terms &amp; Conditions</h1>
            <p className="text-sm text-muted-foreground">Version {VERSION} · Effective {EFFECTIVE_DATE}</p>
          </div>
        </div>

        <div className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed space-y-8">

          <p>
            These Terms &amp; Conditions ("Terms") govern your use of the Care Capacity Dashboard
            ("the System"), operated by <strong>{COMPANY_NAME}</strong> ("we", "us", "our"), a company
            registered in Scotland. By accessing or using the System, you agree to be bound by these Terms.
          </p>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">1. Permitted use</h2>
            <p>
              The System is an internal business tool provided exclusively for use by authorised employees and
              contractors of {COMPANY_NAME}. You may use the System only for legitimate workforce planning and
              care scheduling purposes within your authorised branch(es).
            </p>
            <p className="mt-2">You agree that you will not:</p>
            <ul className="list-disc list-inside space-y-1 pl-2 mt-2">
              <li>Share your login credentials with any other person</li>
              <li>Access the accounts or data of other users</li>
              <li>Attempt to access branches or data you have not been assigned to</li>
              <li>Use the System to process data for any purpose outside care delivery planning</li>
              <li>Export, reproduce, or distribute personal data obtained from the System outside of authorised workflows</li>
              <li>Attempt to reverse-engineer, decompile, or circumvent any security measures</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">2. Scheduling outputs and disclaimer of warranty</h2>
            <p>
              The System generates scheduling recommendations, capacity analyses, and route optimisations to assist
              human decision-making. <strong>These outputs are advisory only.</strong> They do not constitute a
              guaranteed care plan or a statement of legal or clinical compliance.
            </p>
            <p className="mt-2">
              You, as an authorised user, are responsible for reviewing all scheduling outputs, exercising professional
              judgement, and making final care delivery decisions. The System does not account for all factors relevant
              to safe care delivery, including but not limited to:
            </p>
            <ul className="list-disc list-inside space-y-1 pl-2 mt-2">
              <li>Individual client health or risk assessments</li>
              <li>Specific contractual obligations with clients or commissioners</li>
              <li>Real-time traffic or safety conditions</li>
              <li>Regulatory requirements specific to your branch or service type</li>
            </ul>
            <p className="mt-2">
              We provide the System "as is" and make no warranty, express or implied, as to the accuracy, fitness for
              purpose, or completeness of any scheduling outputs.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">3. Data responsibility</h2>
            <p>
              {COMPANY_NAME} is the data controller for all personal data processed through the System.
              As a user, you are responsible for:
            </p>
            <ul className="list-disc list-inside space-y-1 pl-2 mt-2">
              <li>Uploading only data you are authorised to process</li>
              <li>Ensuring the accuracy of data you enter or upload</li>
              <li>Handling any exported or downloaded data in accordance with our data protection policies and UK GDPR obligations</li>
              <li>Reporting any suspected data breach or unauthorised access to your manager and our Data Protection Lead immediately</li>
            </ul>
            <p className="mt-2">
              Personal data visible within the System must not be photographed, screenshotted and shared externally,
              or otherwise exfiltrated except through the System's authorised export mechanisms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">4. Access and account management</h2>
            <p>
              User accounts are created and managed by administrators of {COMPANY_NAME}. Your access is tied to your
              employment or contracted relationship with the organisation.
            </p>
            <p className="mt-2">
              We may suspend or revoke your access at any time, without notice, if we have reason to believe
              these Terms have been violated, if your employment or contract ends, or if required for security reasons.
            </p>
            <p className="mt-2">
              You are responsible for keeping your password secure. If you suspect your account has been compromised,
              contact an administrator or{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-blue-600 dark:text-blue-400 hover:underline">{SUPPORT_EMAIL}</a>{" "}
              immediately.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">5. Limitation of liability</h2>
            <p>
              To the maximum extent permitted by law, {COMPANY_NAME} shall not be liable for any loss or damage arising
              from your reliance on scheduling outputs, including missed visits, adverse care events, or regulatory
              non-compliance, where such reliance was not reviewed and authorised by a qualified care coordinator.
            </p>
            <p className="mt-2">
              Nothing in these Terms excludes liability for death or personal injury caused by negligence, fraud, or any
              other matter that cannot be excluded by law.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">6. Intellectual property</h2>
            <p>
              The System and all associated software, documentation, and content are the intellectual property of{" "}
              {COMPANY_NAME} or its licensors. You are granted a limited, non-exclusive, non-transferable licence
              to use the System solely for the purposes described in these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">7. Audit and monitoring</h2>
            <p>
              For security and compliance purposes, the System logs all login events, legal consent acceptances,
              data uploads, and administrative actions. These logs may be reviewed by authorised administrators
              and may be used in any investigation of suspected misuse or breach. Use of the System constitutes
              consent to this monitoring.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">8. Changes to these Terms</h2>
            <p>
              We may update these Terms from time to time. Material changes will be communicated via in-app notice
              requiring re-acceptance before continued use. The version number and effective date at the top of this
              page indicate when the Terms were last revised.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">9. Governing law</h2>
            <p>
              These Terms are governed by the laws of Scotland. Any disputes arising under these Terms shall
              be subject to the exclusive jurisdiction of the Scottish courts.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">10. Contact</h2>
            <p>
              Questions about these Terms should be directed to{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-blue-600 dark:text-blue-400 hover:underline">{SUPPORT_EMAIL}</a>{" "}
              or your branch administrator.
            </p>
          </section>

          <div className="pt-8 border-t border-gray-200 dark:border-gray-700 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
            <Link href="/cookies" className="hover:text-foreground transition-colors">Cookie Policy</Link>
            <Link href="/" className="hover:text-foreground transition-colors">Back to dashboard</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
