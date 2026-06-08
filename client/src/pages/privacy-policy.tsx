import { Link } from "wouter";
import { Shield, ArrowLeft } from "lucide-react";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-6 py-12">

        <div className="flex items-center gap-3 mb-8">
          <Shield className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Privacy Policy</h1>
            <p className="text-muted-foreground text-sm mt-1">Care Capacity Dashboard</p>
          </div>
        </div>

        <div className="bg-muted/40 border rounded-lg p-4 mb-8 text-sm text-muted-foreground">
          <strong>Effective Date:</strong> 8 June 2026 &nbsp;|&nbsp; <strong>Last Updated:</strong> 8 June 2026 &nbsp;|&nbsp; <strong>Version:</strong> v1.0 &middot; 8 June 2026
        </div>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-8">

          <section>
            <h2 className="text-xl font-semibold mb-3">1. Introduction</h2>
            <p>This Privacy Policy explains how SUR Group (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) collects, uses, stores, shares and protects personal data when you use the Care Capacity Dashboard (the &ldquo;Service&rdquo;). The Service is an intelligent workforce capacity analysis platform for optimal care scheduling and resource management, operated internally for Home Instead franchise branches.</p>
            <p className="mt-3">We are committed to protecting your privacy in accordance with:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>The UK General Data Protection Regulation (UK GDPR)</li>
              <li>The Data Protection Act 2018</li>
              <li>The Privacy and Electronic Communications Regulations 2003 (PECR)</li>
              <li>The California Consumer Privacy Act as amended by the California Privacy Rights Act (CCPA/CPRA)</li>
              <li>The California Online Privacy Protection Act (CalOPPA)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">2. Data Controller and ICO Registration</h2>
            <p>The data controller responsible for your personal data processed through the Care Capacity Dashboard is:</p>
            <div className="bg-muted/30 border rounded p-4 mt-3 text-sm">
              <strong>SUR Group</strong><br />
              18 Seaward Place, Kinning Park, Glasgow G41 1HH<br />
              United Kingdom<br />
              <strong>Data Protection Contact:</strong> Mustansar Hussain<br />
              <strong>Email:</strong>{" "}
              <a href="mailto:mustansar.hussain@sg.homeinstead.co.uk" className="text-primary hover:underline">
                mustansar.hussain@sg.homeinstead.co.uk
              </a>
            </div>
            <p className="mt-3 text-sm">
              <strong>ICO Registration:</strong> SUR Group is registered with the Information Commissioner&rsquo;s Office (ICO) as a Data Controller. Registration number: [TO BE CONFIRMED]. Registration is a legal requirement under the Data Protection Act 2018 for organisations that process personal data.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">3. Data Sources</h2>
            <p>The Service obtains data from the following sources:</p>

            <h3 className="text-base font-semibold mt-4 mb-2">3.1 Direct Input</h3>
            <p className="text-sm">You provide personal data directly when you create an account and log in to the Service (email address, password).</p>

            <h3 className="text-base font-semibold mt-4 mb-2">3.2 Access People Planner (Access UK Ltd)</h3>
            <p className="text-sm">The Service obtains employee and client scheduling data from Access People Planner, a product of Access UK Ltd (company registration 2343760), part of The Access Group.</p>
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded p-4 mt-3 text-sm">
              <strong>Important — Controller-to-Controller Relationship:</strong> Access UK Ltd is an independent data controller for personal data processed within their products, including People Planner. When we extract data from People Planner via automated report downloads or manual Excel file uploads, SUR Group becomes a separate and independent data controller for that data. We process the extracted data for our own purposes: workforce capacity analysis and scheduling optimisation as described in this Privacy Policy.
              <br /><br />
              This creates a controller-to-controller relationship. We do not process data on behalf of Access UK Ltd, and they do not process data on behalf of SUR Group. Each party is independently responsible for its own compliance with data protection law.
              <br /><br />
              Access UK Ltd&rsquo;s Privacy Notice:{" "}
              <a href="https://www.theaccessgroup.com/en-gb/privacy-notice/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                https://www.theaccessgroup.com/en-gb/privacy-notice/
              </a><br />
              Access UK Ltd&rsquo;s Global Data Protection Officer: Danielle Hefford<br />
              Access UK Ltd&rsquo;s registered address: The Armstrong Building, 10 Oakwood Drive, Loughborough, LE11 3QF, United Kingdom
            </div>

            <h3 className="text-base font-semibold mt-4 mb-2">3.3 Care Copilot (Where Applicable)</h3>
            <p className="text-sm">Where your branch uses Care Copilot for AI-powered care log summaries, the Service may process data that originated from or is related to Care Copilot outputs. Care Copilot Ltd is an independent data controller for data processed within their platform.</p>
            <p className="mt-2 text-sm">
              Care Copilot Ltd&rsquo;s Privacy Notice:{" "}
              <a href="https://www.carecopilot.uk" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">https://www.carecopilot.uk</a>
              {" "}&nbsp;|&nbsp; ICO Registration: ZB817150 &nbsp;|&nbsp; Contact:{" "}
              <a href="mailto:mike@carecopilot.uk" className="text-primary hover:underline">mike@carecopilot.uk</a>
            </p>

            <h3 className="text-base font-semibold mt-4 mb-2">3.4 Automatic Collection</h3>
            <p className="text-sm">The Service automatically collects certain technical data when you access and use the platform (see Section 4.4).</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. Personal Data We Collect</h2>

            <h3 className="text-base font-semibold mt-4 mb-2">4.1 Account Data (Provided by You)</h3>
            <ul className="list-disc pl-6 space-y-1 text-sm">
              <li>Email address (used for login and authentication)</li>
              <li>Password (hashed using bcrypt — never stored in plain text)</li>
              <li>Full name and organisational role</li>
              <li>Branch assignment(s)</li>
            </ul>

            <h3 className="text-base font-semibold mt-4 mb-2">4.2 Employee / Care Professional Data (From People Planner)</h3>
            <p className="text-sm mb-2">Authorised users upload or automatically extract workforce data from Access People Planner. This data may include:</p>
            <ul className="list-disc pl-6 space-y-1 text-sm">
              <li>Employee full names</li>
              <li>Home postcodes (not full home addresses)</li>
              <li>Gender</li>
              <li>Transport mode (car, walking, public transport)</li>
              <li>Contracted hours and pay hours</li>
              <li>Availability and unavailability records (including leave types: holiday, sick, maternity/paternity, compassionate leave, AWOL, jury service, etc.)</li>
              <li>Employment status and GH (Guaranteed Hours) annotations</li>
            </ul>

            <h3 className="text-base font-semibold mt-4 mb-2">4.3 Client Data (From People Planner)</h3>
            <p className="text-sm mb-2">Client scheduling data extracted from People Planner may include:</p>
            <ul className="list-disc pl-6 space-y-1 text-sm">
              <li>Client full names</li>
              <li>Client addresses (used for geocoding and travel time calculations)</li>
              <li>Care visit schedules (times, durations, service types)</li>
              <li>Cancellation records and cancellation descriptions</li>
            </ul>

            <h3 className="text-base font-semibold mt-4 mb-2">4.4 Data Collected Automatically</h3>
            <ul className="list-disc pl-6 space-y-1 text-sm">
              <li>IP address</li>
              <li>Browser type and version</li>
              <li>Device information and operating system</li>
              <li>Session identifiers (via connect.sid cookie)</li>
              <li>Error stack traces and performance data (via Sentry)</li>
              <li>Pages visited and actions taken within the Service</li>
              <li>Timestamp and frequency of access</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">5. How We Use Your Data</h2>
            <p className="mb-4 text-sm">We process personal data for the following purposes:</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse border border-border">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="border border-border px-3 py-2 text-left font-semibold">Purpose</th>
                    <th className="border border-border px-3 py-2 text-left font-semibold">Data Used</th>
                    <th className="border border-border px-3 py-2 text-left font-semibold">Lawful Basis (UK GDPR)</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Account authentication and session management", "Email, password hash, name, role, branch ID", "Legitimate interest (Art. 6(1)(f)) — secure access"],
                    ["Role-based access control (RBAC) and branch isolation", "User role, branch assignment", "Legitimate interest (Art. 6(1)(f)) — data security"],
                    ["Workforce capacity analysis and utilisation reporting", "Employee names, hours, availability, visit data", "Legitimate interest (Art. 6(1)(f)) — operational efficiency"],
                    ["Automated scheduling optimisation (VRPTW engine)", "Employee and client data, visit requirements, travel times", "Legitimate interest (Art. 6(1)(f)) — operational efficiency"],
                    ["Travel time and route calculations", "Employee postcodes, client addresses, transport modes", "Legitimate interest (Art. 6(1)(f)) — scheduling accuracy"],
                    ["Postcode geocoding", "UK postcodes only (no names or personal identifiers)", "Legitimate interest (Art. 6(1)(f))"],
                    ["Error monitoring and platform stability", "IP address, browser data, error stack traces", "Legitimate interest (Art. 6(1)(f)) — service reliability"],
                    ["Transactional emails (reports, password resets)", "Email address, email content", "Performance of contract (Art. 6(1)(b))"],
                    ["Security monitoring, audit logging and fraud prevention", "IP address, session data, login records, audit trail", "Legitimate interest (Art. 6(1)(f)) — security"],
                    ["Compliance with legal obligations", "As required by law", "Legal obligation (Art. 6(1)(c))"],
                  ].map(([purpose, data, basis], i) => (
                    <tr key={i} className={i % 2 === 0 ? "" : "bg-muted/20"}>
                      <td className="border border-border px-3 py-2">{purpose}</td>
                      <td className="border border-border px-3 py-2">{data}</td>
                      <td className="border border-border px-3 py-2">{basis}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded p-4 mt-4 text-sm">
              <strong>No-Training Commitment:</strong> We will not use your data to train, develop or improve machine learning models, artificial intelligence systems, or any other products or services. Your data is processed solely for the purpose of delivering the Service to you.
            </div>
            <p className="mt-3 text-sm text-muted-foreground">We do <strong>NOT</strong> use your personal data for: marketing or advertising; profiling or automated decision-making with legal effects; selling, renting or trading to third parties; or training AI/ML models.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">6. Data Sharing and Sub-Processors</h2>
            <p className="mb-4 text-sm">We do not sell, rent or trade your personal data. We share data only with trusted third parties who are necessary to deliver the Service:</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse border border-border">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="border border-border px-3 py-2 text-left font-semibold">Sub-Processor</th>
                    <th className="border border-border px-3 py-2 text-left font-semibold">Purpose</th>
                    <th className="border border-border px-3 py-2 text-left font-semibold">Data Shared</th>
                    <th className="border border-border px-3 py-2 text-left font-semibold">Location</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Access UK Ltd (The Access Group)", "Source system — People Planner provides employee and client scheduling data via automated report exports and manual Excel uploads", "Employee names, contracted hours, availability, client visit schedules, cancellations", "UK"],
                    ["Care Copilot Ltd (where applicable)", "AI-powered care log summaries — only where your branch actively uses Care Copilot", "Care log content and visit notes", "UK"],
                    ["Neon (Neon Tech Inc.)", "Serverless PostgreSQL database hosting", "All application data (encrypted at rest and in transit)", "EU / US"],
                    ["Sentry (Functional Software Inc.)", "Error tracking and performance monitoring", "IP addresses, browser metadata, error stack traces, session identifiers", "US"],
                    ["Resend (Resend Inc.)", "Transactional email delivery (reports, password resets)", "Email addresses, email content", "US"],
                    ["OpenRouteService (HeiGIT gGmbH)", "Car travel time and distance matrix calculations", "Geocoded coordinates derived from postcodes (no names or personal identifiers)", "Germany (EU)"],
                    ["TravelTime (iGeolise Ltd)", "Walking and public transport travel time calculations", "Geocoded coordinates derived from postcodes (no names or personal identifiers)", "UK"],
                    ["postcodes.io (Ideal Postcodes)", "UK postcode-to-coordinate geocoding (including terminated postcode fallback)", "UK postcodes only (no personal identifiers)", "UK"],
                    ["Replit (Replit Inc.)", "Application hosting and deployment platform", "All application data in transit and during processing", "US"],
                  ].map(([sp, purpose, data, location], i) => (
                    <tr key={i} className={i % 2 === 0 ? "" : "bg-muted/20"}>
                      <td className="border border-border px-3 py-2 font-medium">{sp}</td>
                      <td className="border border-border px-3 py-2">{purpose}</td>
                      <td className="border border-border px-3 py-2">{data}</td>
                      <td className="border border-border px-3 py-2">{location}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-muted-foreground"><em>Note regarding Access UK Ltd and Care Copilot Ltd: These are listed as data sources rather than traditional sub-processors. They are independent data controllers. We receive data from their systems and process it independently under our own controllership.</em></p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">7. International Data Transfers</h2>
            <p className="text-sm">Some of our sub-processors are located outside the United Kingdom, primarily in the United States and the European Union. Where personal data is transferred outside the UK, we ensure appropriate safeguards are in place, including:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-sm">
              <li>UK International Data Transfer Agreement (IDTA) or Addendum to EU Standard Contractual Clauses (SCCs)</li>
              <li>The sub-processor&rsquo;s participation in recognised data protection frameworks (e.g., EU-US Data Privacy Framework)</li>
              <li>Technical measures including encryption in transit (TLS 1.2+) and encryption at rest (AES-256)</li>
            </ul>
            <p className="mt-3 text-sm">We regularly review our sub-processors&rsquo; data protection practices and transfer mechanisms to ensure ongoing compliance.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">8. Data Retention</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse border border-border">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="border border-border px-3 py-2 text-left font-semibold">Data Category</th>
                    <th className="border border-border px-3 py-2 text-left font-semibold">Retention Period</th>
                    <th className="border border-border px-3 py-2 text-left font-semibold">Basis</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["User accounts (email, name, role)", "Duration of active account + 12 months after deletion", "Contractual / operational necessity"],
                    ["Employee and client scheduling data (uploaded/extracted)", "Duration of active branch subscription + 90 days", "Operational necessity"],
                    ["Weekly capacity snapshots", "Retained for historical comparison; overwritten when same week is re-uploaded", "Legitimate interest — trend analysis"],
                    ["Audit logs (login, user actions)", "12 months", "Security and compliance"],
                    ["Session data (connect.sid)", "Duration of authenticated session", "Strictly necessary"],
                    ["Error tracking data (Sentry)", "90 days", "Platform stability"],
                    ["Email delivery logs (Resend)", "30 days", "Operational monitoring"],
                    ["Travel time calculations", "Session cache only — not persisted to database", "N/A"],
                    ["People Planner automation session data", "Deleted immediately after report download completes", "Data minimisation"],
                  ].map(([cat, period, basis], i) => (
                    <tr key={i} className={i % 2 === 0 ? "" : "bg-muted/20"}>
                      <td className="border border-border px-3 py-2">{cat}</td>
                      <td className="border border-border px-3 py-2">{period}</td>
                      <td className="border border-border px-3 py-2">{basis}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm">When data is no longer required, it is securely deleted or anonymised. Upon termination of access, we will delete all your data from our systems within 30 days, unless we are legally required to retain it.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">9. Data Security</h2>
            <p className="text-sm mb-2">We implement appropriate technical and organisational measures to protect your personal data:</p>
            <ul className="list-disc pl-6 space-y-1 text-sm">
              <li>Passwords hashed using bcrypt with salting (never stored in plain text)</li>
              <li>Session management via express-session with secure, httpOnly, sameSite cookies</li>
              <li>Role-Based Access Control (RBAC): four-tier model (Admin &gt; Manager &gt; Supervisor &gt; Viewer)</li>
              <li>Branch isolation: every database query is scoped to the authenticated user&rsquo;s branchId — no cross-branch data access is possible</li>
              <li>Encryption in transit: all connections via HTTPS/TLS 1.2+</li>
              <li>Database encryption at rest via Neon&rsquo;s managed encryption</li>
              <li>Input validation via Zod schemas; SQL injection prevention via Drizzle ORM parameterised queries</li>
              <li>Audit logging: admin actions (user creation, role changes, data uploads) are logged with timestamp, user ID and action</li>
              <li>People Planner automation credentials stored in environment secrets (Replit Secrets), never in source code</li>
              <li>Incident response: suspected security incidents are investigated promptly and affected users notified in accordance with UK GDPR breach notification requirements (72-hour ICO notification where required)</li>
              <li>Periodic security reviews: security measures and access controls are reviewed regularly and updated as necessary</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">10. Your Rights Under UK GDPR</h2>
            <p className="text-sm mb-2">Under the UK GDPR, you have the following rights in relation to your personal data:</p>
            <ul className="list-disc pl-6 space-y-1 text-sm">
              <li><strong>Right of access (Article 15)</strong> — request a copy of the personal data we hold about you</li>
              <li><strong>Right to rectification (Article 16)</strong> — request correction of inaccurate or incomplete data</li>
              <li><strong>Right to erasure (Article 17)</strong> — request deletion of your personal data (&ldquo;right to be forgotten&rdquo;)</li>
              <li><strong>Right to restriction of processing (Article 18)</strong> — request that we limit how we process your data</li>
              <li><strong>Right to data portability (Article 20)</strong> — receive your data in a structured, machine-readable format</li>
              <li><strong>Right to object (Article 21)</strong> — object to processing based on legitimate interests</li>
              <li><strong>Right to withdraw consent</strong> — where processing is based on consent, withdraw at any time without affecting the lawfulness of prior processing</li>
              <li><strong>Rights related to automated decision-making (Article 22)</strong> — the Service does not currently make automated decisions with legal or similarly significant effects on individuals</li>
            </ul>

            <h3 className="text-base font-semibold mt-5 mb-2">10.1 How to Exercise Your Rights (Subject Access Requests)</h3>
            <p className="text-sm">To exercise any of your data protection rights, including submitting a Subject Access Request (SAR), contact us at:{" "}
              <a href="mailto:mustansar.hussain@sg.homeinstead.co.uk" className="text-primary hover:underline">mustansar.hussain@sg.homeinstead.co.uk</a>
            </p>
            <p className="mt-2 text-sm">We will acknowledge your request within 5 working days and provide a substantive response within one calendar month. In complex cases, we may extend this by up to two further months and will inform you if this is necessary. We will not charge a fee for responding to your request unless the request is manifestly unfounded or excessive.</p>

            <h3 className="text-base font-semibold mt-5 mb-2">10.2 Right to Complain</h3>
            <p className="text-sm">If you are not satisfied with our response, you have the right to lodge a complaint with the Information Commissioner&rsquo;s Office (ICO):</p>
            <ul className="list-none pl-0 mt-2 space-y-1 text-sm">
              <li><strong>Website:</strong>{" "}<a href="https://ico.org.uk" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">https://ico.org.uk</a></li>
              <li><strong>Telephone:</strong> 0303 123 1113</li>
              <li><strong>Address:</strong> Wycliffe House, Water Lane, Wilmslow, Cheshire SK9 5AF</li>
            </ul>
            <p className="mt-2 text-sm">We would appreciate the opportunity to address your concerns before you contact the ICO.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">11. California Residents — CCPA/CPRA Rights</h2>
            <p className="text-sm mb-3">If you are a California resident, you have additional rights under the California Consumer Privacy Act (CCPA) as amended by the California Privacy Rights Act (CPRA):</p>
            <ul className="list-disc pl-6 space-y-1 text-sm">
              <li><strong>Right to Know</strong> — request disclosure of the categories and specific pieces of personal information we collect about you</li>
              <li><strong>Right to Delete</strong> — request deletion of your personal information, subject to certain exceptions</li>
              <li><strong>Right to Correct</strong> — request correction of inaccurate personal information</li>
              <li><strong>Right to Opt-Out of Sale or Sharing</strong> — we do NOT sell or share your personal information for cross-context behavioural advertising</li>
              <li><strong>Right to Non-Discrimination</strong> — we will not discriminate against you for exercising your CCPA/CPRA rights</li>
            </ul>
            <p className="mt-4 mb-2 text-sm font-medium">Categories of personal information collected (CCPA disclosure):</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse border border-border">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="border border-border px-3 py-2 text-left font-semibold">CCPA Category</th>
                    <th className="border border-border px-3 py-2 text-left font-semibold">Examples</th>
                    <th className="border border-border px-3 py-2 text-left font-semibold">Collected?</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Identifiers", "Name, email address, IP address", "Yes"],
                    ["Professional/employment information", "Job role, contracted hours, transport mode", "Yes"],
                    ["Internet/electronic network activity", "Browser type, error logs, session data", "Yes"],
                    ["Geolocation data", "Postcode-derived coordinates (not GPS)", "Yes"],
                    ["Sensitive personal information", "N/A", "No"],
                  ].map(([cat, ex, col], i) => (
                    <tr key={i} className={i % 2 === 0 ? "" : "bg-muted/20"}>
                      <td className="border border-border px-3 py-2">{cat}</td>
                      <td className="border border-border px-3 py-2">{ex}</td>
                      <td className="border border-border px-3 py-2">{col}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm">We do NOT sell personal information. We do NOT use personal information for targeted advertising or cross-context behavioural advertising. To submit a CCPA/CPRA request, contact:{" "}
              <a href="mailto:mustansar.hussain@sg.homeinstead.co.uk" className="text-primary hover:underline">mustansar.hussain@sg.homeinstead.co.uk</a>
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">12. CalOPPA Compliance</h2>
            <p className="text-sm mb-2">In accordance with the California Online Privacy Protection Act:</p>
            <ul className="list-disc pl-6 space-y-1 text-sm">
              <li>This Privacy Policy is conspicuously accessible from our Service&rsquo;s login page and footer</li>
              <li>We disclose all categories of personal information collected</li>
              <li>We honour Do Not Track (DNT) browser signals — the Service does not track users across third-party websites or for advertising purposes</li>
              <li>We will notify users of material changes to this policy by updating the &ldquo;Last Updated&rdquo; date and, where appropriate, by email notification</li>
              <li>Third parties cannot collect personally identifiable information about your online activities over time and across different websites through the Service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">13. Children&rsquo;s Privacy</h2>
            <p className="text-sm">The Care Capacity Dashboard is an internal business tool and is not directed at individuals under the age of 18. We do not knowingly collect personal data from children. If we become aware that we have inadvertently collected data from a child, we will take steps to delete it promptly.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">14. Changes to This Policy</h2>
            <p className="text-sm mb-2">We may update this Privacy Policy from time to time to reflect changes in our practices, technology or legal requirements. When we make material changes, we will:</p>
            <ul className="list-disc pl-6 space-y-1 text-sm">
              <li>Update the &ldquo;Last Updated&rdquo; date and version number at the top of this document</li>
              <li>Notify affected users by email or in-app notification where appropriate</li>
              <li>Where required by law, seek your consent to the changes</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">15. Contact Us</h2>
            <p className="text-sm">If you have any questions about this Privacy Policy, wish to exercise your data protection rights, or have concerns about how we handle your personal data, please contact:</p>
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
            <Link href="/privacy-policy" className="font-medium text-foreground">Privacy Policy</Link>
            <span>&middot;</span>
            <Link href="/terms" className="hover:text-foreground hover:underline">Terms &amp; Conditions</Link>
            <span>&middot;</span>
            <Link href="/cookies" className="hover:text-foreground hover:underline">Cookie Policy</Link>
            <span>&middot;</span>
            <Link href="/" className="hover:text-foreground hover:underline flex items-center gap-1 inline-flex">
              <ArrowLeft className="h-3 w-3" />Back to Dashboard
            </Link>
          </div>
          <p>&copy; {new Date().getFullYear()} SUR Group (Scotland) Ltd t/a Home Instead. All rights reserved.</p>
        </footer>
      </div>
    </div>
  );
}
