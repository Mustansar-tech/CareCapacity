import { Link } from "wouter";

export function AppFooter() {
  return (
    <footer className="mt-16 pb-8 text-center">
      <div className="flex items-center justify-center gap-4 text-xs text-gray-400 dark:text-gray-600">
        <Link href="/privacy" className="hover:text-gray-600 dark:hover:text-gray-400 transition-colors">
          Privacy Policy
        </Link>
        <span aria-hidden="true">·</span>
        <Link href="/terms" className="hover:text-gray-600 dark:hover:text-gray-400 transition-colors">
          Terms &amp; Conditions
        </Link>
      </div>
    </footer>
  );
}
