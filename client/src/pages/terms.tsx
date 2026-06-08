import { Link } from "wouter";
import { FileText, ArrowLeft } from "lucide-react";

export default function Terms() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-6 py-12">

        <div className="flex items-center gap-3 mb-8">
          <FileText className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Terms of Service</h1>
            <p className="text-muted-foreground text-sm mt-1">Care Capacity Dashboard</p>
          </div>
        </div>

        <div className="bg-muted/40 border rounded-lg p-4 mb-8 text-sm text-muted-foreground">
          <strong>Effective Date:</strong> 8 June 2026 &nbsp;|&nbsp; <strong>Last Updated:</strong> 8 June 2026 &nbsp;|&nbsp; <strong>Version:</strong> 3.0 (Final)
        </div>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-8">

          <section>
            <h2 className="text-xl font-semibold mb-3">1. Acceptance of Terms</h2>
            <p className="text-sm">By accessing or using the Care Capacity Dashboard (the &ldquo;Service&rdquo;), you agree to be bound by these Terms of Service (&ldquo;Terms&rdquo;). If you do not agree to these Terms, you must not access or use the Service.</p>
            <p className="mt-2 text-sm">You accept these Terms by clicking &ldquo;I Agree&rdquo; or similar affirmative action during account registration, or by accessing and using the Service after these Terms have been made available to you.</p>
            <p className="mt-2 text-sm">These Terms constitute a legally binding agreement between you and SUR Group (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;), located at 18 Seaward Place, Kinning Park, Glasgow G41 1HH.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">2. Description of Service</h2>
            <p className="text-sm">The Care Capacity Dashboard is an intelligent workforce capacity analysis platform for optimal care scheduling and resource management. The Service is operated by SUR Group for authorised Home Instead franchise branches.</p>
            <p className="mt-2 text-sm">The Service provides:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-sm">
              <li>Workforce capacity analysis: net capacity calculations, utilisation tracking, demand vs. supply analysis</li>
              <li>Automated care visit scheduling using a Vehicle Routing Problem with Time Windows (VRPTW) optimisation engine</li>
              <li>Travel time calculations using third-party APIs (OpenRouteService for car routes, TravelTime API for walking/public transport, postcodes.io for UK postcode geocoding)</li>
              <li>Business Development (BD) Matrix: capacity heatmaps showing staff availability across time blocks</li>
              <li>Client enquiry matching: identifying suitable Care Professionals for new client requirements</li>
              <li>Guaranteed Hours (GH) loss tracking and analysis</li>
              <li>Excel-based data import from Access People Planner (manual upload or automated Playwright extraction)</li>
              <li>Branch-level dashboards, KPI reporting and weekly capacity snapshots</li>
              <li>Report generation and email delivery via Resend</li>
              <li>Drag-and-drop visit assignment for manual schedule adjustments</li>
            </ul>

            <h3 className="text-base font-semibold mt-5 mb-2">2.1 Dependency on Access People Planner</h3>
            <p className="text-sm">The Service relies on data exported from Access People Planner, a product of Access UK Ltd (The Access Group). The availability, accuracy and format of People Planner data directly affects the Service&rsquo;s functionality.</p>
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded p-4 mt-3 text-sm">
              <strong>Important:</strong> SUR Group is not affiliated with, endorsed by, or a partner of Access UK Ltd. The Service operates independently and is not an Access Group product. Any issues with People Planner availability, data format changes, platform updates or access restrictions by Access UK Ltd may temporarily or permanently affect the Service&rsquo;s data import functionality. SUR Group accepts no liability for disruptions caused by changes to Access People Planner.
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">3. Eligibility and Access</h2>
            <p className="text-sm">The Service is an internal business tool available only to authorised employees and representatives of Home Instead franchise branches operated by or in partnership with SUR Group.</p>
            <p className="mt-3 text-sm">Access is controlled via Role-Based Access Control (RBAC):</p>
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-sm border-collapse border border-border">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="border border-border px-3 py-2 text-left font-semibold">Role</th>
                    <th className="border border-border px-3 py-2 text-left font-semibold">Access Level</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Admin", "Full access: user management, all branches, system configuration, data upload, People Planner automation"],
                    ["Manager", "Full branch access: scheduling, data upload, reporting, BD matrix, enquiry matching"],
                    ["Supervisor", "Branch dashboards, reporting, read-only scheduling views"],
                    ["Viewer", "Read-only access to assigned branch dashboards and reports"],
                  ].map(([role, access], i) => (
                    <tr key={i} className={i % 2 === 0 ? "" : "bg-muted/20"}>
                      <td className="border border-border px-3 py-2 font-medium">{role}</td>
                      <td className="border border-border px-3 py-2">{access}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm">You are responsible for maintaining the confidentiality of your login credentials. You must notify us immediately at{" "}
              <a href="mailto:mustansar.hussain@sg.homeinstead.co.uk" className="text-primary hover:underline">mustansar.hussain@sg.homeinstead.co.uk</a>{" "}
              if you suspect unauthorised access to your account.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. Licence Grant</h2>
            <p className="text-sm">Subject to your compliance with these Terms, SUR Group grants you a limited, non-exclusive, non-transferable, revocable licence to access and use the Service solely for its intended purpose: internal workforce capacity analysis and care scheduling for your assigned Home Instead franchise branch(es).</p>
            <p className="mt-3 text-sm">This licence does not include any right to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-sm">
              <li>Sublicence, sell, resell, lease or commercially exploit the Service</li>
              <li>Copy, modify, adapt, translate, distribute or create derivative works of the Service</li>
              <li>Reverse engineer, decompile, disassemble or attempt to derive the source code of the Service</li>
              <li>Use the Service for any purpose other than its intended internal business use</li>
              <li>Remove, alter or obscure any copyright, trademark or other proprietary notices</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">5. Intellectual Property</h2>
            <p className="text-sm">All intellectual property rights in the Service — including but not limited to the software, source code, algorithms (including the VRPTW scheduling engine, BD Matrix algorithm, client enquiry matcher and scoring functions), user interface design, documentation, branding and all related materials — are and shall remain the exclusive property of SUR Group.</p>
            <p className="mt-3 text-sm"><strong>Data ownership:</strong> You retain full ownership of all data you upload to or generate within the Service, including employee data, client data, scheduling data and reports. SUR Group does not claim ownership of your data. You grant SUR Group a limited, revocable licence to process your data solely for the purpose of providing the Service.</p>
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded p-4 mt-3 text-sm">
              <strong>No-Training Commitment:</strong> We will not use Customer Data to develop, train or improve other products, services, machine learning models or artificial intelligence systems. Your data is processed solely for the purpose of delivering the Service to you.
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">6. Data Responsibility</h2>
            <p className="text-sm">By uploading or causing data to be extracted from People Planner or any other source into the Service, you confirm and warrant that:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-sm">
              <li>You have all necessary rights, permissions and lawful authority to upload employee and client personal data to the Service</li>
              <li>Appropriate privacy notices have been provided to all data subjects whose personal data you upload (including employees, Care Professionals, and clients)</li>
              <li>The data has been collected and is being shared with the Service in compliance with applicable data protection law, including UK GDPR</li>
              <li>You will not upload personal data beyond what is necessary for the Service&rsquo;s intended purpose</li>
              <li>You will promptly inform us if any data subject withdraws consent or objects to the processing of their data through the Service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">7. Data Accuracy Disclaimer</h2>
            <div className="bg-muted/30 border rounded p-4 text-sm font-medium uppercase tracking-wide">
              THE SERVICE PROCESSES DATA UPLOADED BY AUTHORISED USERS VIA EXCEL FILES FROM ACCESS PEOPLE PLANNER AND OTHER SOURCES. THE ACCURACY, COMPLETENESS AND QUALITY OF ALL OUTPUTS GENERATED BY THE SERVICE — INCLUDING CAPACITY ANALYSIS, SCHEDULING RECOMMENDATIONS, UTILISATION METRICS, GH LOSS CALCULATIONS AND BD MATRIX RESULTS — ARE DIRECTLY AND ENTIRELY DEPENDENT ON THE ACCURACY, COMPLETENESS AND QUALITY OF THE DATA UPLOADED.
            </div>
            <p className="mt-4 text-sm">Known data quality risks include but are not limited to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-sm">
              <li><strong>Wrong export type uploaded</strong> — column headers won&rsquo;t match; fields silently resolve as undefined</li>
              <li><strong>Missing CG Data file</strong> — employee roster incomplete; contracted hours KPIs and utilisation wrong</li>
              <li><strong>Partial-week export</strong> — daily totals correct for included days; weekly aggregates understated</li>
              <li><strong>Column header renamed upstream in People Planner</strong> — field may be silently skipped</li>
              <li><strong>Name formatting changes between files</strong> — cross-file matching fails for affected employees</li>
            </ul>
            <p className="mt-3 text-sm">SUR Group does not independently verify uploaded data. You are solely responsible for ensuring that data uploaded to the Service is accurate, up-to-date and complete.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">8. Automated Scheduling and Algorithmic Output Disclaimer</h2>
            <p className="text-sm">The Service includes an automated scheduling engine based on the Vehicle Routing Problem with Time Windows (VRPTW) optimisation algorithm. This engine runs client-side in your browser and generates scheduling suggestions intended to support — not replace — human decision-making.</p>
            <div className="bg-muted/30 border rounded p-4 mt-3 text-sm font-medium uppercase tracking-wide">
              AUTOMATED SCHEDULING OUTPUTS ARE SUGGESTIONS ONLY AND DO NOT CONSTITUTE GUARANTEED OPTIMAL OUTCOMES.
            </div>
            <p className="mt-4 text-sm"><strong>Your Responsibility:</strong> You acknowledge that the Service uses algorithmic optimisation to generate outputs. You are solely responsible for evaluating all outputs for accuracy and appropriateness for your use case, including by utilising qualified human review before implementing any scheduling decisions. No automated output from the Service should be treated as a final care, employment or operational decision without competent human validation.</p>
            <p className="mt-3 text-sm">The scheduling engine:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-sm">
              <li>Operates on mathematical optimisation using a greedy assignment algorithm with scoring functions</li>
              <li>May not account for all real-world variables (e.g., real-time traffic, client preferences not recorded in data, employee wellbeing, last-minute cancellations)</li>
              <li>Depends entirely on the quality and completeness of input data from People Planner</li>
              <li>Applies hard constraints (9-hour daily cap, mandatory 30-minute breaks after 5 continuous hours, gender matching, travel time caps) but cannot guarantee regulatory compliance in all circumstances</li>
              <li>Must be reviewed by qualified care scheduling personnel before implementation</li>
            </ul>
            <p className="mt-3 text-sm">SUR Group accepts no liability for scheduling outcomes, care quality issues, regulatory non-compliance or any other consequences arising from schedules implemented without appropriate human review and professional judgement.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">9. Travel Time Disclaimer</h2>
            <p className="text-sm">Travel time calculations within the Service are provided by third-party APIs and mathematical formulae:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-sm">
              <li>OpenRouteService (ORS) — car travel time and distance calculations (matrix and directions)</li>
              <li>TravelTime API — walking and public transport travel time calculations</li>
              <li>postcodes.io — postcode-to-coordinate geocoding</li>
              <li>Haversine formula — straight-line distance estimates used as fallback</li>
            </ul>
            <p className="mt-3 text-sm">These calculations are estimates only and:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-sm">
              <li>May not reflect actual road conditions, traffic congestion, roadworks, diversions or weather</li>
              <li>Are based on geocoded postcode centroids, not exact door-to-door addresses</li>
              <li>Use different calculation methods depending on transport mode</li>
              <li>Are subject to the availability, accuracy and uptime of third-party services</li>
              <li>May differ between weekday and weekend calculations (TravelTime uses different timetables)</li>
              <li>Apply travel caps (car: 45 minutes, walking/public transport: 60 minutes) which may exclude viable routes</li>
            </ul>
            <p className="mt-3 text-sm">SUR Group is not responsible for the accuracy of travel time estimates. Actual travel times should be verified independently where safety-critical decisions are involved.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">10. Acceptable Use Policy</h2>
            <p className="text-sm">You agree not to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-sm">
              <li>Use the Service for any unlawful purpose or in violation of any applicable law or regulation</li>
              <li>Attempt to gain unauthorised access to any part of the Service, other user accounts, branches or connected systems</li>
              <li>Upload data that you are not authorised to process or that is unrelated to Home Instead care operations</li>
              <li>Upload malicious files, viruses, trojans or any harmful code</li>
              <li>Share your login credentials with any unauthorised person</li>
              <li>Access data belonging to branches you are not authorised to view</li>
              <li>Extract, scrape, harvest or copy data from the Service by automated means (other than via authorised Service functionality)</li>
              <li>Attempt to reverse engineer, decompile or disassemble any part of the Service</li>
              <li>Use the Service to make final decisions about individuals&rsquo; care, employment, disciplinary matters or safeguarding without appropriate human oversight and professional judgement</li>
              <li>Circumvent or attempt to circumvent RBAC controls, branch isolation or any other security measure</li>
              <li>Use Output from the Service to develop any competing products or services</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">11. Confidentiality</h2>
            <p className="text-sm">The Service processes sensitive and confidential workforce and client data relating to care operations. You acknowledge that all data within the Service is confidential and agree to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-sm">
              <li>Access only the data you are authorised to view based on your RBAC role and branch assignment</li>
              <li>Not disclose, share, copy, screenshot, export or distribute any data obtained through the Service to any unauthorised third party</li>
              <li>Take reasonable steps to prevent unauthorised access to or disclosure of Service data</li>
              <li>Report any suspected data breach, unauthorised access or security incident immediately to{" "}
                <a href="mailto:mustansar.hussain@sg.homeinstead.co.uk" className="text-primary hover:underline">mustansar.hussain@sg.homeinstead.co.uk</a>
              </li>
            </ul>
            <p className="mt-3 text-sm">This obligation of confidentiality survives termination of your access to the Service and continues indefinitely for personal data and for a period of 5 years for other confidential business information.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">12. Limitation of Liability</h2>
            <div className="bg-muted/30 border rounded p-4 text-sm space-y-3">
              <p className="font-medium uppercase tracking-wide">TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW:</p>
              <p>THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED OR STATUTORY, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, ACCURACY, COMPLETENESS, RELIABILITY OR NON-INFRINGEMENT.</p>
              <p>WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, SECURE OR FREE FROM VIRUSES OR OTHER HARMFUL COMPONENTS.</p>
              <p>IN NO EVENT SHALL SUR GROUP, ITS DIRECTORS, EMPLOYEES, AGENTS OR AFFILIATES BE LIABLE FOR ANY:</p>
            </div>
            <ul className="list-disc pl-6 mt-3 space-y-1 text-sm">
              <li>Indirect, incidental, special, consequential or punitive damages</li>
              <li>Loss of profits, revenue, business, contracts, savings, anticipated savings or goodwill</li>
              <li>Loss of data, data corruption or cost of data recovery</li>
              <li>Cost of procurement of substitute services</li>
              <li>Damages arising from scheduling decisions made using or relying on Service outputs</li>
              <li>Damages arising from inaccurate travel time estimates from third-party APIs</li>
              <li>Damages arising from inaccurate, incomplete or outdated uploaded data</li>
              <li>Damages arising from Access People Planner downtime, data format changes or access issues</li>
              <li>Damages arising from any interruption to or degradation of the Service</li>
            </ul>
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded p-4 mt-4 text-sm font-medium">
              OUR TOTAL AGGREGATE LIABILITY FOR ALL CLAIMS ARISING OUT OF OR RELATING TO THESE TERMS OR THE SERVICE SHALL NOT EXCEED ONE HUNDRED POUNDS STERLING (&pound;100).
            </div>
            <p className="mt-3 text-sm"><strong>Exceptions:</strong> Nothing in these Terms excludes or limits liability for: (a) death or personal injury caused by negligence; (b) fraud or fraudulent misrepresentation; (c) gross negligence or wilful misconduct; (d) breach of obligations under data protection law where SUR Group is at fault; or (e) any other liability that cannot be excluded or limited under applicable law, including the Consumer Rights Act 2015 where applicable.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">13. Indemnification</h2>
            <p className="text-sm">You agree to indemnify, defend and hold harmless SUR Group, its directors, employees, agents and affiliates from and against any and all claims, damages, losses, liabilities, costs and expenses (including reasonable legal fees) arising out of or relating to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-sm">
              <li>Your use of or inability to use the Service</li>
              <li>Your breach of these Terms</li>
              <li>Your violation of any applicable law, regulation or third-party right</li>
              <li>Data you upload to the Service or cause to be extracted from People Planner</li>
              <li>Any scheduling decisions made using or relying on Service outputs without appropriate human review</li>
              <li>Your failure to provide adequate privacy notices to data subjects whose data you upload</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">14. Service Availability</h2>
            <p className="text-sm">We aim to provide continuous access to the Service but do not guarantee uninterrupted, timely, secure or error-free operation. The Service may be temporarily unavailable due to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-sm">
              <li>Scheduled maintenance (we will endeavour to provide advance notice where practicable)</li>
              <li>Unscheduled downtime or technical issues</li>
              <li>Third-party service outages (Neon, Sentry, Resend, OpenRouteService, TravelTime, postcodes.io, Replit)</li>
              <li>Access People Planner downtime, updates or changes that affect data extraction</li>
              <li>Force majeure events (see Section 17)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">15. Termination</h2>
            <p className="text-sm">SUR Group may suspend or terminate your access to the Service at any time, with or without cause.</p>

            <h3 className="text-base font-semibold mt-4 mb-2">15.1 Termination for Breach</h3>
            <p className="text-sm">Where termination is due to a material breach of these Terms by you, we will provide 14 days&rsquo; written notice and an opportunity to cure the breach before termination takes effect. This cure period does not apply in cases of:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-sm">
              <li>Serious security breaches or suspected unauthorised access</li>
              <li>Illegal activity or violation of data protection law</li>
              <li>Uploading of malicious code or deliberate interference with the Service</li>
            </ul>
            <p className="mt-2 text-sm">In such cases, immediate suspension or termination may apply without notice.</p>

            <h3 className="text-base font-semibold mt-4 mb-2">15.2 Other Grounds for Termination</h3>
            <ul className="list-disc pl-6 space-y-1 text-sm">
              <li>End of your employment or authorised relationship with a Home Instead franchise branch</li>
              <li>Request from your branch administrator or manager</li>
              <li>Discontinuation of the Service</li>
            </ul>

            <h3 className="text-base font-semibold mt-4 mb-2">15.3 Effect of Termination</h3>
            <p className="text-sm">Upon termination, your right to access the Service ceases immediately.</p>
            <p className="mt-2 text-sm"><strong>Data Deletion:</strong> Upon termination, we will delete all your data from our systems within 30 days, unless we are legally required to retain it (for example, to comply with HMRC obligations or regulatory requirements) or the data is needed for legitimate business purposes as described in our Privacy Policy and data retention schedule.</p>
            <p className="mt-2 text-sm">Provisions that by their nature should survive termination will continue in full force, including: confidentiality obligations, limitation of liability, indemnification, intellectual property rights and governing law.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">16. Modifications to Terms</h2>
            <p className="text-sm">We reserve the right to modify these Terms at any time. Changes will be communicated by updating the &ldquo;Last Updated&rdquo; date and version number. Where changes materially affect your rights or obligations, we will provide at least 30 days&rsquo; notice before the changes take effect, unless the change is required to comply with applicable law.</p>
            <p className="mt-2 text-sm">Your continued use of the Service after notification constitutes acceptance of the revised Terms. If you do not agree to the revised Terms, you must stop using the Service.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">17. Force Majeure</h2>
            <p className="text-sm">SUR Group shall not be liable for any failure or delay in performing its obligations under these Terms where such failure or delay results from circumstances beyond our reasonable control, including but not limited to: natural disasters, pandemics, war, terrorism, civil unrest, government actions or regulations, power failures, internet service disruptions, telecommunications failures, cyberattacks, ransomware, third-party API or service failures (including Access People Planner and Care Copilot), hosting provider outages, or industrial action.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">18. Governing Law and Jurisdiction</h2>
            <p className="text-sm">These Terms are governed by and construed in accordance with the laws of Scotland. Any disputes arising out of or in connection with these Terms shall be subject to the exclusive jurisdiction of the Scottish courts.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">19. Severability</h2>
            <p className="text-sm">If any provision of these Terms is held to be invalid, illegal or unenforceable by a court of competent jurisdiction, the remaining provisions shall continue in full force and effect. The invalid provision shall be modified to the minimum extent necessary to make it valid and enforceable.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">20. Waiver</h2>
            <p className="text-sm">No failure or delay by SUR Group in exercising any right or remedy under these Terms shall constitute a waiver of that right or remedy. A waiver on one occasion shall not be construed as a waiver on any subsequent occasion.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">21. Entire Agreement</h2>
            <p className="text-sm">These Terms, together with the Privacy Policy and Cookie Policy, constitute the entire agreement between you and SUR Group regarding your use of the Service and supersede all prior agreements, understandings, negotiations and representations, whether written or oral.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">22. Contact</h2>
            <p className="text-sm">For any questions regarding these Terms of Service:</p>
            <div className="bg-muted/30 border rounded p-4 mt-3 text-sm">
              <strong>Mustansar Hussain</strong><br />
              SUR Group<br />
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
            <Link href="/privacy-policy" className="hover:text-foreground hover:underline">Privacy Policy</Link>
            <span>&middot;</span>
            <Link href="/terms" className="font-medium text-foreground">Terms &amp; Conditions</Link>
            <span>&middot;</span>
            <Link href="/cookies" className="hover:text-foreground hover:underline">Cookie Policy</Link>
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
